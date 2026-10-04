import { createHash } from 'node:crypto';
import {
  mkdtemp,
  open,
  readFile,
  readdir,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { afterEach, describe, expect, it } from 'vitest';

import { processFile } from '../src/media/image.js';
import { createMetadataPng, textChunk } from './media-fixtures.js';

const directories: string[] = [];
async function fixture(name: string, bytes: Buffer) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'cura-image-'));
  directories.push(root);
  const filePath = path.join(root, name);
  await writeFile(filePath, bytes);
  return {
    filePath,
    dataDir: path.join(root, 'data'),
    cacheDir: path.join(root, 'cache'),
  };
}

async function stripes() {
  const colors = [
    '#ff0000',
    '#00ff00',
    '#0000ff',
    '#ffff00',
    '#ff00ff',
    '#00ffff',
  ];
  return sharp(
    Buffer.from(
      `<svg width="120" height="80">${colors.map((color, i) => `<rect x="${i * 20}" width="20" height="80" fill="${color}"/>`).join('')}</svg>`,
    ),
  )
    .png()
    .toBuffer();
}

afterEach(async () => {
  await Promise.all(
    directories
      .splice(0)
      .map((dir) => rm(dir, { force: true, recursive: true })),
  );
});

describe('image processing', () => {
  it('extracts exact Unicode generation metadata from the same retained PNG', async () => {
    const raw =
      '中国陶瓷杯\nNegative prompt: 水印\nSteps: 20, Seed: 18446744073709551615, Model: studio-v1';
    const bytes = createMetadataPng(textChunk('parameters', raw, 'iTXt', true));
    const input = await fixture('中国.png', bytes);
    const result = await processFile(input);
    expect(result.generation).toMatchObject({
      prompt: '中国陶瓷杯',
      negativePrompt: '水印',
      seed: '18446744073709551615',
      model: 'studio-v1',
      source: 'sd-webui',
    });
    expect(result.width).toBe(1);
    expect(result.thumbnailPath).not.toBeNull();
    expect(await readFile(result.snapshotPath)).toEqual(bytes);
  });

  it('rejects a continuously rewritten source without publishing an unstable snapshot', async () => {
    const input = await fixture('writing.bin', Buffer.alloc(32 * 1024 * 1024));
    const source = await open(input.filePath, 'r+');
    const pending: Promise<unknown>[] = [];
    let marker = 0;
    const writer = setInterval(() => {
      pending.push(source.write(Buffer.from([marker++ % 256]), 0, 1, 0));
    }, 1);
    try {
      await expect(processFile(input)).rejects.toThrow(/changed during import/);
      expect(await readdir(path.join(input.dataDir, 'objects'))).toEqual([]);
    } finally {
      clearInterval(writer);
      await Promise.all(pending);
      await source.close();
    }
  });

  it('retains bounded-parser warnings when an oversized PNG text chunk is skipped', async () => {
    const bytes = createMetadataPng(
      textChunk('parameters', 'x'.repeat(1024 * 1024 + 1)),
    );
    const result = await processFile(
      await fixture('large-metadata.png', bytes),
    );
    expect(result.generation.prompt).toBe('');
    expect(result.generation.params.warnings).toEqual(
      expect.arrayContaining([expect.stringMatching(/limit|size/i)]),
    );
    expect(await readFile(result.snapshotPath)).toEqual(bytes);
  });

  it('derives dimensions, dominant colors, perceptual hash and preview from retained PNG bytes', async () => {
    const bytes = await stripes();
    const input = await fixture('素材咖啡e\u0301.png', bytes);
    const before = await stat(input.filePath);
    const result = await processFile(input);
    expect(result.hash).toBe(createHash('sha256').update(bytes).digest('hex'));
    expect(result.size).toBe(bytes.length);
    expect(result.type).toBe('image/png');
    expect([result.width, result.height]).toEqual([120, 80]);
    expect(result.colors.length).toBeGreaterThanOrEqual(5);
    expect(result.colors.length).toBeLessThanOrEqual(8);
    expect(result.colors).toContain('#ff0000');
    expect(result.phash).toMatch(/^[a-f0-9]{16}$/);
    expect(path.isAbsolute(result.snapshotPath)).toBe(true);
    expect(path.relative(input.dataDir, result.snapshotPath)).not.toMatch(
      /^\.\./,
    );
    expect(await readFile(result.snapshotPath)).toEqual(bytes);
    expect(result.thumbnailPath).not.toBeNull();
    expect((await sharp(result.thumbnailPath!).metadata()).format).toBe('webp');
    expect((await stat(input.filePath)).mtimeMs).toBe(before.mtimeMs);
    expect(await readFile(input.filePath)).toEqual(bytes);
    expect(result.generation).toMatchObject({
      prompt: '',
      negativePrompt: '',
      model: '',
      seed: '',
      source: '',
    });
  });

  it('retains immutable old bytes after external replacement and deduplicates repeated content', async () => {
    const oldBytes = await stripes();
    const input = await fixture('image.png', oldBytes);
    const first = await processFile(input);
    expect((await processFile(input)).snapshotPath).toBe(first.snapshotPath);
    const newBytes = await sharp({
      create: { width: 30, height: 20, channels: 3, background: '#334455' },
    })
      .png()
      .toBuffer();
    await writeFile(input.filePath, newBytes);
    const second = await processFile(input);
    expect(first.hash).not.toBe(second.hash);
    expect(await readFile(first.snapshotPath)).toEqual(oldBytes);
    expect(await readFile(second.snapshotPath)).toEqual(newBytes);
    expect(
      (await readdir(path.dirname(first.snapshotPath))).some((entry) =>
        entry.endsWith('.tmp'),
      ),
    ).toBe(false);
  });

  it.each(['jpeg', 'webp', 'gif', 'avif'] as const)(
    'creates a raster preview for %s',
    async (format) => {
      const bytes = await sharp(await stripes())
        .toFormat(format)
        .toBuffer();
      const result = await processFile(await fixture(`image.${format}`, bytes));
      expect(result.type).toBe(`image/${format}`);
      expect(result.width).toBe(120);
      expect(result.thumbnailPath).not.toBeNull();
    },
  );

  it('rasterizes SVG previews', async () => {
    const result = await processFile(
      await fixture(
        'image.svg',
        Buffer.from(
          '<svg xmlns="http://www.w3.org/2000/svg" width="40" height="30"><rect width="40" height="30" fill="red"/></svg>',
        ),
      ),
    );
    expect(result.type).toBe('image/svg+xml');
    expect(result.width).toBe(40);
    expect((await sharp(result.thumbnailPath!).metadata()).format).toBe('webp');
  });

  it.each(['broken.png', 'document.custom'])(
    'preserves unsupported or corrupt %s with generic preview fields',
    async (name) => {
      const bytes = Buffer.from('unrecognized or broken file bytes');
      const result = await processFile(await fixture(name, bytes));
      expect(await readFile(result.snapshotPath)).toEqual(bytes);
      expect(result.width).toBeNull();
      expect(result.height).toBeNull();
      expect(result.thumbnailPath).toBeNull();
      expect(result.colors).toEqual([]);
      expect(result.phash).toBe('');
    },
  );

  it('extracts EXIF from JPEG and keeps a perceptual hash stable across re-encoding', async () => {
    const source = sharp(await stripes());
    const jpeg = await source
      .clone()
      .jpeg({ quality: 95 })
      .withExif({
        IFD0: {
          Artist: 'Cura fixture',
          ImageDescription: 'Original test metadata',
        },
      })
      .toBuffer();
    const original = await processFile(
      await fixture('image.png', await source.clone().png().toBuffer()),
    );
    const encoded = await processFile(await fixture('photo.jpg', jpeg));
    expect(encoded.exif.Artist).toBe('Cura fixture');
    const bits = (BigInt(`0x${original.phash}`) ^ BigInt(`0x${encoded.phash}`))
      .toString(2)
      .replaceAll('0', '').length;
    expect(bits).toBeLessThanOrEqual(12);
  });
});
