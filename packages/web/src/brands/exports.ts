import type { BrandColor, BrandPackage } from '@cura/shared';
import { createBrandPdf, type PdfBlock } from './pdf';

const escape = (text: string) =>
  text.replace(
    /[&<>"']/g,
    (character) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[
        character
      ]!,
  );
export function markdownHtml(markdown: string): string {
  const inline = (text: string) =>
    escape(text)
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .replace(/`([^`]+)`/g, '<code>$1</code>');
  return markdown
    .split(/\r?\n/)
    .map((line) => {
      const heading = /^(#{1,6})\s+(.+)$/.exec(line);
      if (heading)
        return `<h${heading[1]!.length}>${inline(heading[2]!)}</h${heading[1]!.length}>`;
      if (/^[-*]\s+/.test(line))
        return `<p class="bullet">• ${inline(line.slice(2))}</p>`;
      return line.trim() ? `<p>${inline(line)}</p>` : '<br>';
    })
    .join('\n');
}
function bytesUrl(base64: string, type = 'application/octet-stream'): string {
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(base64))
    throw new Error('Invalid embedded file');
  return `data:${type};base64,${base64}`;
}
function preview(data: BrandPackage, versionId: string): string {
  const value = data.files.find(
    (file) => file.versionId === versionId,
  )?.previewDataUrl;
  if (
    !value ||
    !/^data:image\/(?:webp|png|jpeg);base64,[A-Za-z0-9+/]+=*$/.test(value)
  )
    throw new Error('PREVIEW_UNAVAILABLE');
  return value;
}
function fontMime(name: string): string {
  const extension = name.toLowerCase().split('.').at(-1);
  return extension === 'woff2'
    ? 'font/woff2'
    : extension === 'woff'
      ? 'font/woff'
      : extension === 'otf'
        ? 'font/otf'
        : 'font/ttf';
}
export function makeBrandHtml(data: BrandPackage): string {
  const { brand } = data;
  const fonts = brand.fonts.map((font, index) => {
    const file = data.files.find(
      (file) => file.versionId === font.pin.versionId,
    );
    if (!file) throw new Error('Missing font bytes');
    return { font, file, index };
  });
  const styles = fonts
    .map(
      ({ file, index }) =>
        `@font-face{font-family:cura-font-${index};src:url("${bytesUrl(file.base64, fontMime(file.name))}")}`,
    )
    .join('\n');
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; font-src data:; style-src 'unsafe-inline'"><title>${escape(brand.name)}</title><style>${styles}
body{font-family:-apple-system,"PingFang SC","Microsoft YaHei","Segoe UI",sans-serif;color:#17212b;background:white;margin:40px auto;padding:24px;max-width:960px;line-height:1.6}h1{font-size:40px}h2{border-top:1px solid #ddd;padding-top:24px}article{margin:20px 0;break-inside:avoid}img{max-width:420px;max-height:280px;object-fit:contain}.swatch{display:inline-block;width:72px;height:48px;border:1px solid #aaa;vertical-align:middle;margin-right:16px}small{color:#52606c}code{background:#eee;padding:2px 4px}.bullet{margin-left:20px}a{color:#a3410b}.sample{font-size:28px;overflow-wrap:anywhere}</style></head><body><h1>${escape(brand.name)}</h1><small>Cura · Brand kit / 品牌套件 · ${escape(brand.updatedAt)}</small><h2>Palette / 色板</h2>${brand.colors.map((color) => `<article><span class="swatch" style="background:${color.hex}"></span><strong>${escape(color.name)}</strong><p>${color.hex} · RGB ${color.rgb.join(', ')} · CMYK ${color.cmyk.join(', ')}%</p></article>`).join('')}<small>CMYK: unprofiled approximation / 未经 ICC 配置的近似值</small><h2>Typography / 字体</h2>${fonts.map(({ font, file, index }) => `<article><h3>${escape(font.name)}</h3><p>${escape(font.role)} · ${escape(file.name)}</p><p class="sample" style="font-family:cura-font-${index},sans-serif">Aa Bb 0123456789 · 品牌视觉规范</p><a download="${escape(file.name)}" href="${bytesUrl(file.base64)}">Download font / 下载字体</a></article>`).join('')}<h2>Logo variants / 标志变体</h2>${brand.logos
    .map((logo) => {
      const file = data.files.find(
        (file) => file.versionId === logo.pin.versionId,
      )!;
      return `<article><h3>${escape(logo.name)}</h3><img alt="${escape(logo.name)}" src="${preview(data, logo.pin.versionId)}"><p><a download="${escape(file.name)}" href="${bytesUrl(file.base64)}">Download original / 下载原文件</a></p></article>`;
    })
    .join(
      '',
    )}<h2>Guidelines / 使用规范</h2><section>${markdownHtml(brand.guidelines)}</section></body></html>`;
}
export function encodeAse(colors: BrandColor[]): Uint8Array {
  const blocks = colors.map((color) => {
    const chars = color.name.length + 1,
      length = 2 + chars * 2 + 4 + 12 + 2;
    const bytes = new Uint8Array(6 + length),
      view = new DataView(bytes.buffer);
    view.setUint16(0, 1);
    view.setUint32(2, length);
    view.setUint16(6, chars);
    for (let index = 0; index < color.name.length; index++)
      view.setUint16(8 + index * 2, color.name.charCodeAt(index));
    const offset = 8 + chars * 2;
    bytes.set(new TextEncoder().encode('RGB '), offset);
    color.rgb.forEach((value, index) =>
      view.setFloat32(offset + 4 + index * 4, value / 255),
    );
    view.setUint16(offset + 16, 2);
    return bytes;
  });
  const bytes = new Uint8Array(
      12 + blocks.reduce((sum, block) => sum + block.length, 0),
    ),
    view = new DataView(bytes.buffer);
  bytes.set(new TextEncoder().encode('ASEF'));
  view.setUint16(4, 1);
  view.setUint16(6, 0);
  view.setUint32(8, blocks.length);
  let offset = 12;
  for (const block of blocks) {
    bytes.set(block, offset);
    offset += block.length;
  }
  return bytes;
}
export async function brandPdf(data: BrandPackage): Promise<Blob> {
  const blocks: PdfBlock[] = [
    { kind: 'text', text: 'Palette / 色板', size: 18, bold: true },
    ...data.brand.colors.map((color) => ({
      kind: 'color' as const,
      name: color.name,
      hex: color.hex,
      details: `${color.hex} · RGB ${color.rgb.join(', ')} · CMYK ${color.cmyk.join(', ')}%`,
    })),
    {
      kind: 'text',
      text: 'CMYK: unprofiled approximation / 未经 ICC 配置的近似值',
      size: 9,
    },
    { kind: 'text', text: 'Typography / 字体', size: 18, bold: true },
  ];
  const loaded: FontFace[] = [];
  try {
    for (const [index, font] of data.brand.fonts.entries()) {
      const file = data.files.find(
        (file) => file.versionId === font.pin.versionId,
      )!;
      let family = 'sans-serif',
        unsupported = false;
      try {
        const face = new FontFace(
          `cura-export-${index}`,
          `url(${bytesUrl(file.base64, fontMime(file.name))})`,
        );
        await face.load();
        document.fonts.add(face);
        loaded.push(face);
        family = face.family;
      } catch {
        unsupported = true;
      }
      blocks.push(
        {
          kind: 'text',
          text: `${font.name} — ${font.role} (${file.name})`,
          bold: true,
        },
        {
          kind: 'text',
          text: 'Aa Bb 0123456789 · 品牌视觉规范',
          size: 16,
          fontFamily: family,
        },
      );
      if (unsupported)
        blocks.push({
          kind: 'text',
          text: 'Font preview unavailable; original font included in HTML/JSON. / 字体预览不可用，原文件保留在 HTML/JSON。',
          size: 9,
        });
    }
    blocks.push({
      kind: 'text',
      text: 'Logo variants / 标志变体',
      size: 18,
      bold: true,
    });
    for (const logo of data.brand.logos)
      blocks.push(
        { kind: 'text', text: logo.name, bold: true },
        {
          kind: 'image',
          dataUrl: preview(data, logo.pin.versionId),
          label: logo.name,
        },
      );
    blocks.push({
      kind: 'text',
      text: 'Guidelines / 使用规范',
      size: 18,
      bold: true,
    });
    for (const line of data.brand.guidelines.split(/\r?\n/)) {
      const heading = /^(#{1,6})\s+(.+)$/.exec(line);
      blocks.push({
        kind: 'text',
        text: heading
          ? heading[2]!
          : line.replace(/\*\*([^*]+)\*\*/g, '$1').replace(/`([^`]+)`/g, '$1'),
        size: heading ? 16 : 11,
        bold: Boolean(heading),
      });
    }
    return await createBrandPdf(data.brand.name, blocks);
  } finally {
    for (const font of loaded) document.fonts.delete(font);
  }
}
export function downloadBlob(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob),
    link = document.createElement('a');
  link.href = url;
  link.download = Array.from(name, (character) =>
    character.charCodeAt(0) < 32 || /[\\/:*?"<>|]/.test(character)
      ? '_'
      : character,
  ).join('');
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
