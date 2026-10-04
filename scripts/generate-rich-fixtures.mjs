// Original fixtures. No third-party artwork. FFmpeg is development-only, never a Cura runtime dependency.
import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
const target = resolve(
  process.argv[2] ||
    fileURLToPath(new URL('../e2e/fixtures/rich/', import.meta.url)),
);
await mkdir(target, { recursive: true });
const save = (name, bytes) => writeFile(join(target, name), bytes);
const width = 64,
  height = 48,
  colors = [
    [238, 51, 0],
    [0, 102, 221],
    [17, 187, 85],
    [255, 204, 68],
  ];
for (const compression of [0, 1]) {
  const header = Buffer.alloc(40);
  header.write('8BPS');
  header.writeUInt16BE(1, 4);
  header.writeUInt16BE(3, 12);
  header.writeUInt32BE(height, 14);
  header.writeUInt32BE(width, 18);
  header.writeUInt16BE(8, 22);
  header.writeUInt16BE(3, 24);
  header.writeUInt16BE(compression, 38);
  const at = (x, y, c) =>
    colors[(y >= height / 2 ? 2 : 0) + (x >= width / 2 ? 1 : 0)][c];
  let bytes;
  if (!compression) {
    const data = Buffer.alloc(width * height * 3);
    for (let c = 0; c < 3; c++)
      for (let y = 0; y < height; y++)
        for (let x = 0; x < width; x++)
          data[c * width * height + y * width + x] = at(x, y, c);
    bytes = Buffer.concat([header, data]);
  } else {
    const lengths = Buffer.alloc(height * 3 * 2),
      data = [];
    for (let c = 0; c < 3; c++)
      for (let y = 0; y < height; y++) {
        lengths.writeUInt16BE(4, (c * height + y) * 2);
        data.push(Buffer.from([225, at(0, y, c), 225, at(width / 2, y, c)]));
      }
    bytes = Buffer.concat([header, lengths, ...data]);
  }
  await save(compression ? 'quadrants-rle.psd' : 'quadrants-raw.psd', bytes);
}
const objects = [
  '<< /Type /Catalog /Pages 2 0 R >>',
  '<< /Type /Pages /Kids [3 0 R 4 0 R] /Count 2 >>',
  '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 64 48] /Resources << >> /Contents 5 0 R >>',
  '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 64 48] /Resources << >> /Contents 6 0 R >>',
];
for (const color of ['0.933333 0.2 0', '0 0.266667 1']) {
  const stream = `${color} rg 0 0 64 48 re f\n`;
  objects.push(`<< /Length ${stream.length} >>\nstream\n${stream}endstream`);
}
let pdf = '%PDF-1.4\n',
  offsets = [0];
for (let i = 0; i < objects.length; i++) {
  offsets.push(Buffer.byteLength(pdf));
  pdf += `${i + 1} 0 obj\n${objects[i]}\nendobj\n`;
}
const xref = Buffer.byteLength(pdf);
pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets
  .slice(1)
  .map((offset) => String(offset).padStart(10, '0') + ' 00000 n \n')
  .join(
    '',
  )}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
await save('two-pages.pdf', pdf);
const vertices = [
  [-1, -1, 1],
  [1, -1, 1],
  [1, 1, 1],
  [-1, 1, 1],
  [-1, -1, -1],
  [1, -1, -1],
  [1, 1, -1],
  [-1, 1, -1],
];
const faces = [
    [0, 1, 2, 3],
    [5, 4, 7, 6],
    [1, 5, 6, 2],
    [4, 0, 3, 7],
    [3, 2, 6, 7],
    [4, 5, 1, 0],
  ],
  normals = [
    [0, 0, 1],
    [0, 0, -1],
    [1, 0, 0],
    [-1, 0, 0],
    [0, 1, 0],
    [0, -1, 0],
  ];
await save(
  'orange-cube.obj',
  vertices.map((v) => `v ${v.join(' ')}\n`).join('') +
    faces.map((f) => `f ${f.map((i) => i + 1).join(' ')}\n`).join(''),
);
const positions = [],
  normalData = [],
  indices = [];
for (let f = 0; f < faces.length; f++) {
  for (const v of faces[f]) {
    positions.push(...vertices[v]);
    normalData.push(...normals[f]);
  }
  indices.push(f * 4, f * 4 + 1, f * 4 + 2, f * 4, f * 4 + 2, f * 4 + 3);
}
const positionsBuffer = Buffer.from(new Float32Array(positions).buffer),
  normalsBuffer = Buffer.from(new Float32Array(normalData).buffer),
  indicesBuffer = Buffer.from(new Uint16Array(indices).buffer),
  binary = Buffer.concat([positionsBuffer, normalsBuffer, indicesBuffer]);
const model = {
  asset: { version: '2.0', generator: 'Cura original fixture generator' },
  scene: 0,
  scenes: [{ nodes: [0] }],
  nodes: [{ mesh: 0 }],
  meshes: [
    {
      primitives: [
        { attributes: { POSITION: 0, NORMAL: 1 }, indices: 2, material: 0 },
      ],
    },
  ],
  materials: [
    {
      pbrMetallicRoughness: {
        baseColorFactor: [0.933333, 0.2, 0, 1],
        metallicFactor: 0,
        roughnessFactor: 0.8,
      },
    },
  ],
  buffers: [{ byteLength: binary.length }],
  bufferViews: [
    { buffer: 0, byteOffset: 0, byteLength: positionsBuffer.length },
    {
      buffer: 0,
      byteOffset: positionsBuffer.length,
      byteLength: normalsBuffer.length,
    },
    {
      buffer: 0,
      byteOffset: positionsBuffer.length + normalsBuffer.length,
      byteLength: indicesBuffer.length,
    },
  ],
  accessors: [
    {
      bufferView: 0,
      componentType: 5126,
      count: 24,
      type: 'VEC3',
      min: [-1, -1, -1],
      max: [1, 1, 1],
    },
    { bufferView: 1, componentType: 5126, count: 24, type: 'VEC3' },
    { bufferView: 2, componentType: 5123, count: 36, type: 'SCALAR' },
  ],
};
async function glb(name, json, bin) {
  const jsonBytes = Buffer.from(JSON.stringify(json)),
    padded = Buffer.concat([
      jsonBytes,
      Buffer.alloc((4 - (jsonBytes.length % 4)) % 4, 32),
    ]),
    header = Buffer.alloc(20),
    binHeader = Buffer.alloc(8);
  header.writeUInt32LE(0x46546c67);
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(28 + padded.length + bin.length, 8);
  header.writeUInt32LE(padded.length, 12);
  header.writeUInt32LE(0x4e4f534a, 16);
  binHeader.writeUInt32LE(bin.length);
  binHeader.writeUInt32LE(0x004e4942, 4);
  await save(name, Buffer.concat([header, padded, binHeader, bin]));
}
await glb('orange-cube.glb', model, binary);
await glb(
  'external-resource.glb',
  {
    ...model,
    buffers: [
      { byteLength: binary.length, uri: 'https://example.invalid/private.bin' },
    ],
  },
  binary,
);
if (process.argv.includes('--video'))
  for (const extension of ['mp4', 'mov'])
    execFileSync('ffmpeg', [
      '-hide_banner',
      '-loglevel',
      'error',
      '-y',
      '-f',
      'lavfi',
      '-i',
      'color=c=0xee3300:size=64x48:rate=1:duration=1',
      '-f',
      'lavfi',
      '-i',
      'color=c=0x0044ff:size=64x48:rate=1:duration=1',
      '-filter_complex',
      '[0:v][1:v]concat=n=2:v=1:a=0[v]',
      '-map',
      '[v]',
      '-an',
      '-c:v',
      'libx264',
      '-profile:v',
      'baseline',
      '-pix_fmt',
      'yuv420p',
      '-threads',
      '1',
      '-fflags',
      '+bitexact',
      '-flags:v',
      '+bitexact',
      '-map_metadata',
      '-1',
      '-movflags',
      '+faststart',
      join(target, `first-frame.${extension}`),
    ]);
console.log(`Generated original rich fixtures in ${target}`);

// Original CJK Type0 text fixture; Adobe GB1 CMap required.
{
  const content = 'BT /F1 24 Tf 30 100 Td <4E2D6587> Tj ET';
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 200] /Resources << /Font << /F1 4 0 R >> >> /Contents 6 0 R >>',
    '<< /Type /Font /Subtype /Type0 /BaseFont /STSong-Light /Encoding /UniGB-UCS2-H /DescendantFonts [5 0 R] >>',
    '<< /Type /Font /Subtype /CIDFontType0 /BaseFont /STSong-Light /CIDSystemInfo << /Registry (Adobe) /Ordering (GB1) /Supplement 4 >> /DW 1000 /FontDescriptor 7 0 R >>',
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
    '<< /Type /FontDescriptor /FontName /STSong-Light /Flags 4 /FontBBox [0 -200 1000 900] /ItalicAngle 0 /Ascent 880 /Descent -120 /CapHeight 880 /StemV 80 >>',
  ];
  let document = '%PDF-1.4\n';
  const offsets = [0];
  objects.forEach((object, i) => {
    offsets.push(document.length);
    document += `${i + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xref = document.length;
  document +=
    `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n` +
    offsets
      .slice(1)
      .map((n) => `${String(n).padStart(10, '0')} 00000 n \n`)
      .join('') +
    `trailer\n<< /Root 1 0 R /Size ${objects.length + 1} >>\nstartxref\n${xref}\n%%EOF`;
  await save('cjk-first-page.pdf', document);
}
