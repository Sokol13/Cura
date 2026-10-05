import fs from 'node:fs/promises';
import path from 'node:path';
import { setImmediate as yieldToMessages } from 'node:timers/promises';
import type { ScanSummary, ScanError, ScanExtension } from '@cura/shared';
import { normalizeRelativePath } from './path-utils.js';

export const AUTO_IMPORT_EXTENSIONS: ReadonlySet<string> = new Set([
  '.png',
  '.jpg',
  '.jpeg',
  '.jpe',
  '.jfif',
  '.webp',
  '.gif',
  '.svg',
  '.avif',
  '.psd',
  '.pdf',
  '.glb',
  '.obj',
  '.mp4',
  '.mov',
  '.ttf',
  '.otf',
  '.woff',
  '.woff2',
]);
const ERROR_CODES = new Set([
  'EACCES',
  'EPERM',
  'ENOENT',
  'ENOTDIR',
  'EIO',
  'EMFILE',
  'ENFILE',
  'ELOOP',
  'ENAMETOOLONG',
  'EBUSY',
  'ENOSPC',
  'EBADF',
  'ENOMEM',
  'ESTALE',
  'ETIMEDOUT',
  'EINVAL',
]);
const MAX_EXTENSIONS = 64;
const MAX_ERRORS = 50;

export interface ScanDiscovery {
  files: string[];
  presentRelativePaths: string[];
  interrupted: boolean;
  summary: Pick<
    ScanSummary,
    | 'filesFound'
    | 'supportedFound'
    | 'existingGenericFound'
    | 'unsupportedSkipped'
    | 'processed'
    | 'succeeded'
    | 'readErrors'
    | 'symlinksSkipped'
    | 'specialEntriesSkipped'
    | 'extensions'
    | 'otherExtensionFiles'
    | 'errors'
    | 'omittedErrors'
  >;
}

export function shouldAutoImport(name: string): boolean {
  return AUTO_IMPORT_EXTENSIONS.has(
    path.extname(name).toLowerCase().normalize('NFC'),
  );
}

function relativeName(root: string, file: string) {
  return path.relative(root, file).split(path.sep).join('/').normalize('NFC');
}
function hasControlCharacters(value: string) {
  return [...value].some(
    (character) =>
      character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127,
  );
}
function validateRelative(value: string) {
  if (hasControlCharacters(value) || value.includes('\\'))
    throw new Error('Invalid scan relative path');
  return normalizeRelativePath(value);
}
function safeErrorPath(relative: string): string | null {
  try {
    return relative.length <= 1024 ? validateRelative(relative) : null;
  } catch {
    return null;
  }
}
async function validateRoot(root: string) {
  const info = await fs.lstat(root);
  if (info.isSymbolicLink())
    throw Object.assign(
      new Error('Registered root was replaced by a symbolic link'),
      { code: 'ROOT_CHANGED' },
    );
  if (!info.isDirectory())
    throw Object.assign(new Error('Registered root is not a directory'), {
      code: 'ENOTDIR',
    });
  const canonical = await fs.realpath(root);
  if (path.relative(canonical, path.resolve(root)))
    throw Object.assign(
      new Error('Registered root no longer has its canonical location'),
      { code: 'ROOT_CHANGED' },
    );
  return canonical;
}

/** Discover recursively without reading or hashing newly unsupported files. */
export async function discoverFiles(
  root: string,
  knownRelativePaths: readonly string[],
  shouldStop: () => boolean = () => false,
): Promise<ScanDiscovery> {
  const canonicalRoot = await validateRoot(root);
  const summary: ScanDiscovery['summary'] = {
    filesFound: 0,
    supportedFound: 0,
    existingGenericFound: 0,
    unsupportedSkipped: 0,
    processed: 0,
    succeeded: 0,
    readErrors: 0,
    symlinksSkipped: 0,
    specialEntriesSkipped: 0,
    extensions: [],
    otherExtensionFiles: 0,
    errors: [],
    omittedErrors: 0,
  };
  const result: ScanDiscovery = {
    files: [],
    presentRelativePaths: [],
    interrupted: false,
    summary,
  };
  const known = new Set<string>();
  for (const relative of knownRelativePaths) {
    try {
      known.add(normalizeRelativePath(relative));
    } catch {
      /* Invalid legacy aliases cannot authorize new imports. */
    }
  }
  const extensions = new Map<string, ScanExtension>();
  function error(
    relative: string,
    stage: ScanError['stage'],
    failure: unknown,
    extension?: ScanExtension,
  ) {
    summary.readErrors++;
    if (extension) extension.readErrors++;
    if (summary.errors.length === MAX_ERRORS) {
      summary.omittedErrors++;
      return;
    }
    const code =
      failure &&
      typeof failure === 'object' &&
      'code' in failure &&
      typeof failure.code === 'string' &&
      ERROR_CODES.has(failure.code)
        ? failure.code
        : 'SCAN_READ_FAILED';
    summary.errors.push({ relativePath: safeErrorPath(relative), stage, code });
  }
  function stopped() {
    if (!shouldStop()) return false;
    result.interrupted = true;
    return true;
  }
  const pending = [canonicalRoot];
  while (pending.length) {
    if (stopped()) break;
    const directory = pending.pop()!;
    const relativeDirectory = relativeName(canonicalRoot, directory);
    try {
      if (directory === canonicalRoot) await validateRoot(root);
      else {
        validateRelative(relativeDirectory);
        const info = await fs.lstat(directory);
        if (info.isSymbolicLink()) {
          summary.symlinksSkipped++;
          continue;
        }
        if (!info.isDirectory())
          throw Object.assign(new Error('Scan directory changed'), {
            code: 'ENOTDIR',
          });
        const canonical = await fs.realpath(directory);
        if (path.relative(directory, canonical))
          throw new Error(
            'Scan directory no longer has its canonical location',
          );
      }
      const entries = await fs.readdir(directory, { withFileTypes: true });
      entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
      // Reverse the stack insertion so extension/error caps are stable by directory name.
      const directories: string[] = [];
      for (const [index, entry] of entries.entries()) {
        if (index > 0 && index % 256 === 0) await yieldToMessages();
        if (stopped()) break;
        const file = path.join(directory, entry.name);
        if (entry.isSymbolicLink()) {
          summary.symlinksSkipped++;
          continue;
        }
        if (entry.isDirectory()) {
          directories.push(file);
          continue;
        }
        if (!entry.isFile()) {
          summary.specialEntriesSkipped++;
          continue;
        }
        const relative = relativeName(canonicalRoot, file);
        result.presentRelativePaths.push(relative);
        summary.filesFound++;
        const extensionName = path
          .extname(entry.name)
          .toLowerCase()
          .normalize('NFC');
        let extension = extensions.get(extensionName);
        if (
          !extension &&
          extensions.size < MAX_EXTENSIONS &&
          extensionName.length <= 255 &&
          (extensionName === '' || /^\.[^./\\:]+$/.test(extensionName)) &&
          !hasControlCharacters(extensionName)
        ) {
          extension = {
            extension: extensionName,
            found: 0,
            supported: 0,
            existingGeneric: 0,
            skipped: 0,
            readErrors: 0,
          };
          extensions.set(extensionName, extension);
        }
        if (extension) extension.found++;
        else summary.otherExtensionFiles++;
        const supported = shouldAutoImport(entry.name),
          existingGeneric = !supported && known.has(relative);
        if (supported) {
          summary.supportedFound++;
          if (extension) extension.supported++;
        } else if (existingGeneric) {
          summary.existingGenericFound++;
          if (extension) extension.existingGeneric++;
        } else {
          summary.unsupportedSkipped++;
          if (extension) extension.skipped++;
        }
        try {
          validateRelative(relative);
          if (supported || existingGeneric) result.files.push(file);
        } catch (failure) {
          error(relative, 'read', failure, extension);
        }
      }
      for (let index = directories.length - 1; index >= 0; index--)
        pending.push(directories[index]!);
      if (result.interrupted) break;
    } catch (failure) {
      if (directory === canonicalRoot) throw failure;
      error(relativeDirectory, 'enumerate', failure);
    }
  }
  summary.extensions = [...extensions.values()].sort((a, b) =>
    a.extension < b.extension ? -1 : a.extension > b.extension ? 1 : 0,
  );
  return result;
}
