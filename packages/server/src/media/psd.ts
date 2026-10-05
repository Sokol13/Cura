import { open, type FileHandle } from 'node:fs/promises';
import { createInflate } from 'node:zlib';
import sharp from 'sharp';

export interface PsdPreview {
  png: Buffer;
  width: number;
  height: number;
  source: 'resource-1036' | 'resource-1033' | 'merged';
}

const PREVIEW_SIDE = 1024;
const MAX_THUMBNAIL_BYTES = 8 * 1024 * 1024;
const MAX_THUMBNAIL_PIXELS = 4 * 1024 * 1024;
// ZIP must visit every decompressed byte, unlike seekable raw and PackBits rows.
const MAX_ZIP_BYTES = 768 * 1024 * 1024;
const DECODE_BUDGET_MS = 7_000;

class PsdReader {
  constructor(
    readonly file: FileHandle,
    readonly size: number,
    readonly deadline: number,
  ) {}

  checkTime() {
    if (performance.now() > this.deadline)
      throw new Error('PSD preview time limit');
  }

  range(offset: number, length: number) {
    if (
      !Number.isSafeInteger(offset) ||
      !Number.isSafeInteger(length) ||
      offset < 0 ||
      length < 0 ||
      offset + length > this.size
    )
      throw new Error('Truncated PSD section');
  }

  async read(offset: number, length: number): Promise<Buffer> {
    this.checkTime();
    this.range(offset, length);
    const bytes = Buffer.allocUnsafe(length);
    let read = 0;
    while (read < length) {
      const result = await this.file.read(
        bytes,
        read,
        length - read,
        offset + read,
      );
      if (result.bytesRead === 0) throw new Error('Truncated PSD read');
      read += result.bytesRead;
    }
    return bytes;
  }

  async section(offset: number) {
    const length = (await this.read(offset, 4)).readUInt32BE();
    this.range(offset + 4, length);
    return { start: offset + 4, end: offset + 4 + length };
  }
}

interface Resource {
  id: 1033 | 1036;
  offset: number;
  length: number;
}

async function thumbnail(
  reader: PsdReader,
  resource: Resource,
): Promise<Buffer | null> {
  try {
    if (resource.length < 28 || resource.length > MAX_THUMBNAIL_BYTES + 28)
      return null;
    const header = await reader.read(resource.offset, 28);
    const format = header.readUInt32BE(0),
      width = header.readUInt32BE(4),
      height = header.readUInt32BE(8);
    const stride = header.readUInt32BE(12),
      total = header.readUInt32BE(16),
      compressed = header.readUInt32BE(20);
    if (
      (format !== 0 && format !== 1) ||
      width < 1 ||
      height < 1 ||
      width * height > MAX_THUMBNAIL_PIXELS ||
      stride !== Math.ceil((width * 3) / 4) * 4 ||
      total !== stride * height ||
      header.readUInt16BE(24) !== 24 ||
      header.readUInt16BE(26) !== 1 ||
      compressed < 1 ||
      compressed > resource.length - 28
    )
      return null;
    const bytes = await reader.read(resource.offset + 28, compressed);
    let decoder: sharp.Sharp;
    if (format === 0) {
      if (compressed !== total) return null;
      const rgb = Buffer.allocUnsafe(width * height * 3);
      for (let y = 0; y < height; y++)
        bytes.copy(rgb, y * width * 3, y * stride, y * stride + width * 3);
      decoder = sharp(rgb, { raw: { width, height, channels: 3 } });
    } else {
      decoder = sharp(bytes, {
        limitInputPixels: MAX_THUMBNAIL_PIXELS,
        failOn: 'error',
      });
      const info = await decoder.metadata();
      if (
        info.format !== 'jpeg' ||
        info.width !== width ||
        info.height !== height
      )
        return null;
    }
    // Adobe's legacy resource 1033 stores BGR for both raw and JPEG payloads.
    if (resource.id === 1033)
      decoder = decoder.recomb([
        [0, 0, 1],
        [0, 1, 0],
        [1, 0, 0],
      ]);
    reader.checkTime();
    return await decoder
      .resize(PREVIEW_SIDE, PREVIEW_SIDE, {
        fit: 'inside',
        withoutEnlargement: true,
      })
      .timeout({ seconds: 2 })
      .png()
      .toBuffer();
  } catch {
    return null;
  }
}

function unpackRow(encoded: Buffer, length: number): Buffer {
  const row = Buffer.allocUnsafe(length);
  let source = 0,
    destination = 0;
  while (source < encoded.length) {
    const control = encoded.readInt8(source++);
    if (control === -128) continue;
    const count = control >= 0 ? control + 1 : 1 - control;
    if (destination + count > length) throw new Error('PSD RLE row overflow');
    if (control >= 0) {
      if (source + count > encoded.length)
        throw new Error('Truncated PSD RLE literal');
      encoded.copy(row, destination, source, source + count);
      source += count;
    } else {
      if (source === encoded.length) throw new Error('Truncated PSD RLE run');
      row.fill(encoded[source++]!, destination, destination + count);
    }
    destination += count;
  }
  if (destination !== length) throw new Error('Truncated PSD RLE row');
  return row;
}

interface Composite {
  width: number;
  height: number;
  channels: number;
  depth: number;
  mode: number;
}

/** Samples bounded rows/columns. Extra channels can be saved masks, not opacity. */
async function merged(
  reader: PsdReader,
  offset: number,
  image: Composite,
): Promise<Buffer | null> {
  const { width, height, channels, depth, mode } = image;
  if ((depth !== 8 && depth !== 16) || (mode !== 1 && mode !== 3)) return null;
  const colors = mode === 3 ? 3 : 1;
  if (channels < colors) return null;
  const compression = (await reader.read(offset, 2)).readUInt16BE();
  if (compression > 3) return null;
  const scale = Math.min(1, PREVIEW_SIDE / Math.max(width, height));
  const outWidth = Math.max(1, Math.round(width * scale)),
    outHeight = Math.max(1, Math.round(height * scale));
  const rgb = Buffer.alloc(outWidth * outHeight * 3);
  const step = depth / 8,
    rowBytes = width * step;
  const sampledRows = new Map<number, number>();
  for (let y = 0; y < outHeight; y++)
    sampledRows.set(
      Math.min(height - 1, Math.floor(((y + 0.5) * height) / outHeight)),
      y,
    );
  function sample(
    row: Buffer,
    channel: number,
    sourceY: number,
    prediction = false,
  ) {
    const y = sampledRows.get(sourceY);
    if (y === undefined || channel >= colors) return;
    if (prediction) {
      if (depth === 8)
        for (let x = 1; x < width; x++) row[x] = (row[x]! + row[x - 1]!) & 255;
      else
        for (let x = 1; x < width; x++)
          row.writeUInt16BE(
            (row.readUInt16BE(x * 2) + row.readUInt16BE((x - 1) * 2)) & 65535,
            x * 2,
          );
    }
    for (let x = 0; x < outWidth; x++) {
      const sourceX = Math.min(
        width - 1,
        Math.floor(((x + 0.5) * width) / outWidth),
      );
      const value = row[sourceX * step]!; // High byte is a bounded 16-to-8-bit preview.
      const target = (y * outWidth + x) * 3;
      if (mode === 1) rgb.fill(value, target, target + 3);
      else rgb[target + channel] = value;
    }
  }
  const payload = offset + 2,
    totalRows = channels * height,
    expected = totalRows * rowBytes;
  if (compression === 0) {
    reader.range(payload, expected);
    for (let c = 0; c < colors; c++)
      for (const y of sampledRows.keys())
        sample(
          await reader.read(payload + (c * height + y) * rowBytes, rowBytes),
          c,
          y,
        );
  } else if (compression === 1) {
    const table = await reader.read(payload, totalRows * 2);
    let cursor = payload + table.length;
    for (let index = 0; index < totalRows; index++) {
      const length = table.readUInt16BE(index * 2);
      reader.range(cursor, length);
      const channel = Math.floor(index / height),
        y = index % height;
      if (channel < colors && sampledRows.has(y))
        sample(
          unpackRow(await reader.read(cursor, length), rowBytes),
          channel,
          y,
        );
      cursor += length;
    }
  } else {
    if (expected > MAX_ZIP_BYTES || reader.size - payload > MAX_ZIP_BYTES)
      return null;
    const input = reader.file.createReadStream({
      start: payload,
      end: reader.size - 1,
      autoClose: false,
      highWaterMark: 64 * 1024,
    });
    const inflate = createInflate({ chunkSize: 64 * 1024 });
    input.on('error', (error: Error) => inflate.destroy(error));
    input.pipe(inflate);
    const timer = setTimeout(
      () => inflate.destroy(new Error('PSD ZIP time limit')),
      Math.max(1, reader.deadline - performance.now()),
    );
    timer.unref();
    const row = Buffer.allocUnsafe(rowBytes);
    let rowFilled = 0,
      rowIndex = 0,
      inflated = 0;
    try {
      for await (const value of inflate) {
        reader.checkTime();
        const chunk = value as Buffer;
        inflated += chunk.length;
        if (inflated > expected) throw new Error('PSD ZIP output overflow');
        let start = 0;
        while (start < chunk.length) {
          const count = Math.min(rowBytes - rowFilled, chunk.length - start);
          chunk.copy(row, rowFilled, start, start + count);
          rowFilled += count;
          start += count;
          if (rowFilled === rowBytes) {
            sample(
              row,
              Math.floor(rowIndex / height),
              rowIndex % height,
              compression === 3,
            );
            rowIndex++;
            rowFilled = 0;
          }
        }
      }
      if (inflated !== expected) throw new Error('Truncated PSD ZIP output');
    } finally {
      clearTimeout(timer);
      input.destroy();
      inflate.destroy();
    }
  }
  reader.checkTime();
  return sharp(rgb, {
    raw: { width: outWidth, height: outHeight, channels: 3 },
  })
    .timeout({ seconds: 2 })
    .png()
    .toBuffer();
}

/**
 * Embedded thumbnails first, then RGB/grayscale 8/16-bit merged pixels only.
 * Never reads the layer tree or allocates a full-resolution image. Raw/RLE
 * seek to sampled rows; ZIP is streamed with an exact expanded-byte limit.
 * Malformed/unsupported documents return null for the existing preview fallback.
 */
export async function readPsdPreview(
  filePath: string,
): Promise<PsdPreview | null> {
  const file = await open(filePath, 'r');
  try {
    const stat = await file.stat();
    if (!stat.isFile()) return null;
    const reader = new PsdReader(
      file,
      stat.size,
      performance.now() + DECODE_BUDGET_MS,
    );
    const header = await reader.read(0, 26);
    if (
      header.toString('ascii', 0, 4) !== '8BPS' ||
      header.readUInt16BE(4) !== 1
    )
      return null;
    const channels = header.readUInt16BE(12),
      height = header.readUInt32BE(14),
      width = header.readUInt32BE(18),
      depth = header.readUInt16BE(22),
      mode = header.readUInt16BE(24);
    if (
      channels < 1 ||
      channels > 56 ||
      width < 1 ||
      height < 1 ||
      width > 30_000 ||
      height > 30_000
    )
      return null;
    const colorData = await reader.section(26),
      resources = await reader.section(colorData.end);
    const thumbnails: Resource[] = [];
    let realMerged = true;
    for (
      let cursor = resources.start, count = 0;
      cursor < resources.end && count < 4096;
      count++
    ) {
      if (cursor + 7 > resources.end) break;
      const prefix = await reader.read(cursor, 7);
      if (prefix.toString('ascii', 0, 4) !== '8BIM') break;
      const id = prefix.readUInt16BE(4),
        nameBytes = Math.ceil((prefix[6]! + 1) / 2) * 2;
      const lengthOffset = cursor + 6 + nameBytes;
      if (lengthOffset + 4 > resources.end) break;
      const length = (await reader.read(lengthOffset, 4)).readUInt32BE(),
        offset = lengthOffset + 4;
      if (offset + length + (length % 2) > resources.end) break;
      if (
        (id === 1033 || id === 1036) &&
        thumbnails.filter((item) => item.id === id).length < 4
      )
        thumbnails.push({ id, offset, length });
      if (id === 1057 && length >= 5) {
        const version = await reader.read(offset, 5);
        if (version.readUInt32BE() === 1 && version[4] === 0)
          realMerged = false;
      }
      cursor = offset + length + (length % 2);
    }
    thumbnails.sort((a, b) => b.id - a.id);
    for (const resource of thumbnails) {
      const png = await thumbnail(reader, resource);
      if (png)
        return {
          png,
          width,
          height,
          source: resource.id === 1036 ? 'resource-1036' : 'resource-1033',
        };
    }
    if (!realMerged) return null;
    const layers = await reader.section(resources.end);
    const png = await merged(reader, layers.end, {
      width,
      height,
      channels,
      depth,
      mode,
    });
    return png ? { png, width, height, source: 'merged' } : null;
  } catch {
    return null;
  } finally {
    await file.close();
  }
}
