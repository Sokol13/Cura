import { createHash, randomUUID } from 'node:crypto';
import { createWriteStream, type BigIntStats } from 'node:fs';
import {
  chmod,
  link,
  mkdir,
  open,
  readFile,
  rename,
  rm,
  stat,
} from 'node:fs/promises';
import path from 'node:path';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import exifr from 'exifr';
import sharp from 'sharp';

import { parsePngMetadata } from './metadata.js';
import { readPsdPreview } from './psd.js';
import type { ProcessedDiagnostic, ProcessedFile } from './types.js';

const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const MAX_TEXT_CHUNK = 1024 * 1024;
const MIME_TYPES: Record<string, string> = {
  png: 'image/png',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif',
  svg: 'image/svg+xml',
  heif: 'image/avif',
  avif: 'image/avif',
};

function sameFile(a: BigIntStats, b: BigIntStats): boolean {
  return (
    a.dev === b.dev &&
    a.ino === b.ino &&
    a.size === b.size &&
    a.mtimeNs === b.mtimeNs &&
    a.ctimeNs === b.ctimeNs
  );
}

async function snapshot(filePath: string, dataDir: string) {
  const directory = path.resolve(dataDir, 'objects');
  await mkdir(directory, { recursive: true });
  for (let attempt = 0; attempt < 3; attempt++) {
    const temporary = path.join(directory, `${randomUUID()}.tmp`);
    const source = await open(filePath, 'r');
    try {
      const before = await source.stat({ bigint: true });
      if (!before.isFile())
        throw new Error('Only regular files can be imported');
      const hash = createHash('sha256');
      let size = 0;
      await pipeline(
        source.createReadStream({ autoClose: false }),
        new Transform({
          transform(chunk: Buffer, _encoding, callback) {
            hash.update(chunk);
            size += chunk.length;
            callback(null, chunk);
          },
        }),
        createWriteStream(temporary, { flags: 'wx', mode: 0o600 }),
      );
      const after = await source.stat({ bigint: true });
      const current = await stat(filePath, { bigint: true });
      if (
        !sameFile(before, after) ||
        !sameFile(before, current) ||
        BigInt(size) !== before.size
      )
        continue;
      const digest = hash.digest('hex');
      const snapshotPath = path.join(directory, digest);
      await chmod(temporary, 0o444);
      try {
        // An exclusive hard link publishes complete bytes without replacing an existing object.
        await link(temporary, snapshotPath);
      } catch (error) {
        if (
          !(
            error instanceof Error &&
            'code' in error &&
            error.code === 'EEXIST'
          )
        )
          throw error;
      }
      return { hash: digest, size, snapshotPath };
    } finally {
      await source.close();
      await rm(temporary, { force: true });
    }
  }
  throw new Error(
    'File changed during import; retry after the writer finishes',
  );
}

// Gather only bounded text chunks; large pixel payloads never enter the JS heap.
async function pngTextBytes(
  filePath: string,
  size: number,
): Promise<{ bytes: Buffer; warnings: string[] }> {
  const file = await open(filePath, 'r');
  try {
    const warnings: string[] = [];
    const signature = Buffer.alloc(8);
    await file.read(signature, 0, 8, 0);
    if (!signature.equals(PNG_SIGNATURE))
      return { bytes: Buffer.alloc(0), warnings };
    const parts = [signature];
    let total = 0;
    for (
      let offset = 8, count = 0;
      offset + 12 <= size && count < 16_384;
      count++
    ) {
      const header = Buffer.alloc(8);
      await file.read(header, 0, 8, offset);
      const length = header.readUInt32BE(0);
      if (offset + length + 12 > size) {
        warnings.push('Truncated PNG chunk stream');
        break;
      }
      const type = header.toString('ascii', 4);
      const textChunk = ['tEXt', 'zTXt', 'iTXt'].includes(type);
      if (
        (textChunk || type === 'IEND') &&
        length <= MAX_TEXT_CHUNK &&
        total + length <= 4 * MAX_TEXT_CHUNK
      ) {
        const chunk = Buffer.alloc(length + 12);
        await file.read(chunk, 0, chunk.length, offset);
        parts.push(chunk);
        total += length;
      } else if (textChunk) {
        warnings.push('PNG metadata size limit exceeded');
      }
      if (type === 'IEND') break;
      offset += length + 12;
    }
    return { bytes: Buffer.concat(parts), warnings };
  } finally {
    await file.close();
  }
}

function palette(rgb: Buffer): string[] {
  const buckets = new Map<
    number,
    { count: number; r: number; g: number; b: number }
  >();
  for (let index = 0; index + 2 < rgb.length; index += 3) {
    const r = rgb[index]!;
    const g = rgb[index + 1]!;
    const b = rgb[index + 2]!;
    const key = ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3);
    const bucket = buckets.get(key) ?? { count: 0, r: 0, g: 0, b: 0 };
    bucket.count++;
    bucket.r += r;
    bucket.g += g;
    bucket.b += b;
    buckets.set(key, bucket);
  }
  return [...buckets.values()]
    .sort((a, b) => b.count - a.count)
    .slice(0, 8)
    .map(
      (bucket) =>
        `#${[bucket.r, bucket.g, bucket.b]
          .map((value) =>
            Math.round(value / bucket.count)
              .toString(16)
              .padStart(2, '0'),
          )
          .join('')}`,
    );
}

function perceptualHash(gray: Buffer): string {
  const coefficients: number[] = [];
  for (let v = 0; v < 8; v++) {
    for (let u = 0; u < 8; u++) {
      let sum = 0;
      for (let y = 0; y < 32; y++) {
        for (let x = 0; x < 32; x++) {
          sum +=
            gray[y * 32 + x]! *
            Math.cos(((2 * x + 1) * u * Math.PI) / 64) *
            Math.cos(((2 * y + 1) * v * Math.PI) / 64);
        }
      }
      coefficients.push(Math.abs(sum) < 1e-8 ? 0 : sum);
    }
  }
  const sorted = coefficients.slice(1).sort((a, b) => a - b);
  const median = sorted[31]!;
  let bits = 0n;
  for (const coefficient of coefficients)
    bits = (bits << 1n) | (coefficient > median ? 1n : 0n);
  return bits.toString(16).padStart(16, '0');
}

export async function processFile(input: {
  filePath: string;
  dataDir: string;
  cacheDir: string;
  sourceName?: string;
}): Promise<ProcessedFile> {
  const stored = await snapshot(input.filePath, input.dataDir);
  const text = await pngTextBytes(stored.snapshotPath, stored.size);
  const generation = parsePngMetadata(text.bytes);
  if (text.warnings.length > 0) {
    const existing = generation.params.warnings;
    generation.params.warnings = [
      ...(Array.isArray(existing) ? existing : []),
      ...text.warnings,
    ];
  }
  const result: ProcessedFile = {
    ...stored,
    type: 'application/octet-stream',
    width: null,
    height: null,
    colors: [],
    phash: '',
    exif: {},
    generation,
    thumbnailPath: null,
  };
  const diagnostic = (value: ProcessedDiagnostic) =>
    (result.diagnostics ??= []).push(value);
  const warnings = generation.params.warnings;
  if (Array.isArray(warnings) && warnings.length)
    diagnostic({
      operation: 'metadata',
      code: 'METADATA_PARSE_WARNINGS',
      count: warnings.length,
    });
  let nativePreviewExpected = new Set([
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
  ]).has(path.extname(input.sourceName ?? input.filePath).toLowerCase());
  const previews = path.resolve(input.cacheDir, 'thumbnails');
  const temporary = path.join(previews, `${randomUUID()}.tmp`);
  let psdPixels: Buffer | undefined;
  try {
    const prefix = await open(stored.snapshotPath, 'r');
    let raster = false;
    try {
      const header = Buffer.alloc(Math.min(4096, stored.size));
      await prefix.read(header, 0, header.length, 0);
      const signature = header.toString('ascii', 0, 12);
      const richType = signature.startsWith('glTF')
        ? 'model/gltf-binary'
        : signature.startsWith('8BPS')
          ? 'image/vnd.adobe.photoshop'
          : signature.startsWith('%PDF-')
            ? 'application/pdf'
            : signature.slice(4, 8) === 'ftyp' &&
                /^(qt {2}|isom|iso2|mp41|mp42|avc1)$/.test(
                  signature.slice(8, 12),
                )
              ? signature.slice(8, 12) === 'qt  '
                ? 'video/quicktime'
                : 'video/mp4'
              : path.extname(input.filePath).toLowerCase() === '.obj' &&
                  /^v\s+[-+\d.]/m.test(header.toString('utf8'))
                ? 'model/obj'
                : null;
      if (richType) {
        result.type = richType;
        if (
          richType === 'image/vnd.adobe.photoshop' &&
          header.length >= 26 &&
          header.readUInt16BE(4) === 1
        ) {
          const width = header.readUInt32BE(18),
            height = header.readUInt32BE(14);
          if (width > 0 && height > 0 && width <= 30000 && height <= 30000) {
            result.width = width;
            result.height = height;
          }
        }
        if (richType !== 'image/vnd.adobe.photoshop') return result;
        const preview = await readPsdPreview(stored.snapshotPath);
        if (!preview) {
          diagnostic({
            operation: 'thumbnail',
            code: 'PSD_NATIVE_PREVIEW_UNAVAILABLE',
          });
          return result;
        }
        psdPixels = preview.png;
        result.width = preview.width;
        result.height = preview.height;
      }
      raster =
        header.subarray(0, 8).equals(PNG_SIGNATURE) ||
        header.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff])) ||
        /^GIF8[79]a/.test(header.toString('ascii', 0, 6)) ||
        (header.toString('ascii', 0, 4) === 'RIFF' &&
          header.toString('ascii', 8, 12) === 'WEBP') ||
        (header.toString('ascii', 4, 8) === 'ftyp' &&
          /avif|avis/.test(header.toString('ascii', 8, 64)));
    } finally {
      await prefix.close();
    }
    nativePreviewExpected ||= raster || !!psdPixels;
    // Buffer input has no base URL from which SVG can load adjacent source files.
    if (!psdPixels && !raster && stored.size > 8 * 1024 * 1024) {
      if (nativePreviewExpected)
        diagnostic({ operation: 'thumbnail', code: 'THUMBNAIL_SIZE_LIMIT' });
      return result;
    }
    const decoder = sharp(
      psdPixels ??
        (raster ? stored.snapshotPath : await readFile(stored.snapshotPath)),
      {
        limitInputPixels: 100_000_000,
        failOn: 'error',
        animated: false,
      },
    );
    const metadata = await decoder.metadata();
    if (!metadata.format || !MIME_TYPES[metadata.format]) return result;
    nativePreviewExpected = true;
    if (!psdPixels) result.type = MIME_TYPES[metadata.format]!;
    if (metadata.exif && metadata.exif.length <= MAX_TEXT_CHUNK) {
      try {
        const tiff = metadata.exif
          .subarray(0, 6)
          .equals(Buffer.from('Exif\0\0'))
          ? metadata.exif.subarray(6)
          : metadata.exif;
        const exif: unknown = await exifr.parse(tiff, {
          reviveValues: false,
          makerNote: false,
          xmp: false,
          icc: false,
        });
        if (exif && typeof exif === 'object' && !Array.isArray(exif)) {
          result.exif = exif as Record<string, unknown>;
          if (Array.isArray(result.exif.errors) && result.exif.errors.length)
            diagnostic({ operation: 'metadata', code: 'EXIF_PARSE_FAILED' });
        } else diagnostic({ operation: 'metadata', code: 'EXIF_PARSE_FAILED' });
      } catch {
        diagnostic({ operation: 'metadata', code: 'EXIF_PARSE_FAILED' });
      }
    }
    if (metadata.exif && metadata.exif.length > MAX_TEXT_CHUNK)
      diagnostic({ operation: 'metadata', code: 'EXIF_SIZE_LIMIT' });
    const rotated = decoder.rotate();
    const [rgb, gray, thumbnail] = await Promise.all([
      rotated
        .clone()
        .resize(64, 64, { fit: 'inside' })
        .flatten({ background: '#ffffff' })
        .removeAlpha()
        .toColourspace('srgb')
        .raw()
        .toBuffer(),
      rotated
        .clone()
        .resize(32, 32, { fit: 'fill' })
        .flatten({ background: '#ffffff' })
        .greyscale()
        .raw()
        .toBuffer(),
      rotated
        .clone()
        .resize(512, 512, { fit: 'inside', withoutEnlargement: true })
        .webp({ quality: 82 })
        .toBuffer(),
    ]);
    const swap =
      metadata.orientation !== undefined && metadata.orientation >= 5;
    if (!psdPixels) {
      result.width = (swap ? metadata.height : metadata.width) ?? null;
      result.height = (swap ? metadata.width : metadata.height) ?? null;
    }
    result.colors = palette(rgb);
    result.phash = perceptualHash(gray);
    await mkdir(previews, { recursive: true });
    const thumbnailPath = path.join(previews, `${stored.hash}.webp`);
    const previewFile = await open(temporary, 'wx', 0o600);
    try {
      await previewFile.writeFile(thumbnail);
    } finally {
      await previewFile.close();
    }
    await rename(temporary, thumbnailPath);
    result.thumbnailPath = thumbnailPath;
  } catch {
    if (nativePreviewExpected)
      diagnostic({ operation: 'thumbnail', code: 'NATIVE_THUMBNAIL_FAILED' });
    // Unsupported, oversized and damaged image files retain their original bytes.
    if (result.type !== 'image/vnd.adobe.photoshop') {
      result.width = null;
      result.height = null;
    }
    result.colors = [];
    result.phash = '';
  } finally {
    await rm(temporary, { force: true });
  }
  return result;
}
