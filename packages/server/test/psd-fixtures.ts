import { open } from 'node:fs/promises';
import { deflateSync } from 'node:zlib';
import sharp from 'sharp';

export interface PsdFixtureOptions {
  width: number;
  height: number;
  depth?: 8 | 16;
  mode?: 'rgb' | 'grayscale';
  compression?: 'raw' | 'rle' | 'zip' | 'zip-prediction';
  resources?: Array<{
    id: 1033 | 1036;
    format: 'raw' | 'jpeg';
    color: readonly [number, number, number];
    invalid?: boolean;
  }>;
  layerBytes?: number;
  merged?: boolean;
}

export const PSD_QUADRANTS = [
  [240, 20, 10],
  [10, 230, 30],
  [20, 40, 220],
  [230, 210, 20],
] as const;

function word(value: number) {
  const b = Buffer.alloc(2);
  b.writeUInt16BE(value);
  return b;
}
function dword(value: number) {
  const b = Buffer.alloc(4);
  b.writeUInt32BE(value);
  return b;
}

// Independent, deliberately simple PackBits encoder: literal packets only.
function packBits(row: Buffer) {
  const parts: Buffer[] = [];
  for (let offset = 0; offset < row.length; offset += 128) {
    const part = row.subarray(offset, offset + 128);
    parts.push(Buffer.from([part.length - 1]), part);
  }
  return Buffer.concat(parts);
}

/** Writes original fixtures without a full-resolution image allocation. */
export async function writePsdFixture(
  filePath: string,
  options: PsdFixtureOptions,
) {
  const {
    width,
    height,
    depth = 8,
    mode = 'rgb',
    compression = 'raw',
  } = options;
  const channels = mode === 'rgb' ? 3 : 1;
  const header = Buffer.alloc(26);
  header.write('8BPS');
  header.writeUInt16BE(1, 4);
  header.writeUInt16BE(channels, 12);
  header.writeUInt32BE(height, 14);
  header.writeUInt32BE(width, 18);
  header.writeUInt16BE(depth, 22);
  header.writeUInt16BE(mode === 'rgb' ? 3 : 1, 24);
  const resources: Buffer[] = [];
  for (const resource of options.resources ?? []) {
    const thumbWidth = 7,
      thumbHeight = 5,
      stride = 24;
    const color =
      resource.id === 1033 ? [...resource.color].reverse() : resource.color;
    const rgb = Buffer.alloc(thumbWidth * thumbHeight * 3);
    for (let i = 0; i < rgb.length; i++) rgb[i] = color[i % 3]!;
    let bytes: Buffer;
    if (resource.format === 'jpeg')
      bytes = await sharp(rgb, {
        raw: { width: thumbWidth, height: thumbHeight, channels: 3 },
      })
        .jpeg({ quality: 100, chromaSubsampling: '4:4:4' })
        .toBuffer();
    else {
      bytes = Buffer.alloc(stride * thumbHeight, 99);
      for (let y = 0; y < thumbHeight; y++)
        rgb.copy(
          bytes,
          y * stride,
          y * thumbWidth * 3,
          (y + 1) * thumbWidth * 3,
        );
    }
    if (resource.invalid) bytes = Buffer.from('damaged preview');
    const thumb = Buffer.concat([
      dword(resource.format === 'jpeg' ? 1 : 0),
      dword(thumbWidth),
      dword(thumbHeight),
      dword(stride),
      dword(stride * thumbHeight),
      dword(bytes.length),
      word(24),
      word(1),
      bytes,
    ]);
    // Odd-sized Pascal name verifies padding, unrelated data verifies skipping.
    const name = Buffer.from([2, 0x61, 0x62, 0]);
    const block = Buffer.concat([
      Buffer.from('8BIM'),
      word(resource.id),
      name,
      dword(thumb.length),
      thumb,
      thumb.length % 2 ? Buffer.from([0]) : Buffer.alloc(0),
    ]);
    resources.push(block);
  }
  const resourceBytes = Buffer.concat(resources);
  const file = await open(filePath, 'w');
  try {
    await file.write(
      Buffer.concat([
        header,
        dword(0),
        dword(resourceBytes.length),
        resourceBytes,
        dword(options.layerBytes ?? 0),
      ]),
    );
    if (options.layerBytes) {
      // Seek across a sparse opaque layer payload; the reader must never inspect it.
      await file.write(
        Buffer.from([0]),
        0,
        1,
        38 + resourceBytes.length + options.layerBytes - 1,
      );
    }
    let position = 38 + resourceBytes.length + (options.layerBytes ?? 0);
    if (options.merged === false) return;
    await file.write(
      word(['raw', 'rle', 'zip', 'zip-prediction'].indexOf(compression)),
      0,
      2,
      position,
    );
    position += 2;
    const rows: Buffer[][] = [];
    for (let c = 0; c < channels; c++) {
      const pair: Buffer[] = [];
      for (let half = 0; half < 2; half++) {
        const row = Buffer.alloc((width * depth) / 8);
        for (let x = 0; x < width; x++) {
          const value =
            PSD_QUADRANTS[half * 2 + (x < Math.floor(width / 2) ? 0 : 1)]![c]!;
          if (depth === 8) row[x] = value;
          else row.writeUInt16BE(value * 257, x * 2);
        }
        pair.push(row);
      }
      rows.push(pair);
    }
    if (compression === 'raw') {
      for (const pair of rows)
        for (let half = 0; half < 2; half++) {
          const count =
            half === 0
              ? Math.floor(height / 2)
              : height - Math.floor(height / 2);
          const row = pair[half]!;
          // Up to 1 MiB per write makes the large fixture useful for performance acceptance.
          const batchRows = Math.max(1, Math.floor((1024 * 1024) / row.length));
          const batch = Buffer.concat(
            Array.from({ length: batchRows }, () => row),
          );
          for (let y = 0; y < count; y += batchRows) {
            const bytes = batch.subarray(
              0,
              Math.min(batchRows, count - y) * row.length,
            );
            await file.write(bytes, 0, bytes.length, position);
            position += bytes.length;
          }
        }
    } else {
      // Compressed fixtures are small; large acceptance intentionally uses seekable raw data.
      const encoded: Buffer[] = [],
        sizes: Buffer[] = [];
      for (const pair of rows)
        for (let y = 0; y < height; y++) {
          let row: Buffer = Buffer.from(
            pair[y < Math.floor(height / 2) ? 0 : 1]!,
          );
          if (compression === 'zip-prediction') {
            if (depth === 8)
              for (let x = row.length - 1; x > 0; x--)
                row[x] = (row[x]! - row[x - 1]!) & 255;
            else
              for (let x = width - 1; x > 0; x--)
                row.writeUInt16BE(
                  (row.readUInt16BE(x * 2) - row.readUInt16BE((x - 1) * 2)) &
                    65535,
                  x * 2,
                );
          }
          if (compression === 'rle') {
            row = packBits(row);
            sizes.push(word(row.length));
          }
          encoded.push(row);
        }
      const bytes =
        compression === 'rle'
          ? Buffer.concat([...sizes, ...encoded])
          : deflateSync(Buffer.concat(encoded));
      await file.write(bytes, 0, bytes.length, position);
    }
  } finally {
    await file.close();
  }
}
