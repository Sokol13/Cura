const MAX_PAGES = 32;
const MAX_JPEG_BYTES = 64 * 1024 * 1024;
const PAGE_WIDTH_POINTS = 595.28;
const PAGE_HEIGHT_POINTS = 841.89;

export type PdfBlock =
  | {
      kind: 'text';
      text: string;
      size?: number;
      bold?: boolean;
      fontFamily?: string;
    }
  | { kind: 'image'; dataUrl: string; label?: string }
  | { kind: 'color'; name: string; hex: string; details: string };

const PAGE_WIDTH = 1240;
const PAGE_HEIGHT = 1754;
const MARGIN = 80;
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN * 2;
const FONT_STACK =
  '-apple-system, "PingFang SC", "Microsoft YaHei", "Segoe UI", sans-serif';

async function withTimeout<T>(
  promise: PromiseLike<T>,
  message: string,
): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timeout = setTimeout(() => reject(new Error(message)), 15_000);
      }),
    ]);
  } finally {
    clearTimeout(timeout);
  }
}

/** Rasterized A4 export: text sizes are points; loaded browser fonts retain CJK glyphs. */
export async function createBrandPdf(
  title: string,
  blocks: PdfBlock[],
): Promise<Blob> {
  if (typeof document === 'undefined')
    throw new Error('Brand PDF export requires a browser.');
  let characterCount = title.length;
  for (const block of blocks) {
    if (block.kind === 'text') characterCount += block.text.length;
    if (block.kind === 'color')
      characterCount += block.name.length + block.details.length;
    if (block.kind === 'image') characterCount += block.label?.length ?? 0;
  }
  if (blocks.length > 1000 || characterCount > 500_000) {
    throw new Error(
      'Brand PDF content exceeds the limit of 1,000 blocks or 500,000 characters.',
    );
  }
  if (document.fonts) {
    await withTimeout(
      document.fonts.ready,
      'Font loading timed out. Retry the brand PDF export.',
    );
  }
  const canvas = document.createElement('canvas');
  canvas.width = PAGE_WIDTH;
  canvas.height = PAGE_HEIGHT;
  const pages: { bytes: Uint8Array; width: number; height: number }[] = [];
  let encodedBytes = 0;
  let y = MARGIN;
  try {
    const context = canvas.getContext('2d');
    if (!context)
      throw new Error('Canvas rendering is unavailable for brand PDF export.');
    const clearPage = () => {
      context.fillStyle = '#ffffff';
      context.fillRect(0, 0, PAGE_WIDTH, PAGE_HEIGHT);
      context.fillStyle = '#171717';
      context.textBaseline = 'top';
      y = MARGIN;
    };
    const savePage = async () => {
      if (pages.length >= MAX_PAGES)
        throw new Error('Brand PDF exceeds the limit of 32 pages.');
      const blob = await withTimeout(
        new Promise<Blob>((resolve, reject) => {
          canvas.toBlob(
            (result) => {
              if (result?.type === 'image/jpeg') resolve(result);
              else
                reject(
                  new Error(
                    'The browser could not encode a JPEG page for the brand PDF.',
                  ),
                );
            },
            'image/jpeg',
            0.95,
          );
        }),
        'JPEG encoding timed out. Retry the brand PDF export.',
      );
      encodedBytes += blob.size;
      if (encodedBytes > MAX_JPEG_BYTES)
        throw new Error('Brand PDF images exceed the 64 MiB limit.');
      pages.push({
        bytes: new Uint8Array(await blob.arrayBuffer()),
        width: PAGE_WIDTH,
        height: PAGE_HEIGHT,
      });
    };
    const ensureRoom = async (height: number) => {
      if (y + height <= PAGE_HEIGHT - MARGIN) return;
      await savePage();
      if (pages.length >= MAX_PAGES)
        throw new Error('Brand PDF exceeds the limit of 32 pages.');
      clearPage();
    };
    const segmenter = new Intl.Segmenter(undefined, {
      granularity: 'grapheme',
    });
    const drawText = async (
      value: string,
      size = 11,
      bold = false,
      fontFamily?: string,
    ) => {
      if (!Number.isFinite(size) || size < 4 || size > 72) {
        throw new Error('PDF text size must be between 4 and 72 points.');
      }
      const pixels = (size * 150) / 72;
      const lineHeight = Math.ceil(pixels * 1.45);
      const family = fontFamily
        ? `"${fontFamily.replace(/[\\"]/g, '\\$&').replace(/[\r\n]/g, ' ')}", ${FONT_STACK}`
        : FONT_STACK;
      context.font = `${bold ? '700' : '400'} ${pixels}px ${family}`;
      const drawLine = async (line: string) => {
        await ensureRoom(lineHeight);
        // maxWidth also contains an unusually wide individual grapheme without splitting it.
        context.fillText(line, MARGIN, y, CONTENT_WIDTH);
        y += lineHeight;
      };
      for (const paragraph of value.replace(/\r\n?/g, '\n').split('\n')) {
        let line = '';
        for (const { segment } of segmenter.segment(paragraph)) {
          if (
            line &&
            context.measureText(line + segment).width > CONTENT_WIDTH
          ) {
            await drawLine(line);
            line = '';
          }
          line += segment;
        }
        await drawLine(line);
      }
    };

    clearPage();
    await drawText(title, 24, true);
    y += 24;
    for (const block of blocks) {
      if (block.kind === 'text') {
        await drawText(block.text, block.size, block.bold, block.fontFamily);
      } else if (block.kind === 'color') {
        if (!/^#[\da-f]{6}$/i.test(block.hex))
          throw new Error('Invalid HEX color in brand PDF.');
        await ensureRoom(80);
        context.fillStyle = block.hex;
        context.fillRect(MARGIN, y, CONTENT_WIDTH, 30);
        context.fillStyle = '#171717';
        y += 42;
        await drawText(`${block.name}  ${block.hex.toUpperCase()}`, 11, true);
        if (block.details) await drawText(block.details, 10);
      } else {
        if (
          !/^data:image\/(?:png|jpeg|webp|gif|avif);base64,/i.test(
            block.dataUrl,
          )
        ) {
          throw new Error('PDF logos must use embedded raster image data.');
        }
        const payloadLength =
          block.dataUrl.length - block.dataUrl.indexOf(',') - 1;
        const padding = block.dataUrl.endsWith('==')
          ? 2
          : block.dataUrl.endsWith('=')
            ? 1
            : 0;
        if ((payloadLength * 3) / 4 - padding > 16 * 1024 * 1024) {
          throw new Error(
            'A PDF logo exceeds the 16 MiB embedded image limit.',
          );
        }
        const image = new Image();
        image.decoding = 'async';
        try {
          image.src = block.dataUrl;
          try {
            await withTimeout(image.decode(), 'PDF logo decoding timed out.');
          } catch {
            throw new Error(
              `Unable to decode the PDF logo${block.label ? `: ${block.label}` : '.'}`,
            );
          }
          if (
            !image.naturalWidth ||
            !image.naturalHeight ||
            image.naturalWidth * image.naturalHeight > 20_000_000
          ) {
            throw new Error(
              'PDF logo dimensions must be positive and at most 20 million pixels.',
            );
          }
          const scale = Math.min(
            CONTENT_WIDTH / image.naturalWidth,
            650 / image.naturalHeight,
          );
          const width = image.naturalWidth * scale;
          const height = image.naturalHeight * scale;
          await ensureRoom(height + (block.label ? 42 : 0));
          context.drawImage(
            image,
            MARGIN + (CONTENT_WIDTH - width) / 2,
            y,
            width,
            height,
          );
          y += height + 12;
          if (block.label) await drawText(block.label, 10);
        } finally {
          image.src = '';
        }
      }
      y += 18;
    }
    await savePage();
    const bytes = encodeImagePdf(pages);
    return new Blob([new Uint8Array(bytes).buffer], {
      type: 'application/pdf',
    });
  } finally {
    canvas.width = 0;
    canvas.height = 0;
  }
}

/** Encode JPEG pages with byte-counted streams and cross references. */
export function encodeImagePdf(
  pages: { bytes: Uint8Array; width: number; height: number }[],
): Uint8Array {
  if (pages.length === 0) throw new Error('A PDF needs at least one page.');
  if (pages.length > MAX_PAGES)
    throw new Error('Brand PDF exceeds the limit of 32 pages.');
  let jpegBytes = 0;
  for (const { bytes, width, height } of pages) {
    if (
      !Number.isInteger(width) ||
      !Number.isInteger(height) ||
      width <= 0 ||
      height <= 0 ||
      width > 10_000 ||
      height > 10_000 ||
      width * height > 20_000_000
    ) {
      throw new Error('Invalid PDF image dimensions.');
    }
    if (
      bytes.length < 4 ||
      bytes[0] !== 0xff ||
      bytes[1] !== 0xd8 ||
      bytes[bytes.length - 2] !== 0xff ||
      bytes[bytes.length - 1] !== 0xd9
    ) {
      throw new Error('PDF pages must contain complete JPEG image bytes.');
    }
    jpegBytes += bytes.byteLength;
    if (jpegBytes > MAX_JPEG_BYTES)
      throw new Error('Brand PDF images exceed the 64 MiB limit.');
  }

  const encoder = new TextEncoder();
  const chunks: Uint8Array[] = [];
  const offsets: number[] = [0];
  let length = 0;
  const append = (bytes: Uint8Array) => {
    chunks.push(bytes);
    length += bytes.byteLength;
  };
  const text = (value: string) => append(encoder.encode(value));
  const object = (id: number, value: string) => {
    offsets[id] = length;
    text(`${id} 0 obj\n${value}\nendobj\n`);
  };
  const stream = (id: number, dictionary: string, bytes: Uint8Array) => {
    offsets[id] = length;
    text(
      `${id} 0 obj\n<< ${dictionary}/Length ${bytes.byteLength} >>\nstream\n`,
    );
    append(bytes);
    text('\nendstream\nendobj\n');
  };
  text('%PDF-1.4\n%');
  append(new Uint8Array([0xe2, 0xe3, 0xcf, 0xd3, 0x0a]));
  object(1, '<< /Type /Catalog /Pages 2 0 R >>');
  object(
    2,
    `<< /Type /Pages /Count ${pages.length} /Kids [${pages.map((_, index) => `${3 + index * 3} 0 R`).join(' ')}] >>`,
  );
  pages.forEach(({ bytes, width, height }, index) => {
    const id = 3 + index * 3;
    object(
      id,
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_WIDTH_POINTS} ${PAGE_HEIGHT_POINTS}] /Resources << /XObject << /Im0 ${id + 1} 0 R >> >> /Contents ${id + 2} 0 R >>`,
    );
    stream(
      id + 1,
      `/Type /XObject /Subtype /Image /Width ${width} /Height ${height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode `,
      bytes,
    );
    stream(
      id + 2,
      '',
      encoder.encode(
        `q\n${PAGE_WIDTH_POINTS} 0 0 ${PAGE_HEIGHT_POINTS} 0 0 cm\n/Im0 Do\nQ\n`,
      ),
    );
  });
  const xrefOffset = length;
  text(`xref\n0 ${offsets.length}\n0000000000 65535 f \n`);
  for (const offset of offsets.slice(1))
    text(`${String(offset).padStart(10, '0')} 00000 n \n`);
  text(
    `trailer\n<< /Size ${offsets.length} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`,
  );
  const result = new Uint8Array(length);
  let cursor = 0;
  for (const chunk of chunks) {
    result.set(chunk, cursor);
    cursor += chunk.byteLength;
  }
  return result;
}
