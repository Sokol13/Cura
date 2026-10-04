import {
  mkdtemp,
  mkdir,
  realpath,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import {
  normalizeRelativePath,
  resolveContained,
} from '../src/media/path-utils.js';

const tempDirs: string[] = [];
async function tempDir() {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'cura-path-'));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
  );
});

describe('media paths', () => {
  it('normalizes slash and Unicode spelling for database identity', () => {
    expect(normalizeRelativePath('素材\\咖啡e\u0301.png')).toBe(
      '素材/咖啡é.png',
    );
    expect(normalizeRelativePath('素材/咖啡é.png')).toBe('素材/咖啡é.png');
  });

  it.each([
    '../secret',
    'a/../../secret',
    'a/../secret',
    '/etc/passwd',
    'C:\\secret',
    '\\\\server\\secret',
    'a\0b',
    '',
    '.',
    'a//b',
  ])('rejects unsafe relative path %j', (value) => {
    expect(() => normalizeRelativePath(value)).toThrow(/relative|path/i);
  });

  it('preserves real on-disk NFD spelling when resolving inside a root', async () => {
    const root = await tempDir();
    await mkdir(path.join(root, '素材'));
    const actual = path.join('素材', '咖啡e\u0301.png');
    await writeFile(path.join(root, actual), 'real bytes');
    expect(await resolveContained(root, actual)).toBe(
      await realpath(path.join(root, actual)),
    );
    expect(normalizeRelativePath(actual)).toBe('素材/咖啡é.png');
  });

  it('rejects a symlink whose real target escapes its registered root', async () => {
    const root = await tempDir();
    const outside = await tempDir();
    await writeFile(path.join(outside, 'secret.png'), 'secret');
    await symlink(
      outside,
      path.join(root, 'escape'),
      process.platform === 'win32' ? 'junction' : 'dir',
    );
    await expect(resolveContained(root, 'escape/secret.png')).rejects.toThrow(
      /outside|contain|escape/i,
    );
  });

  it('allows a contained symlink but rejects prefix-neighbor directories', async () => {
    const root = await tempDir();
    await mkdir(path.join(root, 'actual'));
    await writeFile(path.join(root, 'actual', 'image.png'), 'data');
    await symlink(
      path.join(root, 'actual'),
      path.join(root, 'alias'),
      process.platform === 'win32' ? 'junction' : 'dir',
    );
    expect(await resolveContained(root, 'alias/image.png')).toBe(
      await realpath(path.join(root, 'actual', 'image.png')),
    );
    await expect(resolveContained(root, '../outside.png')).rejects.toThrow(
      /relative|path/i,
    );
  });
});
