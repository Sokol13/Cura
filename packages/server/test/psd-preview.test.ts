import { mkdtemp, open, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, expect, it } from 'vitest';
import sharp from 'sharp';
import { readPsdPreview } from '../src/media/psd.js';
import { PSD_QUADRANTS, writePsdFixture } from './psd-fixtures.js';

const directories: string[] = [];
afterEach(async () => {
  for (const dir of directories.splice(0))
    await rm(dir, { recursive: true, force: true });
});
async function target() {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'cura-psd-'));
  directories.push(dir);
  return path.join(dir, 'fixture.psd');
}
async function pixels(png: Buffer) {
  return sharp(png).removeAlpha().raw().toBuffer({ resolveWithObject: true });
}

it('prefers resource 1036 even when legacy 1033 occurs first and skips an opaque huge layer payload', async () => {
  const file = await target();
  await writePsdFixture(file, {
    width: 13391,
    height: 7032,
    layerBytes: 700_000_000,
    merged: false,
    resources: [
      { id: 1033, format: 'raw', color: [240, 20, 10] },
      { id: 1036, format: 'jpeg', color: [10, 220, 30] },
    ],
  });
  const preview = await readPsdPreview(file);
  expect(preview).toMatchObject({
    width: 13391,
    height: 7032,
    source: 'resource-1036',
  });
  const { data } = await pixels(preview!.png);
  expect(data[0]).toBeLessThan(15);
  expect(data[1]).toBeGreaterThan(215);
  expect(data[2]).toBeLessThan(35);
});

it.each([1033, 1036] as const)(
  'reads padded raw resource %s with correct RGB order',
  async (id) => {
    const file = await target();
    await writePsdFixture(file, {
      width: 8,
      height: 6,
      resources: [{ id, format: 'raw', color: [230, 70, 15] }],
    });
    const preview = await readPsdPreview(file);
    expect(preview?.source).toBe(`resource-${id}`);
    const { data, info } = await pixels(preview!.png);
    expect(info).toMatchObject({ width: 7, height: 5 });
    for (let i = 0; i < data.length; i += 3)
      expect([...data.subarray(i, i + 3)]).toEqual([230, 70, 15]);
  },
);

it('swaps BGR for legacy 1033 JPEG thumbnails', async () => {
  const file = await target();
  await writePsdFixture(file, {
    width: 8,
    height: 6,
    resources: [{ id: 1033, format: 'jpeg', color: [230, 70, 15] }],
  });
  const preview = await readPsdPreview(file);
  const { data } = await pixels(preview!.png);
  expect(data[0]).toBeGreaterThan(225);
  expect(data[1]).toBeGreaterThan(65);
  expect(data[2]).toBeLessThan(20);
});

it.each(['raw', 'rle', 'zip', 'zip-prediction'] as const)(
  'decodes the merged %s composite without parsing layers',
  async (compression) => {
    for (const depth of [8, 16] as const)
      for (const mode of ['rgb', 'grayscale'] as const) {
        const file = await target();
        await writePsdFixture(file, {
          width: 12,
          height: 8,
          depth,
          mode,
          compression,
          layerBytes: 100_003,
        });
        const preview = await readPsdPreview(file);
        expect(preview).toMatchObject({
          width: 12,
          height: 8,
          source: 'merged',
        });
        const { data, info } = await pixels(preview!.png);
        expect(info).toMatchObject({ width: 12, height: 8 });
        for (const [index, x, y] of [
          [0, 1, 1],
          [1, 10, 1],
          [2, 1, 6],
          [3, 10, 6],
        ] as const) {
          const expected =
            mode === 'rgb'
              ? [...PSD_QUADRANTS[index]]
              : Array(3).fill(PSD_QUADRANTS[index][0]);
          expect([
            ...data.subarray((y * 12 + x) * 3, (y * 12 + x) * 3 + 3),
          ]).toEqual(expected);
        }
      }
  },
);

it('falls back from corrupt thumbnails to the merged composite', async () => {
  const file = await target();
  await writePsdFixture(file, {
    width: 32,
    height: 16,
    resources: [
      { id: 1036, format: 'jpeg', color: [0, 0, 0], invalid: true },
      { id: 1033, format: 'raw', color: [0, 0, 0], invalid: true },
    ],
  });
  expect(await readPsdPreview(file)).toMatchObject({
    width: 32,
    height: 16,
    source: 'merged',
  });
});

it('samples a composite to at most 1024 pixels per side while preserving original dimensions', async () => {
  const file = await target();
  await writePsdFixture(file, { width: 3866, height: 6871 });
  const preview = await readPsdPreview(file);
  expect(preview).toMatchObject({
    width: 3866,
    height: 6871,
    source: 'merged',
  });
  const { info, data } = await pixels(preview!.png);
  expect(Math.max(info.width, info.height)).toBe(1024);
  expect([...data.subarray(0, 3)]).toEqual([...PSD_QUADRANTS[0]]);
  expect([...data.subarray(-3)]).toEqual([...PSD_QUADRANTS[3]]);
});

it('rejects truncated and out-of-bounds sections without propagating decode failures', async () => {
  const file = await target();
  await writePsdFixture(file, { width: 12, height: 8 });
  const valid = await readFile(file);
  for (const length of [0, 4, 25, 31, 37, valid.length - 1]) {
    await writeFile(file, valid.subarray(0, length));
    expect(await readPsdPreview(file)).toBeNull();
  }
  const invalid = Buffer.from(valid);
  invalid.writeUInt32BE(0xffff_ffff, 26);
  await writeFile(file, invalid);
  expect(await readPsdPreview(file)).toBeNull();
});

it('rejects oversized dimensions and unsupported channel depths', async () => {
  const file = await target();
  await writePsdFixture(file, { width: 8, height: 8 });
  const original = await readFile(file);
  for (const [offset, value, size] of [
    [18, 0xffff_ffff, 4],
    [22, 32, 2],
    [12, 0, 2],
  ] as const) {
    const data = Buffer.from(original);
    if (size === 4) data.writeUInt32BE(value, offset);
    else data.writeUInt16BE(value, offset);
    await writeFile(file, data);
    expect(await readPsdPreview(file)).toBeNull();
  }
});

it('rejects corrupt PackBits and ZIP payloads without displaying partial pixels', async () => {
  for (const compression of ['rle', 'zip'] as const) {
    const file = await target();
    await writePsdFixture(file, { width: 12, height: 8, compression });
    const handle = await open(file, 'r+');
    try {
      await handle.write(
        Buffer.from([255, 255]),
        0,
        2,
        compression === 'rle' ? 40 : 42,
      );
    } finally {
      await handle.close();
    }
    expect(await readPsdPreview(file)).toBeNull();
  }
});

it('uses an embedded thumbnail even when the merged color mode and depth are unsupported', async () => {
  const file = await target();
  await writePsdFixture(file, {
    width: 12,
    height: 8,
    resources: [{ id: 1036, format: 'raw', color: [70, 80, 90] }],
  });
  const data = await readFile(file);
  data.writeUInt16BE(32, 22);
  data.writeUInt16BE(4, 24);
  await writeFile(file, data);
  expect(await readPsdPreview(file)).toMatchObject({ source: 'resource-1036' });
});

it('falls back to a valid legacy thumbnail when the preferred resource is damaged', async () => {
  const file = await target();
  await writePsdFixture(file, {
    width: 12,
    height: 8,
    resources: [
      { id: 1036, format: 'jpeg', color: [1, 2, 3], invalid: true },
      { id: 1033, format: 'jpeg', color: [210, 40, 20] },
    ],
  });
  expect(await readPsdPreview(file)).toMatchObject({ source: 'resource-1033' });
});

it('does not mistake an extra saved mask channel for transparent composite pixels', async () => {
  const file = await target();
  await writePsdFixture(file, { width: 12, height: 8 });
  const data = await readFile(file);
  data.writeUInt16BE(4, 12);
  await writeFile(file, Buffer.concat([data, Buffer.alloc(12 * 8)]));
  const preview = await readPsdPreview(file);
  const decoded = await sharp(preview!.png)
    .raw()
    .toBuffer({ resolveWithObject: true });
  expect(decoded.info.channels).toBe(3);
  expect([...decoded.data.subarray(0, 3)]).toEqual([...PSD_QUADRANTS[0]]);
});

it('rejects placeholder merged data explicitly marked unavailable by VersionInfo', async () => {
  const file = await target();
  await writePsdFixture(file, { width: 12, height: 8 });
  const data = await readFile(file);
  // VersionInfo: version=1, hasRealMergedData=false. Remaining strings are irrelevant.
  const resource = Buffer.from([
    56, 66, 73, 77, 4, 33, 0, 0, 0, 0, 0, 5, 0, 0, 0, 1, 0, 0,
  ]);
  data.writeUInt32BE(resource.length, 30);
  await writeFile(
    file,
    Buffer.concat([data.subarray(0, 34), resource, data.subarray(34)]),
  );
  expect(await readPsdPreview(file)).toBeNull();
});

it('supports PackBits repeated bytes and no-op packets and rejects row overflow', async () => {
  const file = await target();
  await writePsdFixture(file, { width: 12, height: 8, compression: 'rle' });
  const data = await readFile(file);
  const table = Buffer.alloc(3 * 8 * 2);
  for (let i = 0; i < 24; i++) table.writeUInt16BE(3, i * 2);
  const rows = Buffer.concat(
    Array.from({ length: 24 }, (_, index) =>
      Buffer.from([128, 245, [230, 70, 20][Math.floor(index / 8)]!]),
    ),
  );
  await writeFile(file, Buffer.concat([data.subarray(0, 40), table, rows]));
  const preview = await readPsdPreview(file);
  expect([...(await pixels(preview!.png)).data.subarray(0, 3)]).toEqual([
    230, 70, 20,
  ]);
  rows[1] = 244;
  await writeFile(file, Buffer.concat([data.subarray(0, 40), table, rows]));
  expect(await readPsdPreview(file)).toBeNull();
});

it('bounds ZIP expansion by the declared image extent and rejects truncated streams', async () => {
  const { deflateSync } = await import('node:zlib');
  const file = await target();
  await writePsdFixture(file, { width: 12, height: 8, compression: 'zip' });
  const data = await readFile(file);
  await writeFile(
    file,
    Buffer.concat([
      data.subarray(0, 40),
      deflateSync(Buffer.alloc(16 * 1024 * 1024)),
    ]),
  );
  expect(await readPsdPreview(file)).toBeNull();
  await writeFile(file, data.subarray(0, data.length - 4));
  expect(await readPsdPreview(file)).toBeNull();
});
