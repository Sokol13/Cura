import { describe, expect, it } from 'vitest';
import { BrandPackageSchema } from '@cura/shared';
import { encodeAse, makeBrandHtml, markdownHtml } from './exports';
const id = '00000000-0000-4000-8000-000000000001',
  date = '2026-10-04T00:00:00.000Z';
const data = BrandPackageSchema.parse({
  format: 'cura-brand',
  schemaVersion: 1,
  colorSpace: 'sRGB; CMYK is an unprofiled approximation',
  brand: {
    id,
    libraryId: id,
    name: '中文品牌',
    guidelines:
      '# 安全\n<script>window.BAD=1</script>\n![外部](https://example.com/a.png)',
    revision: 0,
    createdAt: date,
    updatedAt: date,
    colors: [
      {
        id,
        brandId: id,
        name: '红色🌟',
        hex: '#ff0000',
        rgb: [255, 0, 0],
        cmyk: [0, 100, 100, 0],
        position: 0,
        createdAt: date,
        updatedAt: date,
      },
    ],
    fonts: [],
    logos: [],
  },
  files: [],
});
describe('portable brand formats', () => {
  it('escapes active Markdown and makes a standalone offline Chinese document', () => {
    const html = makeBrandHtml(data);
    expect(html).toContain('中文品牌');
    expect(html).toContain('RGB 255, 0, 0');
    expect(html).toContain('&lt;script&gt;');
    expect(html).not.toContain('<script>');
    expect(html).not.toContain('src="https://');
    expect(html).toContain("default-src 'none'");
    expect(markdownHtml('## Title\n- **Strong**\n`code`')).toContain(
      '<strong>Strong</strong>',
    );
  });
  it('writes standard ASE block lengths Unicode names and RGB channels', () => {
    const bytes = encodeAse(data.brand.colors),
      view = new DataView(bytes.buffer);
    expect(new TextDecoder().decode(bytes.slice(0, 4))).toBe('ASEF');
    expect(view.getUint16(4)).toBe(1);
    expect(view.getUint32(8)).toBe(1);
    expect(view.getUint16(12)).toBe(1);
    const length = view.getUint32(14),
      chars = view.getUint16(18);
    let label = '';
    for (let index = 0; index < chars - 1; index++)
      label += String.fromCharCode(view.getUint16(20 + index * 2));
    expect(label).toBe('红色🌟');
    const offset = 20 + chars * 2;
    expect(new TextDecoder().decode(bytes.slice(offset, offset + 4))).toBe(
      'RGB ',
    );
    expect(
      [0, 1, 2].map((index) => view.getFloat32(offset + 4 + index * 4)),
    ).toEqual([1, 0, 0]);
    expect(view.getUint16(offset + 16)).toBe(2);
    expect(18 + length).toBe(bytes.length);
  });
});
