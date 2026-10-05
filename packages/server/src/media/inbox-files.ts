import { createHash, randomBytes } from 'node:crypto';
import { constants, type BigIntStats } from 'node:fs';
import fs, { type FileHandle } from 'node:fs/promises';
import path from 'node:path';
import type {
  InboxFileIdentity,
  InboxMigration,
} from './inbox-migration-store.js';

export type InboxFileErrorCode =
  | 'INVALID_PATH'
  | 'INVALID_STATE'
  | 'UNSAFE_PATH'
  | 'COLLISION'
  | 'SOURCE_CHANGED'
  | 'TARGET_CHANGED'
  | 'MISSING_SOURCE'
  | 'STOPPED'
  | 'EPERM'
  | 'EACCES'
  | 'EBUSY'
  | 'ENOENT'
  | 'ENOTDIR'
  | 'ENOSPC'
  | 'IO';

export class InboxFileError extends Error {
  constructor(readonly code: InboxFileErrorCode) {
    super(`Inbox operation failed: ${code}`);
    this.name = 'InboxFileError';
  }
}

type ShouldStop = (() => boolean) | undefined;
export type InboxPublication = {
  state: 'reserved' | 'published';
  target: InboxFileIdentity;
};

function fail(code: InboxFileErrorCode): never {
  throw new InboxFileError(code);
}
function code(error: unknown): string | undefined {
  return error && typeof error === 'object' && 'code' in error
    ? String(error.code)
    : undefined;
}
async function safely<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (error instanceof InboxFileError) throw error;
    const reason = code(error);
    if (
      reason === 'EPERM' ||
      reason === 'EACCES' ||
      reason === 'EBUSY' ||
      reason === 'ENOENT' ||
      reason === 'ENOTDIR' ||
      reason === 'ENOSPC'
    )
      fail(reason);
    fail(reason === 'ELOOP' ? 'UNSAFE_PATH' : 'IO');
  }
}
function stopped(shouldStop: ShouldStop) {
  if (shouldStop?.()) fail('STOPPED');
}
function parts(relative: string): string[] {
  const portable = relative.replaceAll('\\', '/');
  if (
    !relative ||
    /[\0:]/.test(portable) ||
    path.posix.isAbsolute(portable) ||
    portable.split('/').some((part) => !part || part === '.' || part === '..')
  )
    fail('INVALID_PATH');
  return portable.split('/');
}
async function canonicalRoot(root: string): Promise<string> {
  const absolute = path.resolve(root);
  const info = await fs.lstat(absolute);
  if (!info.isSymbolicLink() && !info.isDirectory()) fail('ENOTDIR');
  if (info.isSymbolicLink() || (await fs.realpath(absolute)) !== absolute)
    fail('UNSAFE_PATH');
  return absolute;
}
async function contained(
  root: string,
  relative: string,
  missingLeaf = false,
): Promise<string> {
  const segments = parts(relative);
  let current = await canonicalRoot(root);
  for (const [index, segment] of segments.entries()) {
    current = path.join(current, segment);
    let info;
    try {
      info = await fs.lstat(current);
    } catch (error) {
      if (
        missingLeaf &&
        index === segments.length - 1 &&
        code(error) === 'ENOENT'
      )
        return current;
      throw error;
    }
    if (info.isSymbolicLink()) fail('UNSAFE_PATH');
    if (index < segments.length - 1 && !info.isDirectory()) fail('ENOTDIR');
  }
  return current;
}
async function directory(root: string, relative: string): Promise<string> {
  let current = await canonicalRoot(root);
  let traversed = '';
  for (const segment of parts(relative)) {
    traversed = traversed ? `${traversed}/${segment}` : segment;
    current = await contained(root, traversed, true);
    try {
      await fs.mkdir(current);
    } catch (error) {
      if (code(error) !== 'EEXIST') throw error;
    }
    current = await contained(root, traversed);
    if (!(await fs.lstat(current)).isDirectory()) fail('ENOTDIR');
  }
  return current;
}

export async function ensureInboxRoot(
  dataDir: string,
  libraryId: string,
): Promise<string> {
  return safely(async () => {
    if (parts(libraryId).length !== 1) fail('INVALID_PATH');
    const root = await fs.realpath(dataDir);
    return directory(root, `libraries/${libraryId}/Inbox`);
  });
}

export function localDate(date: Date): string {
  if (!Number.isFinite(date.getTime())) fail('INVALID_PATH');
  return `${String(date.getFullYear()).padStart(4, '0')}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}
function parsedName(name: string): string {
  const parsed = name.trim().normalize('NFC');
  if (
    !parsed ||
    Buffer.byteLength(parsed) > 255 ||
    /[\\/<>:|?*]/.test(parsed) ||
    [...parsed].some((character) => character.charCodeAt(0) < 32) ||
    /[. ]$/.test(parsed) ||
    /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(parsed)
  )
    fail('INVALID_PATH');
  return parsed;
}
function truncate(value: string, limit: number): string {
  let output = '';
  for (const character of value) {
    if (Buffer.byteLength(output) + Buffer.byteLength(character) > limit) break;
    output += character;
  }
  return output;
}
function filename(name: string, suffix = ''): string {
  const originalExtension = path.extname(name);
  const stem = name.slice(0, name.length - originalExtension.length);
  if (Buffer.byteLength(name) + suffix.length <= 255)
    return `${stem}${suffix}${originalExtension}`;
  const extension = truncate(originalExtension, 255 - suffix.length - 4);
  return `${truncate(stem, 255 - Buffer.byteLength(extension) - suffix.length)}${suffix}${extension}`;
}
function folded(name: string): string {
  return name.normalize('NFC').toUpperCase().toLowerCase().normalize('NFC');
}
async function availableName(
  root: string,
  day: string,
  name: string,
  reservedRelativePaths: readonly string[],
): Promise<string> {
  const folder = await directory(root, day);
  const names = new Set((await fs.readdir(folder)).map(folded));
  for (const reserved of reservedRelativePaths) {
    const segments = parts(reserved);
    if (segments.length === 2 && segments[0] === day)
      names.add(folded(segments[1]!));
  }
  let candidate = filename(name);
  while (names.has(folded(candidate)))
    candidate = filename(name, `-${randomBytes(4).toString('hex')}`);
  return `${day}/${candidate}`;
}
export async function chooseInboxMigrationPath(
  root: string,
  name: string,
  date: Date,
  reservedRelativePaths: readonly string[] = [],
): Promise<string> {
  return safely(() =>
    availableName(
      root,
      localDate(date),
      parsedName(name),
      reservedRelativePaths,
    ),
  );
}

export async function createInboxUpload(
  root: string,
  name: string,
  bytes: Buffer,
  date = new Date(),
  shouldStop?: () => boolean,
  reservedRelativePaths: readonly string[] = [],
): Promise<{ absolutePath: string; relativePath: string }> {
  return safely(async () => {
    const parsed = parsedName(name);
    const day = localDate(date);
    const reservations = [...reservedRelativePaths];
    for (;;) {
      stopped(shouldStop);
      const relativePath = await availableName(root, day, parsed, reservations);
      const absolutePath = await contained(root, relativePath, true);
      let handle;
      try {
        handle = await fs.open(
          absolutePath,
          constants.O_WRONLY |
            constants.O_CREAT |
            constants.O_EXCL |
            constants.O_NOFOLLOW,
          0o600,
        );
      } catch (error) {
        if (code(error) === 'EEXIST') {
          // The filesystem is authoritative even when its listing has not
          // exposed a conflicting name (or folds names differently).
          reservations.push(relativePath);
          continue;
        }
        throw error;
      }
      let complete = false;
      try {
        await contained(root, relativePath);
        stopped(shouldStop);
        await handle.writeFile(bytes);
        await handle.sync();
        await contained(root, relativePath);
        complete = true;
        return { absolutePath, relativePath };
      } finally {
        const owned = await handle.stat({ bigint: true });
        await handle.close();
        if (!complete) {
          try {
            const currentPath = await contained(root, relativePath);
            const current = await fs.lstat(currentPath, { bigint: true });
            if (owned.dev === current.dev && owned.ino === current.ino)
              await fs.unlink(currentPath);
          } catch {
            // An inaccessible or replaced pathname is not safe to clean up.
          }
        }
      }
    }
  });
}

function identity(info: BigIntStats, hash: string): InboxFileIdentity {
  return {
    hash,
    dev: String(info.dev),
    ino: String(info.ino),
    size: String(info.size),
    mtimeNs: String(info.mtimeNs),
    ctimeNs: String(info.ctimeNs),
  };
}
function sameInode(
  a: Pick<InboxFileIdentity, 'dev' | 'ino'>,
  b: Pick<InboxFileIdentity, 'dev' | 'ino'>,
): boolean {
  return a.dev === b.dev && a.ino === b.ino;
}
function unchanged(a: BigIntStats, b: BigIntStats): boolean {
  return (
    a.dev === b.dev &&
    a.ino === b.ino &&
    a.size === b.size &&
    a.mtimeNs === b.mtimeNs &&
    a.ctimeNs === b.ctimeNs
  );
}
function expectedSource(
  actual: InboxFileIdentity,
  expected: InboxFileIdentity,
) {
  // Creating/removing a hard link changes ctime without changing the file's contents.
  if (
    !sameInode(actual, expected) ||
    actual.hash !== expected.hash ||
    actual.size !== expected.size ||
    actual.mtimeNs !== expected.mtimeNs
  )
    fail('SOURCE_CHANGED');
}
async function readHandle(
  root: string,
  relative: string,
  flags = constants.O_RDONLY,
): Promise<FileHandle> {
  const file = await contained(root, relative);
  const handle = await fs.open(file, flags | constants.O_NOFOLLOW);
  try {
    const info = await handle.stat({ bigint: true });
    const current = await fs.lstat(await contained(root, relative), {
      bigint: true,
    });
    if (!info.isFile() || !unchanged(info, current)) fail('UNSAFE_PATH');
    return handle;
  } catch (error) {
    await handle.close();
    throw error;
  }
}
async function inspect(
  root: string,
  relative: string,
  shouldStop?: () => boolean,
): Promise<InboxFileIdentity> {
  const handle = await readHandle(root, relative);
  try {
    const before = await handle.stat({ bigint: true });
    const hash = createHash('sha256');
    const buffer = Buffer.allocUnsafe(64 * 1024);
    let position = 0;
    for (;;) {
      stopped(shouldStop);
      const { bytesRead } = await handle.read(
        buffer,
        0,
        buffer.length,
        position,
      );
      if (!bytesRead) break;
      hash.update(buffer.subarray(0, bytesRead));
      position += bytesRead;
    }
    const after = await handle.stat({ bigint: true });
    const current = await fs.lstat(await contained(root, relative), {
      bigint: true,
    });
    if (
      !unchanged(before, after) ||
      !unchanged(before, current) ||
      BigInt(position) !== before.size
    )
      fail('SOURCE_CHANGED');
    return identity(after, hash.digest('hex'));
  } finally {
    await handle.close();
  }
}
export async function inspectInboxFile(
  root: string,
  relativePath: string,
): Promise<InboxFileIdentity> {
  return safely(async () => {
    try {
      return await inspect(root, relativePath);
    } catch (error) {
      if (code(error) === 'ENOENT') fail('MISSING_SOURCE');
      throw error;
    }
  });
}
function validateMigration(migration: InboxMigration) {
  const old = parts(migration.oldActualRelativePath);
  const target = parts(migration.newRelativePath);
  if (
    old.length !== 2 ||
    !/^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(old[0] ?? '') ||
    old.join('/').normalize('NFC') !==
      parts(migration.oldRelativePath).join('/').normalize('NFC') ||
    target.length !== 2 ||
    !/^\d{4}-\d{2}-\d{2}$/.test(target[0] ?? '') ||
    !/^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(migration.id)
  )
    fail('INVALID_PATH');
  parsedName(old[1] ?? '');
  if (
    parsedName(target[1] ?? '') !== target[1] ||
    Buffer.byteLength(target[1] ?? '') > 255
  )
    fail('INVALID_PATH');
}
function marker(migration: InboxMigration): Buffer {
  return Buffer.from(`CURA-INBOX-MIGRATION\n${migration.id}\n`);
}
async function optionalInspect(
  root: string,
  relative: string,
): Promise<InboxFileIdentity | null> {
  try {
    return await inspect(root, relative);
  } catch (error) {
    if (code(error) === 'ENOENT') return null;
    throw error;
  }
}
async function copyReserved(
  root: string,
  migration: InboxMigration,
  shouldStop: ShouldStop,
): Promise<InboxPublication> {
  if (!migration.target) fail('INVALID_STATE');
  const source = await readHandle(root, migration.oldActualRelativePath);
  try {
    const before = await source.stat({ bigint: true });
    expectedSource(
      identity(before, migration.observed.hash),
      migration.observed,
    );
    const target = await readHandle(
      root,
      migration.newRelativePath,
      constants.O_RDWR,
    );
    try {
      const targetInfo = await target.stat({ bigint: true });
      const targetBefore = identity(targetInfo, '');
      if (!sameInode(targetBefore, migration.target)) fail('TARGET_CHANGED');
      // A resumed hard link must never be truncated through its second pathname.
      if (sameInode(targetBefore, migration.observed)) {
        const verified = await inspect(
          root,
          migration.newRelativePath,
          shouldStop,
        );
        expectedSource(verified, migration.observed);
        return { state: 'published', target: verified };
      }
      // Inode ownership alone cannot distinguish an interrupted copy from a
      // subsequent user edit. Only the exact reservation or a source prefix can
      // be resumed; preserve every other byte sequence for manual resolution.
      const reservation = marker(migration);
      let intactMarker = false;
      if (targetInfo.size === BigInt(reservation.length)) {
        const bytes = Buffer.alloc(reservation.length);
        const read = await target.read(bytes, 0, bytes.length, 0);
        intactMarker =
          read.bytesRead === bytes.length && bytes.equals(reservation);
      }
      if (!intactMarker) {
        if (targetInfo.size > before.size) fail('TARGET_CHANGED');
        const expected = Buffer.allocUnsafe(64 * 1024);
        const actual = Buffer.allocUnsafe(64 * 1024);
        let offset = 0;
        while (BigInt(offset) < targetInfo.size) {
          stopped(shouldStop);
          const length = Number(
            targetInfo.size - BigInt(offset) < BigInt(actual.length)
              ? targetInfo.size - BigInt(offset)
              : BigInt(actual.length),
          );
          const a = await target.read(actual, 0, length, offset);
          const b = await source.read(expected, 0, length, offset);
          if (
            a.bytesRead !== length ||
            b.bytesRead !== length ||
            !actual.subarray(0, length).equals(expected.subarray(0, length))
          )
            fail('TARGET_CHANGED');
          offset += length;
        }
      }
      if (!unchanged(before, await source.stat({ bigint: true })))
        fail('SOURCE_CHANGED');
      if (!unchanged(targetInfo, await target.stat({ bigint: true })))
        fail('TARGET_CHANGED');
      if (!intactMarker && targetInfo.size === before.size) {
        const verified = await inspect(
          root,
          migration.newRelativePath,
          shouldStop,
        );
        if (
          !sameInode(verified, migration.target) ||
          verified.hash !== migration.observed.hash
        )
          fail('TARGET_CHANGED');
        return { state: 'published', target: verified };
      }
      stopped(shouldStop);
      await target.truncate(0);
      const hash = createHash('sha256');
      const buffer = Buffer.allocUnsafe(64 * 1024);
      let position = 0;
      for (;;) {
        stopped(shouldStop);
        const { bytesRead } = await source.read(
          buffer,
          0,
          buffer.length,
          position,
        );
        if (!bytesRead) break;
        hash.update(buffer.subarray(0, bytesRead));
        let written = 0;
        while (written < bytesRead) {
          const result = await target.write(
            buffer,
            written,
            bytesRead - written,
            position + written,
          );
          if (!result.bytesWritten) fail('IO');
          written += result.bytesWritten;
        }
        position += bytesRead;
      }
      const after = await source.stat({ bigint: true });
      const current = await fs.lstat(
        await contained(root, migration.oldActualRelativePath),
        { bigint: true },
      );
      if (
        !unchanged(before, after) ||
        !unchanged(before, current) ||
        BigInt(position) !== before.size ||
        hash.digest('hex') !== migration.observed.hash
      )
        fail('SOURCE_CHANGED');
      await target.sync();
      const verified = await inspect(
        root,
        migration.newRelativePath,
        shouldStop,
      );
      if (
        !sameInode(verified, migration.target) ||
        verified.hash !== migration.observed.hash
      )
        fail('TARGET_CHANGED');
      return { state: 'published', target: verified };
    } finally {
      await target.close();
    }
  } finally {
    await source.close();
  }
}

export async function publishInboxMigration(
  root: string,
  migration: InboxMigration,
  shouldStop?: () => boolean,
): Promise<InboxPublication> {
  return safely(async () => {
    validateMigration(migration);
    stopped(shouldStop);
    const source = await optionalInspect(root, migration.oldActualRelativePath);
    if (source) expectedSource(source, migration.observed);
    await directory(root, parts(migration.newRelativePath)[0]!);
    const target = await optionalInspect(root, migration.newRelativePath);
    if (target) {
      if (migration.target && !sameInode(target, migration.target))
        fail('TARGET_CHANGED');
      if (
        sameInode(target, migration.observed) &&
        target.hash === migration.observed.hash
      )
        return { state: 'published', target };
      if (migration.state === 'reserved') {
        if (!source) fail('MISSING_SOURCE');
        return copyReserved(root, migration, shouldStop);
      }
      if (
        migration.target &&
        ['published', 'relocated', 'complete'].includes(migration.state)
      ) {
        if (
          target.hash !== migration.observed.hash ||
          target.size !== migration.observed.size
        )
          fail('TARGET_CHANGED');
        return { state: 'published', target };
      }
      const bytes = marker(migration);
      if (
        source &&
        target.size === String(bytes.length) &&
        target.hash === createHash('sha256').update(bytes).digest('hex')
      )
        return { state: 'reserved', target };
      const markerSize = Number(target.size);
      if (
        markerSize < bytes.length &&
        target.hash ===
          createHash('sha256')
            .update(bytes.subarray(0, markerSize))
            .digest('hex')
      )
        // Keep the journal/exclusion: ownership was never durably established.
        fail('TARGET_CHANGED');
      fail('COLLISION');
    }
    if (!source) fail('MISSING_SOURCE');
    if (migration.target) fail('TARGET_CHANGED');
    const oldPath = await contained(root, migration.oldActualRelativePath);
    const newPath = await contained(root, migration.newRelativePath, true);
    stopped(shouldStop);
    try {
      await fs.link(oldPath, newPath);
    } catch (error) {
      if (code(error) === 'EEXIST') fail('COLLISION');
      if (!['EXDEV', 'ENOTSUP', 'EOPNOTSUPP'].includes(code(error) ?? ''))
        throw error;
      // Persist this inode in the journal before copying. A partial copy is only
      // writable through that durable ownership record; no pathname is replaced.
      const handle = await fs.open(
        await contained(root, migration.newRelativePath, true),
        constants.O_RDWR |
          constants.O_CREAT |
          constants.O_EXCL |
          constants.O_NOFOLLOW,
        0o600,
      );
      try {
        await handle.writeFile(marker(migration));
        await handle.sync();
        const reserved = await inspect(root, migration.newRelativePath);
        if (
          !sameInode(
            reserved,
            identity(await handle.stat({ bigint: true }), ''),
          )
        )
          fail('TARGET_CHANGED');
        return { state: 'reserved', target: reserved };
      } finally {
        await handle.close();
      }
    }
    const published = await inspect(
      root,
      migration.newRelativePath,
      shouldStop,
    );
    expectedSource(published, migration.observed);
    const sourceAfter = await inspect(
      root,
      migration.oldActualRelativePath,
      shouldStop,
    );
    expectedSource(sourceAfter, migration.observed);
    if (!sameInode(published, sourceAfter)) fail('SOURCE_CHANGED');
    return { state: 'published', target: published };
  });
}

export async function cleanupInboxMigration(
  root: string,
  migration: InboxMigration,
  shouldStop?: () => boolean,
): Promise<void> {
  return safely(async () => {
    validateMigration(migration);
    if (
      !['relocated', 'complete'].includes(migration.state) ||
      !migration.target
    )
      fail('INVALID_STATE');
    const source = await optionalInspect(root, migration.oldActualRelativePath);
    if (source) expectedSource(source, migration.observed);
    const target = await optionalInspect(root, migration.newRelativePath);
    if (
      !target ||
      !sameInode(target, migration.target) ||
      target.hash !== migration.observed.hash ||
      target.size !== migration.observed.size
    )
      fail('TARGET_CHANGED');
    stopped(shouldStop);
    if (source) {
      const oldPath = await contained(root, migration.oldActualRelativePath);
      const current = identity(
        await fs.lstat(oldPath, { bigint: true }),
        source.hash,
      );
      expectedSource(current, source);
      await fs.unlink(oldPath);
    }
    const oldDirectory = parts(migration.oldActualRelativePath)[0]!;
    try {
      await fs.rmdir(await contained(root, oldDirectory));
    } catch (error) {
      if (!['ENOENT', 'ENOTEMPTY', 'EEXIST'].includes(code(error) ?? ''))
        throw error;
    }
  });
}
