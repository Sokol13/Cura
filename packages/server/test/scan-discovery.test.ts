import { execFileSync } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { ScanErrorSchema, ScanExtensionSchema } from '@cura/shared';
import { discoverFiles, shouldAutoImport } from '../src/media/scan.js';

const directories: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const directory of directories.splice(0))
    await fs.rm(directory, { recursive: true, force: true });
});
async function root() {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'cura-scan-'));
  directories.push(directory);
  return fs.realpath(directory);
}
async function file(root: string, relative: string) {
  const target = path.join(root, relative);
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, 'original bytes');
  return target;
}

it('recursively classifies supported files, unsupported extensions and NFC legacy generic aliases', async () => {
  const directory = await root();
  const paths = await Promise.all(
    [
      '主图.PNG',
      'child/deeper/design.PsD',
      'child/clip.MOV',
      'notes.txt',
      'archive.ZIP',
      'README',
      're\u0301sume\u0301.blend',
    ].map((relative) => file(directory, relative)),
  );
  const result = await discoverFiles(directory, ['résumé.blend']);
  expect(result.files.sort()).toEqual(
    [paths[0], paths[1], paths[2], paths[6]].sort(),
  );
  expect(result.presentRelativePaths.sort()).toEqual(
    [
      '主图.PNG',
      'child/deeper/design.PsD',
      'child/clip.MOV',
      'notes.txt',
      'archive.ZIP',
      'README',
      'résumé.blend',
    ].sort(),
  );
  expect(result.interrupted).toBe(false);
  expect(result.summary).toMatchObject({
    filesFound: 7,
    supportedFound: 3,
    existingGenericFound: 1,
    unsupportedSkipped: 3,
    processed: 0,
    succeeded: 0,
    readErrors: 0,
    symlinksSkipped: 0,
    specialEntriesSkipped: 0,
    otherExtensionFiles: 0,
    omittedErrors: 0,
    errors: [],
  });
  expect(
    result.summary.extensions.find((row) => row.extension === '.blend'),
  ).toMatchObject({
    found: 1,
    supported: 0,
    existingGeneric: 1,
    skipped: 0,
    readErrors: 0,
  });
  expect(
    result.summary.extensions.find((row) => row.extension === ''),
  ).toMatchObject({ found: 1, skipped: 1 });
});

it('recognizes only the existing format set case-insensitively', () => {
  for (const ext of [
    'png',
    'jpg',
    'jpeg',
    'jpe',
    'jfif',
    'webp',
    'gif',
    'svg',
    'avif',
    'psd',
    'pdf',
    'glb',
    'obj',
    'mp4',
    'mov',
    'ttf',
    'otf',
    'woff',
    'woff2',
  ])
    expect(shouldAutoImport(`设计.${ext.toUpperCase()}`)).toBe(true);
  for (const name of [
    'design.tif',
    'movie.avi',
    'raw.heic',
    'scene.blend',
    'readme',
    '.png',
    'image.png.exe',
  ])
    expect(shouldAutoImport(name)).toBe(false);
});

it('returns an explicit empty completed result for an empty readable root', async () => {
  const result = await discoverFiles(await root(), []);
  expect(result).toMatchObject({
    files: [],
    presentRelativePaths: [],
    interrupted: false,
    summary: {
      filesFound: 0,
      supportedFound: 0,
      unsupportedSkipped: 0,
      processed: 0,
      succeeded: 0,
      readErrors: 0,
      extensions: [],
      errors: [],
    },
  });
});

it('never opens unknown unsupported files and retains their presence for reconciliation', async () => {
  const directory = await root();
  await file(directory, 'large.unknown');
  const open = vi.spyOn(fs, 'open');
  const readFile = vi.spyOn(fs, 'readFile');
  const result = await discoverFiles(directory, []);
  expect(result.files).toEqual([]);
  expect(result.presentRelativePaths).toEqual(['large.unknown']);
  expect(result.summary.unsupportedSkipped).toBe(1);
  expect(open).not.toHaveBeenCalled();
  expect(readFile).not.toHaveBeenCalled();
});

it.skipIf(process.platform === 'win32')(
  'does not follow file or directory symlinks and counts special files separately',
  async () => {
    const directory = await root(),
      outside = await root();
    await file(outside, 'hidden.png');
    await fs.symlink(outside, path.join(directory, 'linked-folder'));
    await fs.symlink(
      path.join(outside, 'hidden.png'),
      path.join(directory, 'linked.png'),
    );
    execFileSync('mkfifo', [path.join(directory, 'pipe.png')]);
    const result = await discoverFiles(directory, []);
    expect(result.files).toEqual([]);
    expect(result.summary).toMatchObject({
      filesFound: 0,
      symlinksSkipped: 2,
      specialEntriesSkipped: 1,
      readErrors: 0,
    });
  },
);

it('rejects missing roots and regular files before returning a misleading empty success', async () => {
  const directory = await root();
  const regular = await file(directory, 'file.png');
  await expect(
    discoverFiles(path.join(directory, 'missing'), []),
  ).rejects.toMatchObject({ code: 'ENOENT' });
  await expect(discoverFiles(regular, [])).rejects.toMatchObject({
    code: 'ENOTDIR',
  });
});

it.skipIf(process.platform === 'win32')(
  'rejects a registered root replaced by a symlink',
  async () => {
    const directory = await root(),
      linked = path.join(directory, 'linked');
    await fs.symlink(await root(), linked);
    await expect(discoverFiles(linked, [])).rejects.toMatchObject({
      code: 'ROOT_CHANGED',
    });
  },
);

it('reports denied descendants without discarding successful files or leaking OS messages', async () => {
  const directory = await root();
  const visible = await file(directory, 'visible.png');
  await file(directory, 'private/hidden.png');
  const real = fs.readdir.bind(fs);
  vi.spyOn(fs, 'readdir').mockImplementation(
    async (...args: Parameters<typeof fs.readdir>) => {
      if (String(args[0]) === path.join(directory, 'private'))
        throw Object.assign(
          new Error(`permission denied ${directory}/private`),
          { code: 'EACCES' },
        );
      return real(...args);
    },
  );
  const result = await discoverFiles(directory, []);
  expect(result.files).toEqual([visible]);
  expect(result.summary.readErrors).toBe(1);
  expect(result.summary.errors).toEqual([
    { relativePath: 'private', stage: 'enumerate', code: 'EACCES' },
  ]);
  expect(JSON.stringify(result.summary)).not.toContain(directory);
  expect(JSON.stringify(result.summary)).not.toContain('permission denied');
});

it('caps extension rows and aggregates every excess extension without losing counts', async () => {
  const directory = await root();
  await Promise.all(
    Array.from({ length: 72 }, (_, index) =>
      file(directory, `asset.ext${String(index).padStart(3, '0')}`),
    ),
  );
  const result = await discoverFiles(directory, []),
    summary = result.summary;
  expect(summary.filesFound).toBe(72);
  expect(summary.unsupportedSkipped).toBe(72);
  expect(summary.extensions).toHaveLength(64);
  expect(summary.otherExtensionFiles).toBe(8);
  expect(
    summary.extensions.reduce((sum, row) => sum + row.found, 0) +
      summary.otherExtensionFiles,
  ).toBe(summary.filesFound);
});

it('caps error details while retaining exact totals and sanitizes unknown error codes', async () => {
  const directory = await root();
  await Promise.all(
    Array.from({ length: 53 }, (_, index) =>
      fs.mkdir(path.join(directory, `dir${index}`)),
    ),
  );
  const real = fs.readdir.bind(fs);
  vi.spyOn(fs, 'readdir').mockImplementation(
    async (...args: Parameters<typeof fs.readdir>) => {
      if (String(args[0]) !== directory)
        throw Object.assign(new Error(`secret ${directory}`), {
          code: String(args[0]).endsWith('dir0') ? 'PRIVATE_SECRET' : 'EIO',
        });
      return real(...args);
    },
  );
  const summary = (await discoverFiles(directory, [])).summary;
  expect(summary.readErrors).toBe(53);
  expect(summary.errors).toHaveLength(50);
  expect(summary.omittedErrors).toBe(3);
  expect(
    summary.errors.find((error) => error.relativePath === 'dir0')?.code,
  ).toBe('SCAN_READ_FAILED');
  expect(JSON.stringify(summary)).not.toContain('PRIVATE_SECRET');
  expect(JSON.stringify(summary)).not.toContain(directory);
});

it('marks cancellation as interrupted instead of publishing a completed empty scan', async () => {
  const directory = await root();
  await file(directory, 'visible.png');
  const result = await discoverFiles(directory, [], () => true);
  expect(result.interrupted).toBe(true);
  expect(result.files).toEqual([]);
  expect(result.summary.readErrors).toBe(0);
});

it.skipIf(process.platform === 'win32')(
  'reports nonportable file and directory names without aborting other discoveries',
  async () => {
    const directory = await root();
    const good = await file(directory, 'good.png');
    await file(directory, 'bad:name.png');
    await file(directory, 'bad:folder/hidden.png');
    const result = await discoverFiles(directory, []);
    expect(result.files).toEqual([good]);
    expect(result.summary.readErrors).toBe(2);
    expect(result.summary.errors.map((error) => error.stage).sort()).toEqual([
      'enumerate',
      'read',
    ]);
    expect(
      result.summary.errors.every((error) => error.relativePath === null),
    ).toBe(true);
  },
);

it('yields during a large directory so a worker shutdown signal can interrupt discovery', async () => {
  const directory = await root();
  await Promise.all(
    Array.from({ length: 600 }, (_, index) => file(directory, `${index}.png`)),
  );
  let cancelled = false;
  const real = fs.readdir.bind(fs);
  vi.spyOn(fs, 'readdir').mockImplementation(
    async (...args: Parameters<typeof fs.readdir>) => {
      const entries = await real(...args);
      setImmediate(() => {
        cancelled = true;
      });
      return entries;
    },
  );
  const result = await discoverFiles(directory, [], () => cancelled);
  expect(result.interrupted).toBe(true);
  expect(result.files.length).toBeGreaterThan(0);
  expect(result.files.length).toBeLessThan(600);
});

it.skipIf(process.platform === 'win32')(
  'rechecks descendants replaced by symlinks after the parent was enumerated',
  async () => {
    const directory = await root(),
      outside = await root();
    await file(directory, 'child/inside.png');
    await file(outside, 'outside.png');
    const real = fs.readdir.bind(fs);
    vi.spyOn(fs, 'readdir').mockImplementation(
      async (...args: Parameters<typeof fs.readdir>) => {
        const entries = await real(...args);
        if (String(args[0]) === directory) {
          await fs.rename(
            path.join(directory, 'child'),
            path.join(directory, 'moved'),
          );
          await fs.symlink(outside, path.join(directory, 'child'));
        }
        return entries;
      },
    );
    const result = await discoverFiles(directory, []);
    expect(result.files).toEqual([]);
    expect(result.summary.symlinksSkipped).toBe(1);
  },
);

it('bounds very long error paths and validates long and unrepresentable extension statistics', async () => {
  const directory = await root();
  const nested = Array.from({ length: 35 }, () => '深'.repeat(30)).join('/');
  await fs.mkdir(path.join(directory, nested), { recursive: true });
  await file(directory, `name.${'a'.repeat(200)}`);
  await file(directory, 'trailing.');
  const real = fs.readdir.bind(fs);
  vi.spyOn(fs, 'readdir').mockImplementation(
    async (...args: Parameters<typeof fs.readdir>) => {
      if (String(args[0]) === path.join(directory, nested))
        throw Object.assign(new Error('Unavailable'), { code: 'EACCES' });
      return real(...args);
    },
  );
  const result = await discoverFiles(directory, []);
  expect(result.summary.errors).toEqual([
    { relativePath: null, stage: 'enumerate', code: 'EACCES' },
  ]);
  expect(result.summary.extensions[0]?.extension).toBe(`.${'a'.repeat(200)}`);
  expect(result.summary.otherExtensionFiles).toBe(1);
  for (const row of result.summary.extensions)
    expect(ScanExtensionSchema.safeParse(row).success).toBe(true);
  for (const error of result.summary.errors)
    expect(ScanErrorSchema.safeParse(error).success).toBe(true);
});

it('throws denied root enumeration so the service records failure instead of partial success', async () => {
  const directory = await root();
  vi.spyOn(fs, 'readdir').mockRejectedValue(
    Object.assign(new Error('Root denied'), { code: 'EACCES' }),
  );
  await expect(discoverFiles(directory, [])).rejects.toMatchObject({
    code: 'EACCES',
  });
});
