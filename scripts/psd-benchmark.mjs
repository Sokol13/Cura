#!/usr/bin/env node
/**
 * Reproduce PSD acceptance against the compiled full production server:
 *   pnpm --filter @cura/shared build && pnpm --filter @cura/server build
 *   node scripts/psd-benchmark.mjs [output.json]
 *
 * Fixture generation runs separately, never in a measured process. Each case
 * gets a fresh Node process, Fastify server, SQLite database and media worker.
 * The 8192 x 8192 middle size is a proxy, not an undisclosed user file.
 */
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import {
  access,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';

const script = fileURLToPath(import.meta.url);
const repository = path.resolve(path.dirname(script), '..');
const serverRequire = createRequire(
  new URL('../packages/server/package.json', import.meta.url),
);
const workerPath = path.join(
  repository,
  'packages/server/dist/media/worker.js',
);
const cases = [
  {
    name: 'resource-1036',
    width: 3866,
    height: 6871,
    resources: [{ id: 1036, format: 'jpeg', color: [210, 50, 30] }],
    expectedColors: [[210, 50, 30]],
  },
  {
    name: 'resource-1033',
    width: 8192,
    height: 8192,
    resources: [{ id: 1033, format: 'jpeg', color: [30, 180, 210] }],
    expectedColors: [[30, 180, 210]],
  },
  {
    name: 'merged-raw',
    width: 13391,
    height: 7032,
    expectedColors: [
      [240, 20, 10],
      [10, 230, 30],
      [20, 40, 220],
      [230, 210, 20],
    ],
  },
];
const limits = {
  processingMs: 10_000,
  absoluteRssBytes: 500_000_000,
  minSourceBytes: 50 * 1024 * 1024,
};

async function hashFile(file) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}

function child(args, timeoutMs = 60_000) {
  return new Promise((resolve, reject) => {
    const processChild = spawn(process.execPath, args, {
      cwd: repository,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '',
      stderr = '',
      expired = false;
    const timer = setTimeout(() => {
      expired = true;
      processChild.kill('SIGKILL');
    }, timeoutMs);
    processChild.stdout.setEncoding('utf8');
    processChild.stderr.setEncoding('utf8');
    processChild.stdout.on('data', (part) => {
      stdout += part;
    });
    processChild.stderr.on('data', (part) => {
      stderr = (stderr + part).slice(-16_384);
    });
    processChild.once('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    processChild.once('close', (code) => {
      clearTimeout(timer);
      if (expired || code !== 0)
        reject(
          new Error(
            expired
              ? 'PSD benchmark subprocess exceeded its deadline'
              : `PSD benchmark subprocess failed (${code}): ${stderr}`,
          ),
        );
      else {
        try {
          resolve(JSON.parse(stdout));
        } catch {
          reject(new Error('PSD benchmark subprocess returned invalid JSON'));
        }
      }
    });
  });
}

async function generate(directory) {
  const { writePsdFixture } = await import(
    '../packages/server/test/psd-fixtures.ts'
  );
  const manifest = [];
  for (const [index, fixture] of cases.entries()) {
    const sourceDirectory = `source-${index}`;
    await mkdir(path.join(directory, sourceDirectory));
    const name = path.join(sourceDirectory, `${fixture.name}.psd`);
    const file = path.join(directory, name);
    await writePsdFixture(file, {
      width: fixture.width,
      height: fixture.height,
      compression: 'raw',
      ...(fixture.resources ? { resources: fixture.resources } : {}),
    });
    const size = (await stat(file)).size;
    assert(
      size > limits.minSourceBytes,
      'Every source must exceed the old 50 MiB browser cap',
    );
    manifest.push({
      ...fixture,
      file: name,
      size,
      sha256: await hashFile(file),
    });
  }
  await writeFile(
    path.join(directory, 'manifest.json'),
    JSON.stringify(manifest),
  );
  return { generated: manifest.length };
}

async function measure(directory, index) {
  const manifest = JSON.parse(
    await readFile(path.join(directory, 'manifest.json'), 'utf8'),
  );
  const fixture = manifest[index];
  assert(fixture, 'Unknown benchmark case');
  const paths = {
    data: path.join(directory, `data-${index}`),
    cache: path.join(directory, `cache-${index}`),
    log: path.join(directory, `log-${index}`),
  };
  const startupStarted = performance.now();
  const [{ createApp }, { openDatabase }, { CatalogStore }] = await Promise.all(
    [
      import('../packages/server/dist/app.js'),
      import('../packages/server/dist/database.js'),
      import('../packages/server/dist/catalog-store.js'),
    ],
  );
  const database = openDatabase(paths);
  const pino = serverRequire('pino');
  const destination = pino.destination({
    dest: path.join(paths.log, 'cura.log'),
    sync: true,
  });
  let app;
  try {
    // Same complete service graph and persistent logging as normal startup;
    // only the automatic browser launch is absent from this headless benchmark.
    app = await createApp({
      database,
      paths,
      loggerInstance: pino({ level: 'info' }, destination),
    });
    const address = await app.listen({ host: '127.0.0.1', port: 0 });
    const startupMs = performance.now() - startupStarted;
    const store = new CatalogStore(database);
    async function request(
      method,
      route,
      payload,
      deadline = performance.now() + 5_000,
    ) {
      const remaining = deadline - performance.now();
      assert(remaining > 0, 'PSD import exceeded the 10 second deadline');
      const response = await fetch(`${address}${route}`, {
        method,
        signal: AbortSignal.timeout(Math.max(1, Math.ceil(remaining))),
        ...(payload === undefined
          ? {}
          : {
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify(payload),
            }),
      });
      assert(response.ok, `HTTP ${method} ${route} failed: ${response.status}`);
      return response;
    }
    const library = await (
      await request('POST', '/api/libraries', {
        name: `PSD benchmark ${fixture.name}`,
      })
    ).json();
    const before = performance.now();
    const deadline = before + limits.processingMs;
    await (
      await request(
        'POST',
        `/api/libraries/${library.id}/roots`,
        { path: path.dirname(path.join(directory, fixture.file)) },
        deadline,
      )
    ).json();
    let asset;
    while (performance.now() < deadline) {
      const page = await (
        await request(
          'GET',
          `/api/libraries/${library.id}/assets`,
          undefined,
          deadline,
        )
      ).json();
      assert(
        page.total <= 1,
        'Each benchmark must scan exactly one isolated source',
      );
      const current = page.items[0];
      if (current?.previewState === 'ready') {
        asset = current;
        break;
      }
      assert(
        current?.previewState !== 'failed' &&
          current?.previewState !== 'unsupported',
        `PSD preview failed: ${current?.previewError ?? current?.previewState}`,
      );
      await delay(Math.min(25, Math.max(1, deadline - performance.now())));
    }
    assert(asset, 'PSD did not become ready within the 10 second deadline');
    const retained = store.getVersionFile(asset.currentVersionId);
    const result = { ...store.getAsset(asset.id), ...retained };
    const thumbnailResponse = await request(
      'GET',
      `/api/versions/${asset.currentVersionId}/thumbnail`,
      undefined,
      deadline,
    );
    const servedThumbnail = Buffer.from(await thumbnailResponse.arrayBuffer());
    const elapsed = performance.now() - before;
    assert.equal(
      store.listVersions(asset.id).length,
      1,
      'Initial import must preserve a single immutable version',
    );
    assert.equal(
      result.width,
      fixture.width,
      'Original width must survive thumbnail generation',
    );
    assert.equal(
      result.height,
      fixture.height,
      'Original height must survive thumbnail generation',
    );
    assert.equal(result.type, 'image/vnd.adobe.photoshop');
    assert.equal(result.size, fixture.size);
    assert.equal(
      result.hash,
      fixture.sha256,
      'Production hash must match the independently hashed source',
    );
    assert(result.thumbnailPath, 'PSD must have a server-generated thumbnail');
    assert.match(result.phash, /^[0-9a-f]{16}$/i);
    assert(
      result.colors.length > 0,
      'Generated preview must supply its color palette',
    );
    const sharp = serverRequire('sharp');
    assert(
      servedThumbnail.equals(await readFile(result.thumbnailPath)),
      'HTTP thumbnail must match the retained cache file',
    );
    const metadata = await sharp(servedThumbnail).metadata();
    assert.equal(metadata.format, 'webp');
    assert(
      metadata.width > 0 &&
        metadata.width <= 512 &&
        metadata.height > 0 &&
        metadata.height <= 512,
    );
    const decoded = await sharp(result.thumbnailPath)
      .removeAlpha()
      .toColourspace('srgb')
      .raw()
      .toBuffer({ resolveWithObject: true });
    const sampledColors = fixture.expectedColors.map((expected, colorIndex) => {
      const x = Math.floor(
        decoded.info.width *
          (fixture.expectedColors.length === 1
            ? 0.5
            : colorIndex % 2
              ? 0.75
              : 0.25),
      );
      const y = Math.floor(
        decoded.info.height *
          (fixture.expectedColors.length === 1
            ? 0.5
            : colorIndex < 2
              ? 0.25
              : 0.75),
      );
      const offset = (y * decoded.info.width + x) * decoded.info.channels;
      const actual = [...decoded.data.subarray(offset, offset + 3)];
      actual.forEach((value, channel) =>
        assert(
          Math.abs(value - expected[channel]) <= 20,
          `Thumbnail color mismatch: ${actual} vs ${expected}`,
        ),
      );
      return actual;
    });
    assert.equal(
      await hashFile(path.join(directory, fixture.file)),
      fixture.sha256,
      'Import must preserve source bytes',
    );
    assert.equal(
      await hashFile(result.snapshotPath),
      fixture.sha256,
      'Retained immutable snapshot must preserve source bytes',
    );
    const maxRssKiB = process.resourceUsage().maxRSS;
    assert(
      elapsed < limits.processingMs,
      `PSD processing exceeded 10 seconds: ${elapsed.toFixed(1)} ms`,
    );
    assert(
      maxRssKiB * 1024 < limits.absoluteRssBytes,
      `PSD absolute process peak exceeded 500 MB: ${maxRssKiB} KiB`,
    );
    return {
      name: fixture.name,
      originalWidth: fixture.width,
      originalHeight: fixture.height,
      sourceBytes: fixture.size,
      sourceSha256: fixture.sha256,
      startupMs,
      processingMs: elapsed,
      maxRssKiB,
      maxRssBytes: maxRssKiB * 1024,
      thumbnailWidth: metadata.width,
      thumbnailHeight: metadata.height,
      sampledColors,
      sourceAndSnapshotHashesPreserved: true,
      fullProductionServer: true,
      registeredViaHttp: true,
      thumbnailRetrievedViaHttp: true,
      workerThreads: true,
    };
  } finally {
    try {
      if (app) await app.close();
    } finally {
      database.close();
      destination.end();
    }
  }
}

async function run(output) {
  await access(workerPath);
  const scratch = path.join(repository, '.tmp');
  await mkdir(scratch, { recursive: true });
  const directory = await mkdtemp(path.join(scratch, 'psd-benchmark-'));
  try {
    await child([
      '--import',
      serverRequire.resolve('tsx/esm'),
      script,
      '--generate',
      directory,
    ]);
    const results = [];
    for (let index = 0; index < cases.length; index++)
      results.push(
        await child([script, '--case', directory, String(index)], 30_000),
      );
    const productionFiles = {};
    for (const name of [
      'app.js',
      'database.js',
      'catalog-store.js',
      'media/service.js',
      'media/worker.js',
      'media/image.js',
      'media/psd.js',
    ])
      productionFiles[name] = await hashFile(
        path.join(repository, 'packages/server/dist', name),
      );
    const evidence = {
      schemaVersion: 2,
      recordedAt: new Date().toISOString(),
      commit: execFileSync('git', ['rev-parse', 'HEAD'], {
        cwd: repository,
        encoding: 'utf8',
      }).trim(),
      node: process.version,
      platform: process.platform,
      architecture: process.arch,
      productionFiles,
      limits,
      method:
        'Separate fixture-generation subprocess; a fresh plain-Node process per case with the complete compiled production Fastify server, SQLite database, persistent logger and internal media worker. Each source is isolated in its own registered folder. Real HTTP creates the library, registers its root, polls the ready asset and fetches its thumbnail. Startup is recorded separately; processing time starts before root registration and includes watching, scanning, queueing, source containment, hashing, immutable snapshot, preview generation, database commit, ready polling and thumbnail retrieval. Absolute process-wide resourceUsage maxRSS includes the entire server, workers, native libraries and validation; it is not a heap or baseline delta.',
      limitations: [
        'Generated PSD fixtures are not the user original files.',
        '8192 x 8192 is a representative middle size because only the smallest and largest sizes were supplied.',
        'All fixtures contain complete raw merged pixels exceeding 50 MiB; first two use embedded JPEG resources, final case has no thumbnail resource.',
        'Linux container results do not establish macOS/Windows timings.',
      ],
      cases: results,
      passed: true,
    };
    const json = `${JSON.stringify(evidence, null, 2)}\n`;
    if (output) {
      const destination = path.resolve(output);
      await mkdir(path.dirname(destination), { recursive: true });
      await writeFile(destination, json);
    }
    process.stdout.write(json);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

try {
  const [mode, directory, index] = process.argv.slice(2);
  if (mode === '--generate')
    process.stdout.write(`${JSON.stringify(await generate(directory))}\n`);
  else if (mode === '--case')
    process.stdout.write(
      `${JSON.stringify(await measure(directory, Number(index)))}\n`,
    );
  else await run(mode);
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.stack : error}\n`);
  process.exitCode = 1;
}
