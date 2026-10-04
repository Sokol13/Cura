import { randomUUID } from 'node:crypto';
import {
  mkdtemp,
  readFile,
  writeFile,
  mkdir,
  rename,
  rm,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { afterEach, expect, test } from 'vitest';
import { unzipSync } from 'fflate';
import sharp from 'sharp';
import { openDatabase } from '../src/database.js';
import { resolveUserPaths } from '../src/paths.js';
import { CatalogStore } from '../src/catalog-store.js';
import { MediaService } from '../src/media/service.js';
import { FcpxmlService } from '../src/fcpxml/service.js';
import { readFcpxmlExport } from '../src/fcpxml/snapshot.js';
const run = promisify(execFile),
  cleanup: Array<() => void | Promise<unknown>> = [];
afterEach(async () => {
  for (const fn of cleanup.reverse()) await fn();
  cleanup.length = 0;
});
async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), 'cura-fcp-package-'));
  const paths = resolveUserPaths({
    CURA_DATA_DIR: join(directory, 'data'),
    CURA_CACHE_DIR: join(directory, 'cache'),
    CURA_LOG_DIR: join(directory, 'logs'),
  });
  const db = openDatabase(paths),
    catalog = new CatalogStore(db),
    media = new MediaService(catalog, paths),
    service = new FcpxmlService(db, paths);
  cleanup.push(
    () => rm(directory, { recursive: true, force: true }),
    () => db.close(),
    () => media.close(),
    () => service.close(),
  );
  const library = catalog.createLibrary({ name: '电影' });
  return { directory, paths, db, catalog, media, service, library };
}
const still = async (color: string, jpeg = false) => {
  const image = sharp({
    create: { width: 64, height: 48, channels: 3, background: color },
  });
  return jpeg ? image.jpeg().toBuffer() : image.png().toBuffer();
};
test('worker package retains replaced/trash bytes, historical extensions, exact source timing; moved package relinks independently', async () => {
  const f = await fixture();
  const oldBytes = await still('red', true),
    asset = await f.media.upload(f.library.id, '历史.jpg', oldBytes);
  await f.media.replace(asset.id, 'new.png', await still('blue'));
  f.catalog.updateAsset(asset.id, {
    displayName: '客户 选定.png',
  });
  f.catalog.batchAssets(f.library.id, {
    assetIds: [asset.id],
    action: 'trash',
  });
  const video = await f.media.upload(
    f.library.id,
    '片段.mp4',
    await readFile(
      fileURLToPath(
        new URL('../../../e2e/fixtures/rich/first-frame.mp4', import.meta.url),
      ),
    ),
  );
  const timing = await f.service.probe(video.currentVersionId);
  const job = f.service.start(f.library.id, {
    name: '剪辑 & <中文>',
    timebase: '24000/1001',
    clips: [
      {
        id: randomUUID(),
        assetId: asset.id,
        versionId: asset.currentVersionId,
        durationFrames: 120,
      },
      {
        id: randomUUID(),
        assetId: video.id,
        versionId: video.currentVersionId,
        inFrames: 1,
        durationFrames: 12,
        videoTiming: timing,
      },
      {
        id: randomUUID(),
        assetId: asset.id,
        versionId: asset.currentVersionId,
        durationFrames: 48,
      },
    ],
  });
  await f.service.close();
  const complete = f.service.get(job.id);
  expect(complete.error).toBeNull();
  expect(complete.status).toBe('completed');
  expect(complete.duration).toBe('3003/400s');
  expect(JSON.stringify(readFcpxmlExport(f.db, f.library.id))).not.toContain(
    f.paths.data,
  );
  const xmlFile = f.service.file(job.id, 'xml').path,
    validator = fileURLToPath(
      new URL('../../../scripts/validate-fcpxml.py', import.meta.url),
    );
  await run('python3', [validator, xmlFile, '--package', dirname(xmlFile)]);
  const zip = unzipSync(await readFile(f.service.file(job.id, 'package').path)),
    extract = join(f.directory, 'moved folder 中文');
  for (const [name, bytes] of Object.entries(zip)) {
    const file = join(extract, ...name.split('/'));
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, bytes);
  }
  const manifest = JSON.parse(Buffer.from(zip['manifest.json']!).toString());
  expect(manifest.media[0].name).toMatch(/\.jpg$/);
  expect(manifest.media[0].originalName).toBe('历史.jpg');
  expect(await readFile(join(extract, manifest.media[0].path))).toEqual(
    oldBytes,
  );
  expect(JSON.stringify(manifest)).not.toContain(f.paths.data);
  // Remove original export directory: the independent relinker must use only extracted retained bytes.
  await rename(dirname(xmlFile), dirname(xmlFile) + '-unavailable');
  await run(process.execPath, [join(extract, 'relink.mjs')]);
  const result = await run('python3', [
    validator,
    join(extract, 'timeline.fcpxml'),
    '--package',
    extract,
  ]);
  expect(JSON.parse(result.stdout).clips).toBe(3);
  await writeFile(join(extract, manifest.media[0].path), 'tampered');
  await expect(
    run(process.execPath, [join(extract, 'relink.mjs')]),
  ).rejects.toThrow(/hash or size/);
}, 30000);
test('per-clip failures reject unsupported, cross-library, source overrun and missing retained bytes without completing packages', async () => {
  const f = await fixture(),
    asset = await f.media.upload(f.library.id, 'image.png', await still('red'));
  const other = f.catalog.createLibrary({ name: 'Other' }),
    unsupported = await f.media.upload(
      f.library.id,
      'manual.txt',
      Buffer.from('hello'),
    );
  const entry = (assetId: string, versionId: string) => ({
    id: randomUUID(),
    assetId,
    versionId,
    durationFrames: 25,
  });
  const bad = f.service.start(f.library.id, {
    name: 'unsupported',
    clips: [entry(unsupported.id, unsupported.currentVersionId)],
  });
  expect(bad.status).toBe('failed');
  expect(bad.problems[0]?.versionId).toBe(unsupported.currentVersionId);
  const foreign = f.service.start(other.id, {
    name: 'foreign',
    clips: [entry(asset.id, asset.currentVersionId)],
  });
  expect(foreign.status).toBe('failed');
  const video = await f.media.upload(
    f.library.id,
    'video.mp4',
    await readFile(
      fileURLToPath(
        new URL('../../../e2e/fixtures/rich/first-frame.mp4', import.meta.url),
      ),
    ),
  );
  const timing = await f.service.probe(video.currentVersionId);
  const overrun = f.service.start(f.library.id, {
    name: 'long',
    clips: [
      {
        ...entry(video.id, video.currentVersionId),
        inFrames: 2,
        videoTiming: timing,
      },
    ],
  });
  expect(overrun.problems[0]?.message).toContain('exceed');
  const forged = f.service.start(f.library.id, {
    name: 'wrong header',
    clips: [
      {
        ...entry(video.id, video.currentVersionId),
        videoTiming: { ...timing, frameRate: '25', durationFrames: 500 },
      },
    ],
  });
  await f.service.close();
  expect(f.service.get(forged.id).status).toBe('failed');
  expect(f.service.get(forged.id).problems[0]?.message).toContain('differs');
  const another = new FcpxmlService(f.db, f.paths);
  cleanup.push(() => another.close());
  await rm(f.catalog.getVersionFile(asset.currentVersionId).snapshotPath);
  const missing = another.start(f.library.id, {
    name: 'missing',
    clips: [entry(asset.id, asset.currentVersionId)],
  });
  await another.close();
  expect(another.get(missing.id).status).toBe('failed');
  expect(another.get(missing.id).problems[0]?.code).toBe('MEDIA_INVALID');
  expect(() => another.file(missing.id, 'package')).toThrow(/not complete/);
}, 30000);
