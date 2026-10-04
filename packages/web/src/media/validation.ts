export const PIXEL_LIMIT = 16_000_000;
export function validateObj(text: string): void {
  let vertices = 0,
    faces = 0,
    renderedVertices = 0;
  // Match OBJLoader's CRLF, continuation and leading-whitespace handling.
  for (const raw of text
    .replace(/\r\n/g, '\n')
    .replace(/\\\n/g, '')
    .split('\n')) {
    const line = raw.trimStart();
    if (/^(?:mtllib|map_\w+)\s/.test(line))
      throw new Error('EXTERNAL_RESOURCE');
    if (/^v\s/.test(line)) vertices++;
    if (line.startsWith('f')) {
      const count = line.slice(1).trim().split(/\s+/).length;
      if (count > 32) throw new Error('MODEL_LIMIT');
      if (count < 3) throw new Error('INVALID_FILE');
      faces++;
      renderedVertices += (count - 2) * 3;
    }
    if (vertices > 250000 || faces > 250000 || renderedVertices > 750000)
      throw new Error('MODEL_LIMIT');
  }
  if (!vertices || !faces) throw new Error('INVALID_FILE');
}
export function validatePsd(bytes: Uint8Array): {
  width: number;
  height: number;
} {
  if (
    bytes.length < 40 ||
    String.fromCharCode(...bytes.subarray(0, 4)) !== '8BPS'
  )
    throw new Error('INVALID_FILE');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength),
    width = view.getUint32(18),
    height = view.getUint32(14);
  if (
    !width ||
    !height ||
    width > 30000 ||
    height > 30000 ||
    width * height > PIXEL_LIMIT
  )
    throw new Error('PIXEL_LIMIT');
  if (
    view.getUint16(4) !== 1 ||
    view.getUint16(22) !== 8 ||
    view.getUint16(24) !== 3 ||
    ![3, 4].includes(view.getUint16(12))
  )
    throw new Error('UNSUPPORTED_FORMAT');
  let offset = 26;
  for (let section = 0; section < 3; section++) {
    if (offset + 4 > bytes.length) throw new Error('INVALID_FILE');
    const length = view.getUint32(offset);
    if (section === 2 && length > 16 * 1024 * 1024)
      throw new Error('SIZE_LIMIT');
    offset += 4 + length;
    if (offset > bytes.length) throw new Error('INVALID_FILE');
  }
  if (offset + 2 > bytes.length) throw new Error('INVALID_FILE');
  if (view.getUint16(offset) > 1) throw new Error('UNSUPPORTED_FORMAT');
  return { width, height };
}
export function validateModel(input: unknown, binary?: Uint8Array): void {
  if (!input || typeof input !== 'object' || Array.isArray(input))
    throw new Error('INVALID_FILE');
  const model = input as Record<string, unknown>;
  for (const key of ['nodes', 'meshes', 'materials', 'images'])
    if (Array.isArray(model[key]) && model[key].length > 2048)
      throw new Error('MODEL_LIMIT');
  if (
    Array.isArray(model.extensionsRequired) &&
    model.extensionsRequired.length
  )
    throw new Error('UNSUPPORTED_FORMAT');
  let textureTotal = 0;
  if (Array.isArray(model.images))
    for (const item of model.images) {
      if (!item || typeof item !== 'object') throw new Error('INVALID_FILE');
      const source = item as Record<string, unknown>;
      let bytes: Uint8Array;
      if (typeof source.uri === 'string') {
        if (!/^data:image\/(png|jpeg);base64,[a-zA-Z0-9+/=]+$/.test(source.uri))
          throw new Error('EXTERNAL_RESOURCE');
        if (source.uri.length > 16 * 1024 * 1024) throw new Error('SIZE_LIMIT');
        bytes = Uint8Array.from(atob(source.uri.split(',')[1]!), (c) =>
          c.charCodeAt(0),
        );
      } else {
        const view =
          Array.isArray(model.bufferViews) &&
          typeof source.bufferView === 'number'
            ? (model.bufferViews[source.bufferView] as
                | Record<string, unknown>
                | undefined)
            : undefined;
        if (!view || view.buffer !== 0 || !binary)
          throw new Error('INVALID_FILE');
        const offset = view.byteOffset ?? 0,
          length = view.byteLength;
        if (
          typeof offset !== 'number' ||
          typeof length !== 'number' ||
          !Number.isSafeInteger(offset) ||
          !Number.isSafeInteger(length) ||
          offset < 0 ||
          length < 0 ||
          offset + length > binary.length
        )
          throw new Error('INVALID_FILE');
        bytes = binary.subarray(offset, offset + length);
      }
      textureTotal += texturePixels(bytes);
      if (textureTotal > PIXEL_LIMIT) throw new Error('PIXEL_LIMIT');
    }
  let vertices = 0;
  if (Array.isArray(model.accessors))
    for (const item of model.accessors) {
      if (!item || typeof item !== 'object') throw new Error('INVALID_FILE');
      const count = (item as Record<string, unknown>).count;
      if (
        typeof count !== 'number' ||
        !Number.isSafeInteger(count) ||
        count < 0
      )
        throw new Error('INVALID_FILE');
      vertices += count;
    }
  if (vertices > 1_000_000) throw new Error('MODEL_LIMIT');
  for (const key of ['buffers', 'images'])
    if (Array.isArray(model[key]))
      for (const item of model[key]) {
        if (item && typeof item === 'object' && 'uri' in item) {
          const uri = (item as { uri: unknown }).uri;
          if (
            typeof uri !== 'string' ||
            !/^data:(?:image\/(?:png|jpeg)|application\/octet-stream);base64,[a-zA-Z0-9+/=]+$/.test(
              uri,
            )
          )
            throw new Error('EXTERNAL_RESOURCE');
          if (uri.length > 16 * 1024 * 1024) throw new Error('SIZE_LIMIT');
        }
      }
}

function texturePixels(bytes: Uint8Array): number {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let width = 0,
    height = 0;
  if (
    bytes.length >= 24 &&
    bytes[0] === 137 &&
    bytes[1] === 80 &&
    bytes[2] === 78 &&
    bytes[3] === 71
  ) {
    width = view.getUint32(16);
    height = view.getUint32(20);
  } else if (bytes[0] === 255 && bytes[1] === 216) {
    for (let offset = 2; offset + 9 <= bytes.length; ) {
      if (bytes[offset] !== 255) throw new Error('INVALID_FILE');
      const marker = bytes[offset + 1]!;
      if (marker === 217 || marker === 218) break;
      const length = view.getUint16(offset + 2);
      if (length < 2 || offset + 2 + length > bytes.length)
        throw new Error('INVALID_FILE');
      if (
        [
          192, 193, 194, 195, 197, 198, 199, 201, 202, 203, 205, 206, 207,
        ].includes(marker)
      ) {
        height = view.getUint16(offset + 5);
        width = view.getUint16(offset + 7);
        break;
      }
      offset += 2 + length;
    }
  }
  if (!width || !height) throw new Error('UNSUPPORTED_FORMAT');
  if (width * height > PIXEL_LIMIT) throw new Error('PIXEL_LIMIT');
  return width * height;
}
