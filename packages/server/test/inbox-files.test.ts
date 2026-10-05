import { randomUUID } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import fs from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import {
  chooseInboxMigrationPath,
  cleanupInboxMigration,
  createInboxUpload,
  ensureInboxRoot,
  inspectInboxFile,
  localDate,
  publishInboxMigration,
} from '../src/media/inbox-files.js';
import type { InboxMigration } from '../src/media/inbox-migration-store.js';

const directories: string[] = [];
const date = new Date(2026, 9, 5, 12);
async function root() {
  const directory = await fs.mkdtemp(join(tmpdir(), 'cura-inbox-files-'));
  directories.push(directory);
  return fs.realpath(directory);
}
async function plan(directory: string, bytes = Buffer.from('original bytes')) {
  const oldRelativePath = `${randomUUID()}/picture.png`;
  await fs.mkdir(join(directory, oldRelativePath, '..'));
  await fs.writeFile(join(directory, oldRelativePath), bytes);
  const now = date.toISOString();
  return {
    id: randomUUID(),
    sourceId: randomUUID(),
    assetId: randomUUID(),
    libraryId: randomUUID(),
    rootId: randomUUID(),
    oldRelativePath,
    oldActualRelativePath: oldRelativePath,
    newRelativePath: await chooseInboxMigrationPath(
      directory,
      'picture.png',
      date,
    ),
    lastHash: 'catalog hash may be older than actual bytes',
    sourceAvailable: true,
    sourceCreatedAt: now,
    sourceUpdatedAt: now,
    observed: await inspectInboxFile(directory, oldRelativePath),
    target: null,
    state: 'planned',
    createdAt: now,
    updatedAt: now,
  } satisfies InboxMigration;
}
afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(
    directories
      .splice(0)
      .map((directory) => fs.rm(directory, { recursive: true, force: true })),
  );
});

it('uses local calendar fields rather than the UTC day', () => {
  const value = new Date('2026-10-05T00:30:00Z');
  vi.spyOn(value, 'getFullYear').mockReturnValue(2026);
  vi.spyOn(value, 'getMonth').mockReturnValue(9);
  vi.spyOn(value, 'getDate').mockReturnValue(4);
  expect(localDate(value)).toBe('2026-10-04');
});

it('creates the managed Inbox beneath canonical data and rejects symlink segments', async () => {
  const data = await root();
  const library = randomUUID();
  expect(await ensureInboxRoot(data, library)).toBe(
    join(data, 'libraries', library, 'Inbox'),
  );
  const other = await root();
  await fs.symlink(other, join(data, 'libraries', 'linked'));
  await expect(ensureInboxRoot(data, 'linked')).rejects.toMatchObject({
    code: 'UNSAFE_PATH',
  });
  await expect(ensureInboxRoot(data, '../escape')).rejects.toMatchObject({
    code: 'INVALID_PATH',
  });
});

it('stores parsed NFC names in a date directory without a suffix when free', async () => {
  const directory = await root();
  const result = await createInboxUpload(
    directory,
    '  cafe\u0301.png  ',
    Buffer.from('bytes'),
    date,
  );
  expect(result.relativePath).toBe('2026-10-05/café.png');
  expect(await fs.readFile(result.absolutePath, 'utf8')).toBe('bytes');
});

it('preserves a valid long extension when the complete basename fits', async () => {
  const directory = await root();
  const name = `asset.${'x'.repeat(100)}`;
  const result = await createInboxUpload(
    directory,
    name,
    Buffer.from('bytes'),
    date,
  );
  expect(basename(result.absolutePath)).toBe(name);
});

it('reserves a migration name even when the pending target is not on disk', async () => {
  const directory = await root();
  const result = await chooseInboxMigrationPath(directory, 'café.png', date, [
    '2026-10-05/CAFE\u0301.PNG',
  ]);
  expect(result).toMatch(/^2026-10-05\/café-[a-f0-9]{8}\.png$/);
  expect(await fs.readdir(join(directory, '2026-10-05'))).toEqual([]);
});

it('uploads under a suffix when the unsuffixed path is reserved but not on disk', async () => {
  const directory = await root();
  const result = await createInboxUpload(
    directory,
    'picture.png',
    Buffer.from('upload'),
    date,
    undefined,
    ['2026-10-05\\PICTURE.PNG'],
  );
  expect(result.relativePath).toMatch(/^2026-10-05\/picture-[a-f0-9]{8}\.png$/);
  expect(await fs.readFile(result.absolutePath, 'utf8')).toBe('upload');
});

it('ignores reservations from another date when the requested basename is free', async () => {
  const directory = await root();
  expect(
    await chooseInboxMigrationPath(directory, 'picture.png', date, [
      '2026-10-04/picture.png',
    ]),
  ).toBe('2026-10-05/picture.png');
});

it('remembers an exclusive-open collision even when the directory listing stays empty', async () => {
  const directory = await root();
  vi.spyOn(fs, 'open').mockRejectedValueOnce(
    Object.assign(new Error('exists'), { code: 'EEXIST' }),
  );
  const result = await createInboxUpload(
    directory,
    'picture.png',
    Buffer.from('upload'),
    date,
  );
  expect(result.relativePath).toMatch(/^2026-10-05\/picture-[a-f0-9]{8}\.png$/);
  expect(await fs.readFile(result.absolutePath, 'utf8')).toBe('upload');
});

it('preserves disk-full guidance without exposing the original filesystem error message', async () => {
  const directory = await root();
  vi.spyOn(fs, 'open').mockRejectedValueOnce(
    Object.assign(new Error('private path canary'), { code: 'ENOSPC' }),
  );
  await expect(
    createInboxUpload(directory, 'picture.png', Buffer.from('upload'), date),
  ).rejects.toMatchObject({
    code: 'ENOSPC',
    message: 'Inbox operation failed: ENOSPC',
  });
});

it('uses Unicode case folding for portable collision detection', async () => {
  const directory = await root();
  await createInboxUpload(directory, 'STRASSE.png', Buffer.from('first'), date);
  const result = await createInboxUpload(
    directory,
    'straße.png',
    Buffer.from('second'),
    date,
  );
  expect(result.relativePath).toMatch(/straße-[a-f0-9]{8}\.png$/);
});

it('removes only its owned incomplete upload when cancelled after reservation', async () => {
  const directory = await root();
  let calls = 0;
  await expect(
    createInboxUpload(
      directory,
      'cancelled.png',
      Buffer.from('bytes'),
      date,
      () => ++calls > 1,
    ),
  ).rejects.toMatchObject({ code: 'STOPPED' });
  expect(await fs.readdir(join(directory, '2026-10-05'))).toEqual([]);
});

it('suffixes exact, case-folded and canonical collisions without modifying existing bytes', async () => {
  const directory = await root();
  await fs.mkdir(join(directory, '2026-10-05'));
  await fs.writeFile(
    join(directory, '2026-10-05', 'CAFE\u0301.PNG'),
    'foreign',
  );
  const results = await Promise.all(
    Array.from({ length: 5 }, () =>
      createInboxUpload(directory, 'café.png', Buffer.from('new'), date),
    ),
  );
  expect(new Set(results.map((result) => result.relativePath)).size).toBe(5);
  for (const result of results)
    expect(result.relativePath).toMatch(/^2026-10-05\/café-[a-f0-9]{8}\.png$/);
  expect(
    await fs.readFile(join(directory, '2026-10-05', 'CAFE\u0301.PNG'), 'utf8'),
  ).toBe('foreign');
});

it('keeps each UTF-8 filename within 255 bytes including a collision suffix', async () => {
  const directory = await root();
  const name = `${'中'.repeat(83)}.png`;
  const first = await createInboxUpload(
    directory,
    name,
    Buffer.from('one'),
    date,
  );
  const second = await createInboxUpload(
    directory,
    name,
    Buffer.from('two'),
    date,
  );
  expect(Buffer.byteLength(basename(first.absolutePath))).toBeLessThanOrEqual(
    255,
  );
  expect(Buffer.byteLength(basename(second.absolutePath))).toBeLessThanOrEqual(
    255,
  );
  expect(second.relativePath).toMatch(/-[a-f0-9]{8}\.png$/);
});

it('rejects traversal and a date-directory symlink without writing outside the root', async () => {
  const directory = await root();
  const outside = await root();
  await fs.symlink(outside, join(directory, '2026-10-05'));
  await expect(
    createInboxUpload(directory, 'safe.png', Buffer.from('new'), date),
  ).rejects.toMatchObject({ code: 'UNSAFE_PATH' });
  await expect(
    createInboxUpload(directory, '../escape.png', Buffer.from('new'), date),
  ).rejects.toMatchObject({ code: 'INVALID_PATH' });
  expect(await fs.readdir(outside)).toEqual([]);
});

it('rejects an overlong UTF-8 basename instead of silently renaming the first upload', async () => {
  const directory = await root();
  await expect(
    createInboxUpload(
      directory,
      `${'中'.repeat(100)}.png`,
      Buffer.from('bytes'),
      date,
    ),
  ).rejects.toMatchObject({ code: 'INVALID_PATH' });
  expect(await fs.readdir(directory)).toEqual([]);
});

it('publishes with an exclusive hard link and resumes before the journal write', async () => {
  const directory = await root();
  const migration = await plan(directory);
  const first = await publishInboxMigration(directory, migration);
  expect(first.state).toBe('published');
  expect(first.target).toMatchObject({
    hash: migration.observed.hash,
    dev: migration.observed.dev,
    ino: migration.observed.ino,
  });
  expect(await publishInboxMigration(directory, migration)).toEqual(first);
  expect(
    await fs.readFile(join(directory, migration.oldActualRelativePath), 'utf8'),
  ).toBe('original bytes');
});

it('never adopts or overwrites a same-hash foreign destination', async () => {
  const directory = await root();
  const migration = await plan(directory);
  await fs.writeFile(
    join(directory, migration.newRelativePath),
    'original bytes',
  );
  await expect(
    publishInboxMigration(directory, migration),
  ).rejects.toMatchObject({ code: 'COLLISION' });
  expect(
    await fs.readFile(join(directory, migration.newRelativePath), 'utf8'),
  ).toBe('original bytes');
});

it('migrates physical nested files addressed by a legacy Windows path', async () => {
  const directory = await root();
  const migration = await plan(directory);
  const legacy = {
    ...migration,
    oldActualRelativePath: migration.oldActualRelativePath.replaceAll(
      '/',
      '\\',
    ),
  };
  const published = await publishInboxMigration(directory, legacy);
  expect(published.target.hash).toBe(migration.observed.hash);
  await cleanupInboxMigration(directory, {
    ...legacy,
    ...published,
    state: 'relocated',
  });
  expect(await fs.readdir(directory)).toEqual(['2026-10-05']);
});

it('detects changed source bytes without trusting the catalog hash', async () => {
  const directory = await root();
  const migration = await plan(directory);
  await fs.writeFile(
    join(directory, migration.oldActualRelativePath),
    'changed bytes',
  );
  await expect(
    publishInboxMigration(directory, migration),
  ).rejects.toMatchObject({ code: 'SOURCE_CHANGED' });
  await expect(
    fs.stat(join(directory, migration.newRelativePath)),
  ).rejects.toMatchObject({ code: 'ENOENT' });
});

it('rejects source and target symlinks, including links contained within the root', async () => {
  const directory = await root();
  const migration = await plan(directory);
  await fs.symlink(
    join(directory, migration.oldActualRelativePath),
    join(directory, migration.newRelativePath),
  );
  await expect(
    publishInboxMigration(directory, migration),
  ).rejects.toMatchObject({ code: 'UNSAFE_PATH' });
  await fs.unlink(join(directory, migration.newRelativePath));
  await fs.symlink(
    join(directory, migration.oldActualRelativePath),
    join(directory, 'alias.png'),
  );
  await expect(inspectInboxFile(directory, 'alias.png')).rejects.toMatchObject({
    code: 'UNSAFE_PATH',
  });
});

it('retains the original on a locked publication error and allows retry', async () => {
  const directory = await root();
  const migration = await plan(directory);
  const link = vi
    .spyOn(fs, 'link')
    .mockRejectedValueOnce(
      Object.assign(new Error('locked'), { code: 'EPERM' }),
    );
  await expect(
    publishInboxMigration(directory, migration),
  ).rejects.toMatchObject({ code: 'EPERM' });
  expect(
    await fs.readFile(join(directory, migration.oldActualRelativePath), 'utf8'),
  ).toBe('original bytes');
  link.mockRestore();
  expect((await publishInboxMigration(directory, migration)).state).toBe(
    'published',
  );
});

it('reserves an owned copy target and recovers the reservation before the journal write', async () => {
  const directory = await root();
  const migration = await plan(directory);
  vi.spyOn(fs, 'link').mockRejectedValue(
    Object.assign(new Error('unsupported'), { code: 'EXDEV' }),
  );
  const reserved = await publishInboxMigration(directory, migration);
  expect(reserved.state).toBe('reserved');
  expect(reserved.target.ino).not.toBe(migration.observed.ino);
  expect(await publishInboxMigration(directory, migration)).toEqual(reserved);
  const published = await publishInboxMigration(directory, {
    ...migration,
    ...reserved,
  });
  expect(published.state).toBe('published');
  expect(published.target.hash).toBe(migration.observed.hash);
  expect(
    await fs.readFile(join(directory, migration.newRelativePath), 'utf8'),
  ).toBe('original bytes');
});

it('resumes a partial copy only through its durable reserved inode', async () => {
  const directory = await root();
  const bytes = Buffer.alloc(1024 * 1024, 7);
  const migration = await plan(directory, bytes);
  vi.spyOn(fs, 'link').mockRejectedValue(
    Object.assign(new Error('unsupported'), { code: 'ENOTSUP' }),
  );
  const reserved = await publishInboxMigration(directory, migration);
  const journal = { ...migration, ...reserved };
  let checks = 0;
  await expect(
    publishInboxMigration(directory, journal, () => ++checks > 5),
  ).rejects.toMatchObject({ code: 'STOPPED' });
  const targetPath = join(directory, migration.newRelativePath);
  const partial = await fs.readFile(targetPath);
  const partialInfo = await fs.stat(targetPath, { bigint: true });
  expect(partial.length).toBeGreaterThan(0);
  expect(partial.length).toBeLessThan(bytes.length);
  expect(partial.equals(bytes.subarray(0, partial.length))).toBe(true);
  expect(String(partialInfo.dev)).toBe(reserved.target.dev);
  expect(String(partialInfo.ino)).toBe(reserved.target.ino);
  const published = await publishInboxMigration(directory, journal);
  expect(published.target.hash).toBe(migration.observed.hash);
  expect((await fs.readFile(targetPath)).equals(bytes)).toBe(true);
});

it('never truncates a replacement of a reserved copy target', async () => {
  const directory = await root();
  const migration = await plan(directory);
  vi.spyOn(fs, 'link').mockRejectedValue(
    Object.assign(new Error('unsupported'), { code: 'EOPNOTSUPP' }),
  );
  const reserved = await publishInboxMigration(directory, migration);
  await fs.rename(
    join(directory, migration.newRelativePath),
    join(directory, 'kept-reservation'),
  );
  await fs.writeFile(
    join(directory, migration.newRelativePath),
    'foreign target',
  );
  await expect(
    publishInboxMigration(directory, { ...migration, ...reserved }),
  ).rejects.toMatchObject({ code: 'TARGET_CHANGED' });
  expect(
    await fs.readFile(join(directory, migration.newRelativePath), 'utf8'),
  ).toBe('foreign target');
});

it('preserves same-inode user edits after a complete copy but before publication was journaled', async () => {
  const directory = await root();
  const migration = await plan(directory);
  vi.spyOn(fs, 'link').mockRejectedValue(
    Object.assign(new Error('unsupported'), { code: 'EXDEV' }),
  );
  const reserved = await publishInboxMigration(directory, migration);
  const journal = { ...migration, ...reserved };
  await publishInboxMigration(directory, journal);
  await fs.writeFile(
    join(directory, migration.newRelativePath),
    'USER EDIT AFTER CRASH',
  );
  await expect(publishInboxMigration(directory, journal)).rejects.toMatchObject(
    { code: 'TARGET_CHANGED' },
  );
  expect(
    await fs.readFile(join(directory, migration.newRelativePath), 'utf8'),
  ).toBe('USER EDIT AFTER CRASH');
  expect(
    await fs.readFile(join(directory, migration.oldActualRelativePath), 'utf8'),
  ).toBe('original bytes');
});

it('preserves non-prefix content written into the owned reservation inode', async () => {
  const directory = await root();
  const migration = await plan(directory);
  vi.spyOn(fs, 'link').mockRejectedValue(
    Object.assign(new Error('unsupported'), { code: 'EXDEV' }),
  );
  const reserved = await publishInboxMigration(directory, migration);
  await fs.writeFile(join(directory, migration.newRelativePath), 'changed');
  await expect(
    publishInboxMigration(directory, { ...migration, ...reserved }),
  ).rejects.toMatchObject({ code: 'TARGET_CHANGED' });
  expect(
    await fs.readFile(join(directory, migration.newRelativePath), 'utf8'),
  ).toBe('changed');
});

it('recognizes a complete copy after a crash without rewriting its bytes', async () => {
  const directory = await root();
  const migration = await plan(directory);
  vi.spyOn(fs, 'link').mockRejectedValue(
    Object.assign(new Error('unsupported'), { code: 'EXDEV' }),
  );
  const reserved = await publishInboxMigration(directory, migration);
  const journal = { ...migration, ...reserved };
  const published = await publishInboxMigration(directory, journal);
  expect(await publishInboxMigration(directory, journal)).toEqual(published);
});

it('rejects source changes during fallback copying and keeps the original path', async () => {
  const directory = await root();
  const migration = await plan(directory, Buffer.alloc(128 * 1024, 7));
  vi.spyOn(fs, 'link').mockRejectedValue(
    Object.assign(new Error('unsupported'), { code: 'EXDEV' }),
  );
  const reserved = await publishInboxMigration(directory, migration);
  let checks = 0;
  await expect(
    publishInboxMigration(directory, { ...migration, ...reserved }, () => {
      if (++checks === 3)
        writeFileSync(
          join(directory, migration.oldActualRelativePath),
          'changed during copy',
        );
      return false;
    }),
  ).rejects.toMatchObject({ code: 'SOURCE_CHANGED' });
  expect(
    await fs.readFile(join(directory, migration.oldActualRelativePath), 'utf8'),
  ).toBe('changed during copy');
});

it('publishes an owned hard link after reobservation without truncating its source', async () => {
  const directory = await root();
  const migration = await plan(directory);
  const published = await publishInboxMigration(directory, migration);
  await fs.writeFile(
    join(directory, migration.oldActualRelativePath),
    'external edit',
  );
  const observed = await inspectInboxFile(
    directory,
    migration.oldActualRelativePath,
  );
  const result = await publishInboxMigration(directory, {
    ...migration,
    ...published,
    observed,
    state: 'reserved',
  });
  expect(result.target.hash).toBe(observed.hash);
  expect(
    await fs.readFile(join(directory, migration.oldActualRelativePath), 'utf8'),
  ).toBe('external edit');
});

it('refuses an ambiguous partial reservation marker and preserves both files', async () => {
  const directory = await root();
  const migration = await plan(directory);
  await fs.writeFile(
    join(directory, migration.newRelativePath),
    `CURA-INBOX-MIGRATION\n${migration.id.slice(0, 6)}`,
  );
  await expect(
    publishInboxMigration(directory, migration),
  ).rejects.toMatchObject({ code: 'TARGET_CHANGED' });
  expect(
    await fs.readFile(join(directory, migration.oldActualRelativePath), 'utf8'),
  ).toBe('original bytes');
});

it('retains the journal destination when a crash left an unproven empty reservation', async () => {
  const directory = await root();
  const migration = await plan(directory);
  await fs.writeFile(join(directory, migration.newRelativePath), '');
  await expect(
    publishInboxMigration(directory, migration),
  ).rejects.toMatchObject({ code: 'TARGET_CHANGED' });
  expect(
    await fs.readFile(join(directory, migration.oldActualRelativePath), 'utf8'),
  ).toBe('original bytes');
  expect((await fs.stat(join(directory, migration.newRelativePath))).size).toBe(
    0,
  );
});

it('cleans only after relocation, preserving unrelated entries in the old UUID directory', async () => {
  const directory = await root();
  const migration = await plan(directory);
  const published = await publishInboxMigration(directory, migration);
  await expect(
    cleanupInboxMigration(directory, { ...migration, ...published }),
  ).rejects.toMatchObject({ code: 'INVALID_STATE' });
  const oldDirectory = join(directory, migration.oldActualRelativePath, '..');
  await fs.writeFile(join(oldDirectory, 'unrelated.txt'), 'keep');
  await cleanupInboxMigration(directory, {
    ...migration,
    ...published,
    state: 'relocated',
  });
  await expect(
    fs.stat(join(directory, migration.oldActualRelativePath)),
  ).rejects.toMatchObject({ code: 'ENOENT' });
  expect(await fs.readdir(oldDirectory)).toEqual(['unrelated.txt']);
  expect(
    await fs.readFile(join(directory, migration.newRelativePath), 'utf8'),
  ).toBe('original bytes');
});

it('recovers an already removed old path using the journal-owned valid target', async () => {
  const directory = await root();
  const migration = await plan(directory);
  const published = await publishInboxMigration(directory, migration);
  await fs.unlink(join(directory, migration.oldActualRelativePath));
  expect(
    (await publishInboxMigration(directory, { ...migration, ...published }))
      .state,
  ).toBe('published');
  await cleanupInboxMigration(directory, {
    ...migration,
    ...published,
    state: 'relocated',
  });
  expect(await fs.readdir(directory)).toEqual(['2026-10-05']);
});

it('refuses cleanup when the original was changed or replaced after publication', async () => {
  const directory = await root();
  const migration = await plan(directory);
  const published = await publishInboxMigration(directory, migration);
  await fs.rename(
    join(directory, migration.oldActualRelativePath),
    join(directory, 'kept-original'),
  );
  await fs.writeFile(
    join(directory, migration.oldActualRelativePath),
    'new original',
  );
  await expect(
    cleanupInboxMigration(directory, {
      ...migration,
      ...published,
      state: 'relocated',
    }),
  ).rejects.toMatchObject({ code: 'SOURCE_CHANGED' });
  expect(
    await fs.readFile(join(directory, migration.oldActualRelativePath), 'utf8'),
  ).toBe('new original');
});

it('keeps both byte-identical paths on a locked cleanup failure and retries safely', async () => {
  const directory = await root();
  const migration = await plan(directory);
  const published = await publishInboxMigration(directory, migration);
  const journal = { ...migration, ...published, state: 'relocated' as const };
  vi.spyOn(fs, 'unlink').mockRejectedValueOnce(
    Object.assign(new Error('locked'), { code: 'EPERM' }),
  );
  await expect(cleanupInboxMigration(directory, journal)).rejects.toMatchObject(
    { code: 'EPERM' },
  );
  expect(
    await fs.readFile(join(directory, migration.oldActualRelativePath), 'utf8'),
  ).toBe('original bytes');
  expect(
    await fs.readFile(join(directory, migration.newRelativePath), 'utf8'),
  ).toBe('original bytes');
  await cleanupInboxMigration(directory, journal);
  expect(await fs.readdir(directory)).toEqual(['2026-10-05']);
});
