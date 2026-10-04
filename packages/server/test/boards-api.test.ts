import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { afterEach, expect, it } from 'vitest';
import * as S from '@cura/shared';
import { createApp } from '../src/app.js';
import { openDatabase } from '../src/database.js';
import { BoardStore } from '../src/boards/store.js';
import { registerBoardRoutes } from '../src/boards/routes.js';

const cleanup: Array<() => void | Promise<unknown>> = [];
afterEach(async () => {
  for (const fn of cleanup.splice(0).reverse()) await fn();
});
async function fixture() {
  const dir = await mkdtemp(join(tmpdir(), 'cura-board-api-'));
  cleanup.push(() => rm(dir, { recursive: true, force: true }));
  const paths = {
    data: join(dir, 'data'),
    cache: join(dir, 'cache'),
    log: join(dir, 'log'),
  };
  const db = openDatabase(paths);
  cleanup.push(() => db.close());
  const app = await createApp({ database: db, paths, staticRoot: false });
  cleanup.push(() => app.close());
  if (!app.hasRoute({ method: 'GET', url: '/api/boards/:id' }))
    registerBoardRoutes(app, new BoardStore(db));
  const url = await app.listen({ host: '127.0.0.1', port: 0 });
  const request = async (method: string, path: string, body?: unknown) =>
    fetch(`${url}${path}`, {
      method,
      headers: body === undefined ? {} : { 'content-type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  const library = S.LibrarySchema.parse(
    await (
      await request('POST', '/api/libraries', { name: 'Board API' })
    ).json(),
  );
  const upload = async (name: string, color: string, assetId?: string) => {
    const bytes = await sharp({
      create: { width: 24, height: 16, channels: 3, background: color },
    })
      .png()
      .toBuffer();
    const path = assetId
      ? `/api/assets/${assetId}/replace`
      : `/api/libraries/${library.id}/upload`;
    const response = await fetch(
      `${url}${path}?name=${encodeURIComponent(name)}`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/octet-stream' },
        body: new Uint8Array(bytes),
      },
    );
    expect(response.ok).toBe(true);
    return S.AssetSchema.parse(await response.json());
  };
  return { request, library, upload };
}

it('serves canvas layout CRUD with strict requests and conflict responses over HTTP', async () => {
  const { request, library } = await fixture();
  const response = await request(
    'POST',
    `/api/libraries/${library.id}/boards`,
    { name: 'Canvas' },
  );
  expect(response.status).toBe(201);
  let doc = S.BoardDocumentSchema.parse(await response.json());
  const initial = doc;
  const item = {
    id: randomUUID(),
    kind: 'text',
    x: 42,
    y: 77,
    width: 200,
    height: 100,
    groupId: null,
    label: 'Note',
    text: '构图',
    assetId: null,
    versionId: null,
  };
  const saved = await request('PUT', `/api/boards/${doc.board.id}/layout`, {
    expectedRevision: 0,
    items: [item],
    edges: [],
    viewport: { x: 3, y: 7, zoom: 2 },
  });
  expect(saved.status).toBe(200);
  doc = S.BoardDocumentSchema.parse(await saved.json());
  expect(doc.items[0]).toMatchObject(item);
  expect(
    (
      await request('PATCH', `/api/boards/${doc.board.id}`, {
        expectedRevision: 0,
        name: 'Lost update',
      })
    ).status,
  ).toBe(409);
  expect(
    (
      await request('PUT', `/api/boards/${doc.board.id}/layout`, {
        expectedRevision: 1,
        items: [],
        edges: [],
        arbitrary: true,
      })
    ).status,
  ).toBe(400);
  expect(
    await (await request('GET', `/api/boards/${doc.board.id}`)).json(),
  ).toEqual(doc);
  const renamed = await request('PATCH', `/api/boards/${doc.board.id}`, {
    expectedRevision: 1,
    name: 'Renamed',
  });
  doc = S.BoardDocumentSchema.parse(await renamed.json());
  expect(doc.board.name).toBe('Renamed');
  expect(
    S.BoardsSchema.parse(
      await (
        await request('GET', `/api/libraries/${library.id}/boards`)
      ).json(),
    ),
  ).toEqual([doc.board]);
  expect(
    (
      await request('DELETE', `/api/boards/${doc.board.id}`, {
        expectedRevision: initial.board.revision,
      })
    ).status,
  ).toBe(409);
  expect(
    await (
      await request('DELETE', `/api/boards/${doc.board.id}`, {
        expectedRevision: doc.board.revision,
      })
    ).json(),
  ).toEqual({ ok: true });
  expect((await request('GET', `/api/boards/${doc.board.id}`)).status).toBe(
    404,
  );
  expect((await request('GET', '/api/boards/not-a-uuid')).status).toBe(400);
});

it('retains exact historical slot pins after source replacement, edits frames and archives slot histories', async () => {
  const { request, library, upload } = await fixture();
  const asset = await upload('red.png', '#ff0000');
  let doc = S.BoardDocumentSchema.parse(
    await (
      await request('POST', `/api/libraries/${library.id}/boards`, {
        name: 'Pinned',
      })
    ).json(),
  );
  doc = S.BoardDocumentSchema.parse(
    await (
      await request('POST', `/api/boards/${doc.board.id}/slots`, {
        expectedRevision: 0,
        label: 'Hero',
      })
    ).json(),
  );
  const slotId = doc.slots[0]!.id;
  const pin = { assetId: asset.id, versionId: asset.currentVersionId };
  doc = S.BoardDocumentSchema.parse(
    await (
      await request('PUT', `/api/slots/${slotId}/assignment`, {
        expectedRevision: 0,
        pin,
      })
    ).json(),
  );
  const newer = await upload('blue.png', '#0000ff', asset.id);
  expect(newer.currentVersionId).not.toBe(pin.versionId);
  expect(newer.finalized).toBe(false);
  expect(
    S.BoardDocumentSchema.parse(
      await (await request('GET', `/api/boards/${doc.board.id}`)).json(),
    ).slots[0]!.currentPin,
  ).toEqual(pin);
  doc = S.BoardDocumentSchema.parse(
    await (
      await request('PUT', `/api/boards/${doc.board.id}/layout`, {
        expectedRevision: doc.board.revision,
        items: [],
        edges: [],
        slotLayouts: [{ id: slotId, label: 'Moved', x: -50, y: 600 }],
      })
    ).json(),
  );
  expect(doc.slots[0]).toMatchObject({
    label: 'Moved',
    x: -50,
    y: 600,
    currentPin: pin,
    revision: 1,
  });
  const nextPin = { assetId: newer.id, versionId: newer.currentVersionId };
  doc = S.BoardDocumentSchema.parse(
    await (
      await request('PUT', `/api/slots/${slotId}/assignment`, {
        expectedRevision: 1,
        pin: nextPin,
      })
    ).json(),
  );
  const before = doc;
  doc = S.BoardDocumentSchema.parse(
    await (
      await request('PUT', `/api/slots/${slotId}/assignment`, {
        expectedRevision: 2,
        pin: nextPin,
      })
    ).json(),
  );
  expect(doc).toEqual(before);
  expect(
    S.SlotHistorySchema.parse(
      await (await request('GET', `/api/slots/${slotId}/history`)).json(),
    ).map((r) => r.pin),
  ).toEqual([nextPin, pin]);
  const other = S.LibrarySchema.parse(
    await (await request('POST', '/api/libraries', { name: 'Other' })).json(),
  );
  let foreign = S.BoardDocumentSchema.parse(
    await (
      await request('POST', `/api/libraries/${other.id}/boards`, {
        name: 'Other',
      })
    ).json(),
  );
  foreign = S.BoardDocumentSchema.parse(
    await (
      await request('POST', `/api/boards/${foreign.board.id}/slots`, {
        expectedRevision: 0,
        label: 'Other',
      })
    ).json(),
  );
  expect(
    (
      await request('PUT', `/api/slots/${foreign.slots[0]!.id}/assignment`, {
        expectedRevision: 0,
        pin,
      })
    ).status,
  ).toBe(400);
  doc = S.BoardDocumentSchema.parse(
    await (
      await request('DELETE', `/api/slots/${slotId}`, { expectedRevision: 2 })
    ).json(),
  );
  expect(doc.slots).toEqual([]);
  expect(
    S.SlotHistorySchema.parse(
      await (await request('GET', `/api/slots/${slotId}/history`)).json(),
    ).map((r) => r.pin),
  ).toEqual([null, nextPin, pin]);
});

it('serves four templates, editable custom templates and matrix cells with stable axis IDs', async () => {
  const { request, library } = await fixture();
  const presets = S.SlotTemplatesSchema.parse(
    await (
      await request('GET', `/api/libraries/${library.id}/slot-templates`)
    ).json(),
  );
  expect(presets).toHaveLength(4);
  const response = await request(
    'POST',
    `/api/libraries/${library.id}/slot-templates`,
    {
      name: 'Custom',
      slots: [
        { key: 'hero', label: 'Hero', x: 0, y: 0, width: 200, height: 160 },
      ],
    },
  );
  expect(response.status).toBe(201);
  const custom = S.SlotTemplateSchema.parse(await response.json());
  expect(
    S.SlotTemplateSchema.parse(
      await (
        await request('PATCH', `/api/slot-templates/${custom.id}`, {
          name: 'Changed',
        })
      ).json(),
    ).slots,
  ).toEqual(custom.slots);
  const fromTemplate = S.BoardDocumentSchema.parse(
    await (
      await request('POST', `/api/libraries/${library.id}/boards`, {
        name: 'Template',
        templateId: custom.id,
      })
    ).json(),
  );
  expect(fromTemplate.slots).toHaveLength(1);
  expect(
    (await request('DELETE', `/api/slot-templates/${presets[0]!.id}`)).status,
  ).toBe(400);
  expect(
    await (await request('DELETE', `/api/slot-templates/${custom.id}`)).json(),
  ).toEqual({ ok: true });
  let matrix = S.BoardDocumentSchema.parse(
    await (
      await request('POST', `/api/libraries/${library.id}/boards`, {
        name: 'Matrix',
        kind: 'matrix',
        matrixPreset: 'scene-option',
      })
    ).json(),
  );
  const cellIds = matrix.slots.map((s) => s.id).sort();
  matrix = S.BoardDocumentSchema.parse(
    await (
      await request('PATCH', `/api/boards/${matrix.board.id}`, {
        expectedRevision: 0,
        rows: [...matrix.board.rows].reverse(),
      })
    ).json(),
  );
  expect(matrix.slots.map((s) => s.id).sort()).toEqual(cellIds);
  expect(
    (
      await request('DELETE', `/api/slots/${matrix.slots[0]!.id}`, {
        expectedRevision: 0,
      })
    ).status,
  ).toBe(400);
});
