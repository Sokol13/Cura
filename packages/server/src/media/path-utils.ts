import { realpath } from 'node:fs/promises';
import path from 'node:path';

// This value is catalog identity only. Keep the original spelling for disk access.
export function normalizeRelativePath(value: string): string {
  const portable = value.replaceAll('\\', '/');
  if (
    value.includes('\0') ||
    portable.includes(':') ||
    path.posix.isAbsolute(portable) ||
    portable.split('/').some((part) => !part || part === '.' || part === '..')
  ) {
    throw new Error('Invalid relative path');
  }
  return portable.normalize('NFC');
}

export async function resolveContained(
  root: string,
  relative: string,
): Promise<string> {
  normalizeRelativePath(relative);
  const realRoot = await realpath(root);
  const target = await realpath(
    path.resolve(realRoot, ...relative.split(/[\\/]/)),
  );
  const difference = path.relative(realRoot, target);
  if (
    difference === '..' ||
    difference.startsWith(`..${path.sep}`) ||
    path.isAbsolute(difference)
  ) {
    throw new Error('Path escapes outside its registered root');
  }
  return target;
}
