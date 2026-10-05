import { deflateSync } from 'node:zlib';

const signature = Buffer.from('89504e470d0a1a0a', 'hex');

export function chunk(type: string, data: Buffer): Buffer {
  const bytes = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  const header = Buffer.alloc(4);
  header.writeUInt32BE(data.length);
  const trailer = Buffer.alloc(4);
  trailer.writeUInt32BE((crc ^ 0xffffffff) >>> 0);
  return Buffer.concat([header, bytes, trailer]);
}

export function textChunk(
  key: string,
  value: string | Buffer,
  type: 'tEXt' | 'zTXt' | 'iTXt' = 'tEXt',
  compressed = false,
): Buffer {
  const prefix = Buffer.from(`${key}\0`, 'latin1');
  const content = Buffer.isBuffer(value)
    ? value
    : Buffer.from(value, type === 'iTXt' ? 'utf8' : 'latin1');
  if (type === 'tEXt') return chunk(type, Buffer.concat([prefix, content]));
  if (type === 'zTXt')
    return chunk(
      type,
      Buffer.concat([prefix, Buffer.from([0]), deflateSync(content)]),
    );
  return chunk(
    type,
    Buffer.concat([
      prefix,
      Buffer.from([compressed ? 1 : 0, 0, 0, 0]),
      compressed ? deflateSync(content) : content,
    ]),
  );
}

export function createMetadataPng(...metadata: Buffer[]): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(1, 0);
  ihdr.writeUInt32BE(1, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([
    signature,
    chunk('IHDR', ihdr),
    ...metadata,
    chunk('IDAT', deflateSync(Buffer.from([0, 255, 0, 0, 255]))),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}
