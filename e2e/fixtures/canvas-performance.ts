import { randomUUID } from 'node:crypto';
import { deflateSync } from 'node:zlib';
import { expect, type APIRequestContext } from '@playwright/test';
import {
  AssetSchema,
  BoardDocumentSchema,
  LibrarySchema,
  type BoardDocument,
  type BoardItemInput,
  type BoardPin,
} from '../../packages/shared/src/index.js';

function chunk(type: string, data: Buffer) {
  const bytes = Buffer.concat([Buffer.from(type), data]);
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++)
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  const length = Buffer.alloc(4),
    checksum = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  checksum.writeUInt32BE((crc ^ 0xffffffff) >>> 0);
  return Buffer.concat([length, bytes, checksum]);
}
function artwork(index: number) {
  const width = 320,
    height = 240;
  const pixels = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const offset = y * (width * 3 + 1) + 1 + x * 3;
      pixels[offset] = (index * 37 + x * 2) % 256;
      pixels[offset + 1] = (index * 17 + y * 2) % 256;
      pixels[offset + 2] =
        ((Math.floor(x / 24) ^ Math.floor(y / 24)) * 40 + index * 11) % 256;
    }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 2;
  return Buffer.concat([
    Buffer.from('89504e470d0a1a0a', 'hex'),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(pixels)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}
async function response(
  request: APIRequestContext,
  method: string,
  path: string,
  data?: unknown,
) {
  const result = await request.fetch(path, { method, data });
  expect(result.ok(), `${method} ${path}: ${await result.text()}`).toBe(true);
  return result.json() as Promise<unknown>;
}
export async function canvasPerformanceFixture(request: APIRequestContext) {
  const library = LibrarySchema.parse(
    await response(request, 'POST', '/api/libraries', {
      name: 'Canvas performance fixture',
    }),
  );
  const assets = [];
  for (let index = 0; index < 20; index++) {
    const result = await request.post(
      `/api/libraries/${library.id}/upload?name=Performance-${index}.png`,
      {
        headers: { 'content-type': 'application/octet-stream' },
        data: artwork(index),
      },
    );
    expect(result.ok()).toBe(true);
    assets.push(AssetSchema.parse(await result.json()));
  }
  expect(new Set(assets.map((asset) => asset.hash)).size).toBe(20);
  const pins = assets.map((asset) => ({
    assetId: asset.id,
    versionId: asset.currentVersionId,
  }));
  const later = [];
  for (const index of [0, 1]) {
    const result = await request.post(
      `/api/assets/${assets[index]!.id}/replace?name=Performance-${index}-V2.png`,
      {
        headers: { 'content-type': 'application/octet-stream' },
        data: artwork(index + 20),
      },
    );
    expect(result.ok()).toBe(true);
    later.push(AssetSchema.parse(await result.json()));
  }
  const historyPins: BoardPin[] = [
    pins[0]!,
    { assetId: later[1]!.id, versionId: later[1]!.currentVersionId },
    pins[0]!,
  ];
  const boardResponse = async (method: string, path: string, data: unknown) =>
    BoardDocumentSchema.parse(await response(request, method, path, data));
  let canvas = await boardResponse(
    'POST',
    `/api/libraries/${library.id}/boards`,
    { name: '100-node performance canvas', kind: 'canvas' },
  );
  for (let index = 0; index < 5; index++) {
    canvas = await boardResponse(
      'POST',
      `/api/boards/${canvas.board.id}/slots`,
      {
        expectedRevision: canvas.board.revision,
        label: `Performance slot ${index}`,
        x: 20 + index * 360,
        y: 2000,
        width: 340,
        height: 200,
      },
    );
    const slotId = canvas.slots.find(
      (slot) => slot.label === `Performance slot ${index}`,
    )!.id;
    for (const pin of historyPins)
      canvas = await boardResponse('PUT', `/api/slots/${slotId}/assignment`, {
        expectedRevision: canvas.slots.find((slot) => slot.id === slotId)!
          .revision,
        pin,
      });
  }
  const groups = Array.from(
    { length: 5 },
    (_, index): BoardItemInput => ({
      id: randomUUID(),
      kind: 'group',
      x: (index % 2) * 880 + 5,
      y: Math.floor(index / 2) * 360 + 15,
      width: 860,
      height: 350,
      groupId: null,
      label: `Group ${index}`,
      text: '',
      assetId: null,
      versionId: null,
    }),
  );
  const images = Array.from({ length: 80 }, (_, index): BoardItemInput => {
    const column = index % 8,
      row = Math.floor(index / 8);
    const group = groups[Math.floor(row / 2) * 2 + Math.floor(column / 4)];
    return {
      id: randomUUID(),
      kind: 'asset',
      x: 20 + column * 220,
      y: 30 + row * 180,
      width: 190,
      height: 140,
      groupId: group?.id ?? null,
      label: `Image ${index}`,
      text: '',
      ...pins[index % pins.length]!,
    };
  });
  const texts = Array.from(
    { length: 10 },
    (_, index): BoardItemInput => ({
      id: randomUUID(),
      kind: 'text',
      x: 20 + index * 180,
      y: 1850,
      width: 170,
      height: 90,
      groupId: null,
      label: `Note ${index}`,
      text: 'Retained reference · 中文笔记',
      assetId: null,
      versionId: null,
    }),
  );
  canvas = await boardResponse('PUT', `/api/boards/${canvas.board.id}/layout`, {
    expectedRevision: canvas.board.revision,
    viewport: { x: 30, y: 20, zoom: 0.3 },
    items: [...groups, ...images, ...texts],
    edges: Array.from({ length: 20 }, (_, index) => ({
      id: randomUUID(),
      sourceId: images[index]!.id,
      targetId: images[index + 8]!.id,
      label: `Link ${index}`,
    })),
  });
  expect(canvas.items.length + canvas.slots.length).toBe(100);
  expect(canvas.slots.every((slot) => slot.revision === 3)).toBe(true);
  const axes = (prefix: string) =>
    Array.from({ length: 10 }, (_, index) => ({
      id: randomUUID(),
      label: `${prefix} ${index}`,
    }));
  let matrix = await boardResponse(
    'POST',
    `/api/libraries/${library.id}/boards`,
    {
      name: '10 by 10 performance matrix',
      kind: 'matrix',
      rows: axes('Character'),
      columns: axes('Angle'),
    },
  );
  for (const [index, slot] of matrix.slots.entries())
    matrix = await boardResponse('PUT', `/api/slots/${slot.id}/assignment`, {
      expectedRevision: slot.revision,
      pin: pins[index % pins.length]!,
    });
  expect(matrix.slots).toHaveLength(100);
  expect(matrix.slots.every((slot) => slot.currentPin)).toBe(true);
  return {
    libraryId: library.id,
    canvas,
    matrix,
    counts: {
      uniqueAssets: 20,
      retainedVersions: 22,
      canvasNodes: 100,
      assetNodes: 80,
      textNodes: 10,
      groups: 5,
      canvasSlots: 5,
      edges: 20,
      revisionsPerCanvasSlot: 3,
      matrixSlots: 100,
    },
  };
}
export async function readPerformanceBoard(
  request: APIRequestContext,
  boardId: string,
): Promise<BoardDocument> {
  return BoardDocumentSchema.parse(
    await response(request, 'GET', `/api/boards/${boardId}`),
  );
}
