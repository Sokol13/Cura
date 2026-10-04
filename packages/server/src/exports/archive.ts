import { createHash } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { open, realpath, stat, rm } from 'node:fs/promises';
import { isAbsolute, relative } from 'node:path';
import { once } from 'node:events';
import { Zip, ZipPassThrough, strToU8 } from 'fflate';
import type { ExportException } from '@cura/shared';
import type { ExportSnapshot } from './snapshot.js';
import { assetsCsv } from './portable.js';
export class ArchiveLimitError extends Error {}
export class SnapshotError extends Error {
  constructor(readonly exceptions: ExportException[]) {
    super(
      'Retained version bytes are missing or do not match their recorded hash. No complete archive was created.',
    );
  }
}
/** Runs inside a worker. ZIP STORE avoids recompressing already compressed media and bounds memory to a read chunk. */
export async function writeArchive(
  snapshot: ExportSnapshot,
  destination: string,
  dataDirectory: string,
  onProgress: (value: number) => void,
): Promise<number> {
  const root = await realpath(dataDirectory),
    output = createWriteStream(destination, { flags: 'wx' });
  let outputError: Error | undefined;
  output.on('error', (error) => {
    outputError = error;
  });
  const zip = new Zip((error, chunk, final) => {
    if (error) {
      output.destroy(error);
      return;
    }
    output.write(chunk);
    if (final) output.end();
  });
  const finished = new Promise<void>((resolve, reject) => {
    output.once('finish', resolve);
    output.once('error', reject);
    output.once('close', () => {
      if (!output.writableFinished)
        reject(new Error('Archive output closed before completion'));
    });
  });
  // Attach immediately so filesystem failures cannot produce an unhandled rejection.
  void finished.catch(() => undefined);
  const prefix = `${snapshot.folder}/`;
  const textFile = (name: string, value: string) => {
    const entry = new ZipPassThrough(prefix + name);
    zip.add(entry);
    entry.push(strToU8(value), true);
  };
  try {
    if (snapshot.files.length + 3 > 65_535)
      throw new ArchiveLimitError(
        'This export exceeds the portable ZIP limit of 65,532 distinct files. Export a smaller selection.',
      );
    const manifestText = JSON.stringify(snapshot.manifest, null, 2) + '\n';
    const csvText = assetsCsv(snapshot.manifest);
    if (
      snapshot.files.reduce((sum, file) => sum + file.size, 0) +
        Buffer.byteLength(manifestText) +
        Buffer.byteLength(csvText) >
      3_500_000_000
    )
      throw new ArchiveLimitError(
        'This export exceeds the 3.5 GB portable ZIP limit. Export a smaller selection.',
      );
    for (let index = 0; index < snapshot.files.length; index++) {
      const file = snapshot.files[index]!;
      try {
        const source = await realpath(file.source),
          inside = relative(root, source);
        if (inside.startsWith('..') || isAbsolute(inside))
          throw new Error('Invalid retained snapshot location');
        const handle = await open(source, 'r');
        try {
          const info = await handle.stat();
          if (!info.isFile() || info.size !== file.size)
            throw new Error('Retained snapshot size changed');
          const entry = new ZipPassThrough(prefix + file.path);
          zip.add(entry);
          const hash = createHash('sha256');
          let bytes = 0;
          for await (const chunk of handle.createReadStream({
            autoClose: false,
            highWaterMark: 256 * 1024,
          })) {
            const buffer = Buffer.from(chunk);
            bytes += buffer.length;
            hash.update(buffer);
            entry.push(buffer, false);
            if (outputError) throw outputError;
            if (output.writableNeedDrain) await once(output, 'drain');
          }
          if (bytes !== file.size || hash.digest('hex') !== file.hash)
            throw new Error('Retained snapshot hash changed');
          entry.push(new Uint8Array(), true);
        } finally {
          await handle.close();
        }
      } catch {
        throw new SnapshotError(
          file.versionIds.map((versionId, pinIndex) => ({
            code: 'SNAPSHOT_INVALID',
            message:
              'Retained bytes are unavailable or failed size/hash verification.',
            versionId,
            assetId: file.assetIds[pinIndex]!,
          })),
        );
      }
      onProgress(((index + 1) / Math.max(snapshot.files.length, 1)) * 0.95);
    }
    textFile('manifest.json', manifestText);
    textFile('assets.csv', csvText);
    textFile(
      'README.txt',
      'Cura portable export — cura-export/1\n\nmanifest.json contains complete metadata and relative file paths. assets.csv uses UTF-8 and quotes every cell; formula-like values are prefixed with an apostrophe for spreadsheet safety. Exact values remain in JSON.\n\nAll retained versions are included, including trash and unavailable originals. Files are deduplicated by SHA-256 and verified before completion. Original reference roots are informative; managed Inbox paths are replaced with “Inbox”.\n\nSelection exports retain complete board and brand structures plus their historical pinned assets, related generation job outputs, and similarity references in saved searches. Additional assets are listed in includedDependencyAssetIds. Other library organization is retained as context.\n',
    );
    zip.end();
    await finished;
    if (outputError) throw outputError;
    return (await stat(destination)).size;
  } catch (error) {
    zip.terminate();
    output.destroy();
    await finished.catch(() => undefined);
    await rm(destination, { force: true });
    throw error;
  }
}
