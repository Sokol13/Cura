#!/usr/bin/env node
/**
 * Reproduce PSD acceptance against the compiled production media worker:
 *   pnpm --filter @cura/shared build && pnpm --filter @cura/server build
 *   node scripts/psd-benchmark.mjs [output.json]
 *
 * Fixture generation runs separately, never in a measured process. Each case
 * gets a fresh Node process, data directory and real worker_threads worker.
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
import { Worker } from 'node:worker_threads';

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
  for (const fixture of cases) {
    const name = `${fixture.name}.psd`;
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
  const dataDir = path.join(directory, `data-${index}`),
    cacheDir = path.join(directory, `cache-${index}`);
  await mkdir(dataDir);
  await mkdir(cacheDir);
  const before = performance.now();
  const worker = new Worker(workerPath, { execArgv: [] });
  let result, elapsed;
  try {
    result = await new Promise((resolve, reject) => {
      worker.once('error', reject);
      worker.once('exit', (code) =>
        reject(
          new Error(`Production media worker exited before a result (${code})`),
        ),
      );
      worker.once('message', (message) =>
        message.error
          ? reject(new Error(message.error.message))
          : resolve(message.result),
      );
      worker.postMessage({
        id: 1,
        kind: 'process',
        root: directory,
        relativePath: fixture.file,
        dataDir,
        cacheDir,
      });
    });
    elapsed = performance.now() - before;
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
    const metadata = await sharp(result.thumbnailPath).metadata();
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
      processingMs: elapsed,
      maxRssKiB,
      maxRssBytes: maxRssKiB * 1024,
      thumbnailWidth: metadata.width,
      thumbnailHeight: metadata.height,
      sampledColors,
      sourceAndSnapshotHashesPreserved: true,
      workerThreads: true,
    };
  } finally {
    await worker.terminate();
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
    for (const name of ['worker.js', 'image.js', 'psd.js'])
      productionFiles[name] = await hashFile(
        path.join(repository, 'packages/server/dist/media', name),
      );
    const evidence = {
      schemaVersion: 1,
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
        'Separate fixture-generation subprocess; a fresh plain-Node process per case with the compiled production worker_threads media worker. Processing time includes worker startup, source containment, hash, immutable snapshot and preview generation. Peak RSS is the absolute process-wide resourceUsage maxRSS including workers/native libraries and validation, not a heap or baseline delta.',
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
