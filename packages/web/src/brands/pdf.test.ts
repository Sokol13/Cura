// @vitest-environment node
import { getDocument, OPS } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createBrandPdf, encodeImagePdf } from './pdf';

// A real 2 × 2 orange JPEG, generated with sharp and independently decoded by PDF.js.
const jpeg = Uint8Array.from(
  Buffer.from(
    '/9j/2wBDAAIBAQEBAQIBAQECAgICAgQDAgICAgUEBAMEBgUGBgYFBgYGBwkIBgcJBwYGCAsICQoKCgoKBggLDAsKDAkKCgr/2wBDAQICAgICAgUDAwUKBwYHCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgr/wAARCAACAAIDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAf/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAACAn/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIRAxEAPwCdgAGrY//Z',
    'base64',
  ),
);
const page = { bytes: jpeg, width: 2, height: 2 };

afterEach(() => vi.unstubAllGlobals());

function canvasHarness(fontsReady: Promise<unknown> = Promise.resolve()) {
  const drawn: { text: string; x: number; y: number; width: number }[][] = [];
  let current: (typeof drawn)[number] = [];
  const context = {
    font: '',
    fillStyle: '',
    textBaseline: '',
    fillRect() {},
    measureText(text: string) {
      return { width: Array.from(text).length * 12 };
    },
    fillText(
      text: string,
      x: number,
      y: number,
      width = Number.POSITIVE_INFINITY,
    ) {
      current.push({
        text,
        x,
        y,
        width: Math.min(width, this.measureText(text).width),
      });
    },
  };
  const canvas = {
    width: 0,
    height: 0,
    getContext: () => context,
    toBlob(callback: BlobCallback) {
      drawn.push(current);
      current = [];
      callback(new Blob([jpeg], { type: 'image/jpeg' }));
    },
  };
  vi.stubGlobal('document', {
    fonts: { ready: fontsReady },
    createElement: () => canvas,
  });
  return { canvas, drawn };
}

describe('image PDF writer', () => {
  it('writes exact binary cross-reference offsets and stream lengths', () => {
    const bytes = encodeImagePdf([page, page]);
    const source = Buffer.from(bytes).toString('latin1');
    const start = Number(/startxref\n(\d+)\n%%EOF/.exec(source)?.[1]);
    expect(source.slice(start, start + 4)).toBe('xref');
    const xref = source.slice(start).split('\n');
    const count = Number(xref[1]?.split(' ')[1]);
    expect(count).toBe(9);
    expect(xref[2]).toBe('0000000000 65535 f ');
    for (let id = 1; id < count; id += 1) {
      const offset = Number(xref[id + 2]?.slice(0, 10));
      expect(source.slice(offset, offset + `${id} 0 obj`.length)).toBe(
        `${id} 0 obj`,
      );
    }
    const streamHeaders = [...source.matchAll(/\/Length (\d+) >>\nstream\n/g)];
    expect(streamHeaders).toHaveLength(4);
    for (const match of streamHeaders) {
      const offset = match.index + match[0].length;
      const length = Number(match[1]);
      expect(source.slice(offset + length, offset + length + 10)).toBe(
        '\nendstream',
      );
      if (length === jpeg.byteLength) {
        expect(bytes.slice(offset, offset + length)).toEqual(jpeg);
      }
    }
  });

  it('independently parses every A4 page and decodes its image', async () => {
    const task = getDocument({
      data: encodeImagePdf([page, page]),
      useSystemFonts: true,
    });
    try {
      const pdf = await task.promise;
      expect(pdf.numPages).toBe(2);
      for (let index = 1; index <= pdf.numPages; index += 1) {
        const decoded = await pdf.getPage(index);
        expect(decoded.view).toEqual([0, 0, 595.28, 841.89]);
        const operators = await decoded.getOperatorList();
        const imageIndex = operators.fnArray.indexOf(OPS.paintImageXObject);
        expect(imageIndex).toBeGreaterThanOrEqual(0);
        expect(operators.argsArray[imageIndex]?.slice(1)).toEqual([2, 2]);
        const imageId: unknown = operators.argsArray[imageIndex]?.[0];
        expect(typeof imageId).toBe('string');
        const image: { width: number; height: number; data: Uint8Array } =
          decoded.objs.get(String(imageId));
        expect(image.width).toBe(2);
        expect(image.height).toBe(2);
        expect(image.data[0]).toBeGreaterThan(220);
        expect(image.data[1]).toBeGreaterThan(50);
        expect(image.data[1]).toBeLessThan(85);
        expect(image.data[2]).toBeLessThan(10);
      }
    } finally {
      await task.destroy();
    }
  });

  it('rejects empty or unbounded page lists', () => {
    expect(() => encodeImagePdf([])).toThrow(/at least one/i);
    expect(() =>
      encodeImagePdf(Array.from({ length: 33 }, () => page)),
    ).toThrow(/32 pages/);
  });

  it('rejects invalid image geometry and non-JPEG page bytes', () => {
    for (const width of [
      0,
      -1,
      1.5,
      Number.NaN,
      Number.POSITIVE_INFINITY,
      50_000,
    ]) {
      expect(() => encodeImagePdf([{ ...page, width }])).toThrow(/dimensions/i);
    }
    expect(() =>
      encodeImagePdf([{ ...page, bytes: new Uint8Array([255, 216]) }]),
    ).toThrow(/JPEG/i);
  });
});

describe('brand PDF canvas layout', () => {
  it('waits for font loading, wraps graphemes, and preserves explicit line breaks across pages', async () => {
    let ready = () => {};
    const fontsReady = new Promise<void>((resolve) => {
      ready = resolve;
    });
    const { drawn, canvas } = canvasHarness(fontsReady);
    const family = '👩‍👩‍👧‍👦';
    const lines = Array.from(
      { length: 150 },
      (_, index) => `中文 ${index} ${family.repeat(20)}`,
    );
    const pending = createBrandPdf('品牌规范', [
      { kind: 'text', text: lines.join('\n') },
    ]);
    await Promise.resolve();
    expect(drawn).toHaveLength(0);
    ready();
    const blob = await pending;
    expect(blob.type).toBe('application/pdf');
    expect(drawn.length).toBeGreaterThan(2);
    const strings = drawn.flat().map((item) => item.text);
    expect(strings.join('')).toContain('品牌规范');
    expect(strings.join('')).toContain('中文 149');
    expect(
      strings
        .filter((line) => line.includes('👩'))
        .every((line) => !/^[‍👧👦]|‍$/u.test(line)),
    ).toBe(true);
    expect(strings.join('').replace('品牌规范', '')).toBe(lines.join(''));
    expect(
      drawn
        .flat()
        .every(
          ({ x, y, width }) =>
            x >= 0 && x + width <= 1240 && y >= 0 && y < 1754,
        ),
    ).toBe(true);
    expect(canvas.width).toBe(0);
    expect(canvas.height).toBe(0);
    const task = getDocument({
      data: new Uint8Array(await blob.arrayBuffer()),
    });
    try {
      expect((await task.promise).numPages).toBe(drawn.length);
    } finally {
      await task.destroy();
    }
  });

  it('fails explicitly for excessive pagination and releases its canvas', async () => {
    const { canvas } = canvasHarness();
    await expect(
      createBrandPdf('Long', [{ kind: 'text', text: 'line\n'.repeat(5000) }]),
    ).rejects.toThrow(/32 pages/);
    expect(canvas.width).toBe(0);
    expect(canvas.height).toBe(0);
  });

  it('rejects external image URLs and invalid color swatches', async () => {
    canvasHarness();
    await expect(
      createBrandPdf('Brand', [
        { kind: 'image', dataUrl: 'https://example.com/logo.png' },
      ]),
    ).rejects.toThrow(/embedded raster/i);
    await expect(
      createBrandPdf('Brand', [
        { kind: 'color', name: 'Bad', hex: 'red', details: '' },
      ]),
    ).rejects.toThrow(/hex/i);
  });

  it('bounds decoded embedded-image bytes before attempting to decode the image', async () => {
    canvasHarness();
    const dataUrl = `data:image/png;base64,${'A'.repeat(4 * Math.ceil((16 * 1024 * 1024 + 3) / 3))}`;
    await expect(
      createBrandPdf('Brand', [{ kind: 'image', dataUrl }]),
    ).rejects.toThrow(/16 MiB/);
  });
});
