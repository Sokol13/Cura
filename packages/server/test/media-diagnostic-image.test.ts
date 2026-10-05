import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { afterEach, expect, it } from 'vitest';
import { processFile } from '../src/media/image.js';
import { createMetadataPng, textChunk } from './media-fixtures.js';

const directories: string[] = [];
afterEach(async () => {
  for (const directory of directories.splice(0))
    await rm(directory, { recursive: true, force: true });
});
async function process(name: string, bytes: Buffer) {
  const directory = await mkdtemp(
    path.join(os.tmpdir(), 'cura-diagnostic-image-'),
  );
  directories.push(directory);
  const filePath = path.join(directory, name);
  await writeFile(filePath, bytes);
  return processFile({
    filePath,
    dataDir: path.join(directory, 'data'),
    cacheDir: path.join(directory, 'cache'),
  });
}

it('reports a bounded metadata warning count while keeping private parser detail out of diagnostics', async () => {
  const bytes = createMetadataPng(
    textChunk('prompt', '{"PRIVATE_PROMPT_SECRET":"unterminated'),
  );
  const result = await process('PRIVATE_FILENAME.png', bytes);
  expect(result.thumbnailPath).not.toBeNull();
  expect(result.generation.params.warnings).toEqual(expect.any(Array));
  expect(result.diagnostics ?? []).toContainEqual({
    operation: 'metadata',
    code: 'METADATA_PARSE_WARNINGS',
    count: (result.generation.params.warnings as string[]).length,
  });
  expect(JSON.stringify(result.diagnostics)).not.toContain('PRIVATE');
  expect(await readFile(result.snapshotPath)).toEqual(bytes);
});

it('reports native decoding failures for supported images without rejecting retained originals', async () => {
  const bytes = Buffer.from('PRIVATE_IMAGE_BYTES');
  const result = await process('broken.png', bytes);
  expect(result.thumbnailPath).toBeNull();
  expect(result.diagnostics ?? []).toContainEqual({
    operation: 'thumbnail',
    code: 'NATIVE_THUMBNAIL_FAILED',
  });
  expect(await readFile(result.snapshotPath)).toEqual(bytes);
  expect(JSON.stringify(result.diagnostics)).not.toContain('PRIVATE');
});

it('does not label unsupported generic files and deferred browser formats as native thumbnail failures', async () => {
  for (const [name, bytes] of [
    ['generic.bin', Buffer.from('opaque')],
    ['first.pdf', Buffer.from('%PDF-1.7\nfixture')],
    [
      'movie.mp4',
      Buffer.from([0, 0, 0, 20, ...Buffer.from('ftypisom'), 0, 0, 0, 0]),
    ],
  ] as const) {
    expect((await process(name, bytes)).diagnostics ?? []).toEqual([]);
  }
});

it('warns when native PSD decoding falls back without claiming a completed thumbnail', async () => {
  const result = await process('broken.psd', Buffer.from('8BPS invalid PSD'));
  expect(result.thumbnailPath).toBeNull();
  expect(result.diagnostics ?? []).toContainEqual({
    operation: 'thumbnail',
    code: 'PSD_NATIVE_PREVIEW_UNAVAILABLE',
  });
});

it('reports malformed EXIF separately while preserving valid image pixels', async () => {
  const jpeg = await sharp({
    create: { width: 8, height: 8, channels: 3, background: '#ff8800' },
  })
    .jpeg()
    .toBuffer();
  const exif = Buffer.concat([
    Buffer.from('Exif\0\0II'),
    Buffer.from([42, 0, 255, 255, 255, 127]),
  ]);
  const header = Buffer.alloc(4);
  header.writeUInt16BE(0xffe1, 0);
  header.writeUInt16BE(exif.length + 2, 2);
  const result = await process(
    'private-exif.jpg',
    Buffer.concat([jpeg.subarray(0, 2), header, exif, jpeg.subarray(2)]),
  );
  expect(result.thumbnailPath).not.toBeNull();
  expect(result.diagnostics ?? []).toContainEqual({
    operation: 'metadata',
    code: 'EXIF_PARSE_FAILED',
  });
});
