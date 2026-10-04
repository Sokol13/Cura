import { expect, it } from 'vitest';
import { validatePsd, validateModel } from './validation';
function psd(width: number, height: number, depth = 8) {
  const bytes = new Uint8Array(40);
  const view = new DataView(bytes.buffer);
  bytes.set([56, 66, 80, 83]);
  view.setUint16(4, 1);
  view.setUint16(12, 3);
  view.setUint32(14, height);
  view.setUint32(18, width);
  view.setUint16(22, depth);
  view.setUint16(24, 3);
  return bytes;
}
it('rejects PSD pixel bombs and unsupported depths before allocating pixels', () => {
  expect(() => validatePsd(psd(100000, 100000))).toThrow('PIXEL_LIMIT');
  expect(() => validatePsd(psd(64, 48, 16))).toThrow('UNSUPPORTED_FORMAT');
  expect(validatePsd(psd(64, 48))).toEqual({ width: 64, height: 48 });
});
it('rejects model external resources and oversized declarations before GPU allocation', () => {
  expect(() =>
    validateModel({ buffers: [{ uri: 'https://example.com/mesh.bin' }] }),
  ).toThrow('EXTERNAL_RESOURCE');
  expect(() =>
    validateModel({ images: [{ uri: 'file:///etc/passwd' }] }),
  ).toThrow('EXTERNAL_RESOURCE');
  expect(() => validateModel({ accessors: [{ count: 2000000 }] })).toThrow(
    'MODEL_LIMIT',
  );
  expect(() =>
    validateModel({ extensionsRequired: ['KHR_draco_mesh_compression'] }),
  ).toThrow('UNSUPPORTED_FORMAT');
});

it('rejects oversized embedded model textures before bitmap decoding', () => {
  const header = new Uint8Array(24);
  header.set([137, 80, 78, 71, 13, 10, 26, 10]);
  const view = new DataView(header.buffer);
  view.setUint32(16, 100000);
  view.setUint32(20, 100000);
  const uri = `data:image/png;base64,${btoa(String.fromCharCode(...header))}`;
  expect(() => validateModel({ images: [{ uri }] })).toThrow('PIXEL_LIMIT');
});
