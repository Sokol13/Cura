/// <reference lib="dom" />
import { randomUUID } from 'node:crypto';
import {
  expect,
  test,
  type APIRequestContext,
  type Locator,
  type Page,
} from '@playwright/test';
import {
  AssetSchema,
  BoardDocumentSchema,
  LibrarySchema,
  ProcessTimelineSchema,
  SlotHistorySchema,
  type BoardItemInput,
} from '../packages/shared/src/index.js';

test.use({ viewport: { width: 1500, height: 1000 } });

function artwork(color: string) {
  return Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300"><rect width="400" height="300" fill="${color}"/><circle cx="200" cy="130" r="90" fill="#efc894"/><path d="M50 300L200 160L350 300" fill="#252c35"/></svg>`,
  );
}

async function getBoard(request: APIRequestContext, id: string) {
  const response = await request.get(`/api/boards/${id}`);
  expect(response.ok()).toBe(true);
  return BoardDocumentSchema.parse(await response.json());
}

async function history(request: APIRequestContext, slotId: string) {
  const response = await request.get(`/api/slots/${slotId}/history`);
  expect(response.ok()).toBe(true);
  return SlotHistorySchema.parse(await response.json());
}

async function timeline(request: APIRequestContext, assetId: string) {
  return ProcessTimelineSchema.parse(
    await (await request.get(`/api/assets/${assetId}/process`)).json(),
  );
}

async function setup(page: Page, request: APIRequestContext, name: string) {
  const library = LibrarySchema.parse(
    await (await request.post('/api/libraries', { data: { name } })).json(),
  );
  const settings = await request.patch('/api/settings', {
    data: { activeLibraryId: library.id, language: 'en', theme: 'dark' },
  });
  expect(settings.ok()).toBe(true);
  async function upload(filename: string, color: string) {
    const response = await request.post(
      `/api/libraries/${library.id}/upload?name=${encodeURIComponent(filename)}`,
      {
        headers: { 'content-type': 'application/octet-stream' },
        data: artwork(color),
      },
    );
    expect(response.ok()).toBe(true);
    return AssetSchema.parse(await response.json());
  }
  const a = await upload('Historical-A.svg', '#ab593e');
  const b = await upload('Grouped-B.svg', '#356f70');
  let document = BoardDocumentSchema.parse(
    await (
      await request.post(`/api/libraries/${library.id}/boards`, {
        data: { name, kind: 'canvas' },
      })
    ).json(),
  );
  document = BoardDocumentSchema.parse(
    await (
      await request.post(`/api/boards/${document.board.id}/slots`, {
        data: {
          expectedRevision: document.board.revision,
          label: 'Final reference',
          x: 520,
          y: 180,
          width: 240,
          height: 200,
        },
      })
    ).json(),
  );
  const aId = randomUUID();
  const bId = randomUUID();
  const groupId = randomUUID();
  const items: BoardItemInput[] = [
    {
      id: aId,
      kind: 'asset',
      x: 70,
      y: 80,
      width: 180,
      height: 140,
      groupId: null,
      label: 'Historical A · V1',
      text: '',
      assetId: a.id,
      versionId: a.currentVersionId,
    },
    {
      id: groupId,
      kind: 'group',
      x: 70,
      y: 330,
      width: 280,
      height: 220,
      groupId: null,
      label: 'Material studies',
      text: '',
      assetId: null,
      versionId: null,
    },
    {
      id: bId,
      kind: 'asset',
      x: 100,
      y: 380,
      width: 180,
      height: 130,
      groupId,
      label: 'Grouped B · V1',
      text: '',
      assetId: b.id,
      versionId: b.currentVersionId,
    },
  ];
  document = BoardDocumentSchema.parse(
    await (
      await request.put(`/api/boards/${document.board.id}/layout`, {
        data: {
          expectedRevision: document.board.revision,
          viewport: { x: 70, y: 60, zoom: 0.75 },
          items,
          edges: [
            {
              id: randomUUID(),
              sourceId: aId,
              targetId: bId,
              label: 'Keep this connection',
            },
          ],
        },
      })
    ).json(),
  );
  const replacement = await request.post(
    `/api/assets/${a.id}/replace?name=Historical-A-V2.svg`,
    {
      headers: { 'content-type': 'application/octet-stream' },
      data: artwork('#79559c'),
    },
  );
  expect(replacement.ok()).toBe(true);
  const aV2 = AssetSchema.parse(await replacement.json());
  expect(aV2.currentVersionId).not.toBe(a.currentVersionId);
  await page.goto(`/?workspace=boards&board=${document.board.id}`);
  await expect(page.getByRole('heading', { name, exact: true })).toBeVisible();
  const aNode = page.locator(`.react-flow__node[data-id="${aId}"]`);
  const bNode = page.locator(`.react-flow__node[data-id="${bId}"]`);
  const slot = page.locator(`[data-slot-id="${document.slots[0]!.id}"]`);
  await expect(aNode).toBeVisible();
  await expect(bNode).toBeVisible();
  await expect(slot).toBeVisible();
  await expect(page.locator('.react-flow__viewport')).toHaveCSS(
    'transform',
    'matrix(0.75, 0, 0, 0.75, 70, 60)',
  );
  return {
    document,
    a,
    b,
    aV2,
    aId,
    bId,
    groupId,
    aNode,
    bNode,
    slot,
    slotId: document.slots[0]!.id,
    aPin: { assetId: a.id, versionId: a.currentVersionId },
    bPin: { assetId: b.id, versionId: b.currentVersionId },
  };
}

async function beginDrag(page: Page, node: Locator) {
  const bounds = await node.boundingBox();
  expect(bounds).not.toBeNull();
  const start = { x: bounds!.x + bounds!.width / 2, y: bounds!.y + 18 };
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(start.x + 6, start.y, { steps: 2 });
  return start;
}

async function finishDrop(page: Page, target: Locator) {
  const bounds = await target.boundingBox();
  expect(bounds).not.toBeNull();
  await page.mouse.move(
    bounds!.x + bounds!.width / 2,
    bounds!.y + bounds!.height / 2,
    { steps: 16 },
  );
  await page.mouse.up();
}

test('canvas pins fill and replace a slot without moving historical or grouped sources', async ({
  page,
  request,
}) => {
  const fixture = await setup(page, request, 'Canvas pin selection');
  const { document, aNode, bNode, slot, slotId, aPin, bPin } = fixture;
  await beginDrag(page, aNode);
  await finishDrop(page, slot);
  await expect
    .poll(
      async () =>
        (await getBoard(request, document.board.id)).slots[0]!.currentPin,
    )
    .toEqual(aPin);
  let saved = await getBoard(request, document.board.id);
  expect(saved.items).toEqual(document.items);
  expect(saved.edges).toEqual(document.edges);
  expect(saved.board.viewport).toEqual(document.board.viewport);
  expect(saved.slots[0]!.revision).toBe(1);
  expect((await history(request, slotId)).map((entry) => entry.pin)).toEqual([
    aPin,
  ]);
  const process = await timeline(request, fixture.a.id);
  expect(
    process.entries.find((entry) => entry.version.id === aPin.versionId)!
      .finalSelections,
  ).toEqual([
    expect.objectContaining({ ...aPin, ownerKind: 'slot', ownerId: slotId }),
  ]);
  expect(
    process.entries.find(
      (entry) => entry.version.id === fixture.aV2.currentVersionId,
    )!.finalSelections,
  ).toEqual([]);
  expect(
    AssetSchema.parse(
      await (await request.get(`/api/assets/${fixture.a.id}`)).json(),
    ).finalized,
  ).toBe(false);
  await expect(slot.locator('img')).toHaveAttribute(
    'src',
    `/api/versions/${aPin.versionId}/thumbnail`,
  );

  await beginDrag(page, bNode);
  await finishDrop(page, slot);
  await expect
    .poll(
      async () =>
        (await getBoard(request, document.board.id)).slots[0]!.currentPin,
    )
    .toEqual(bPin);
  saved = await getBoard(request, document.board.id);
  expect(saved.items).toEqual(document.items);
  expect(saved.edges).toEqual(document.edges);
  expect(saved.slots[0]!.revision).toBe(2);
  expect((await history(request, slotId)).map((entry) => entry.pin)).toEqual([
    bPin,
    aPin,
  ]);
  expect(
    (await timeline(request, fixture.a.id)).entries.flatMap(
      (entry) => entry.finalSelections,
    ),
  ).toEqual([]);
  expect(
    (await timeline(request, fixture.b.id)).entries[0]!.finalSelections,
  ).toEqual([
    expect.objectContaining({ ...bPin, ownerKind: 'slot', ownerId: slotId }),
  ]);
  await page.reload();
  await expect(aNode).toBeVisible();
  await expect(bNode).toBeVisible();
  await expect(slot.locator('img')).toHaveAttribute(
    'src',
    `/api/versions/${bPin.versionId}/thumbnail`,
  );
  expect((await getBoard(request, document.board.id)).items).toEqual(
    document.items,
  );
  await page.screenshot({
    path: 'docs/screenshots/v0.4-canvas-slot-drop.png',
    fullPage: true,
  });

  const start = await beginDrag(page, aNode);
  await page.mouse.move(start.x + 80, start.y + 40, { steps: 12 });
  const observedPosition = await aNode.evaluate((element) => {
    const transform = new DOMMatrixReadOnly(
      getComputedStyle(element).transform,
    );
    return { x: transform.m41, y: transform.m42 };
  });
  const originalA = document.items.find((item) => item.id === fixture.aId)!;
  expect(observedPosition.x).toBeGreaterThan(originalA.x);
  expect(observedPosition.y).toBeGreaterThan(originalA.y);
  await page.mouse.up();
  await expect
    .poll(async () => {
      const item = (await getBoard(request, document.board.id)).items.find(
        (value) => value.id === fixture.aId,
      )!;
      return (
        Math.abs(item.x - observedPosition.x) < 1 &&
        Math.abs(item.y - observedPosition.y) < 1
      );
    })
    .toBe(true);
  saved = await getBoard(request, document.board.id);
  expect(saved.items.find((item) => item.id === fixture.aId)).toEqual(
    expect.objectContaining(aPin),
  );
  for (const id of [fixture.bId, fixture.groupId]) {
    const original = document.items.find((item) => item.id === id)!;
    expect(saved.items.find((item) => item.id === id)).toEqual(
      expect.objectContaining({
        x: original.x,
        y: original.y,
        groupId: original.groupId,
        assetId: original.assetId,
        versionId: original.versionId,
      }),
    );
  }
  expect(
    saved.edges.map(({ id, sourceId, targetId, label }) => ({
      id,
      sourceId,
      targetId,
      label,
    })),
  ).toEqual(
    document.edges.map(({ id, sourceId, targetId, label }) => ({
      id,
      sourceId,
      targetId,
      label,
    })),
  );
  expect((await history(request, slotId)).map((entry) => entry.pin)).toEqual([
    bPin,
    aPin,
  ]);
  await page.reload();
  await expect(aNode).toBeVisible();
  expect((await getBoard(request, document.board.id)).items).toEqual(
    saved.items,
  );
});

test('a concurrent slot assignment rejects an in-flight canvas drop without false history', async ({
  page,
  request,
}) => {
  const { document, aNode, slot, slotId, bPin } = await setup(
    page,
    request,
    'Canvas assignment conflict',
  );
  const originalTransform = await aNode.evaluate(
    (element) => getComputedStyle(element).transform,
  );
  await beginDrag(page, aNode);
  const concurrent = await request.put(`/api/slots/${slotId}/assignment`, {
    data: { expectedRevision: 0, pin: bPin },
  });
  expect(concurrent.ok()).toBe(true);
  const response = page.waitForResponse(
    (value) =>
      value.url().endsWith(`/api/slots/${slotId}/assignment`) &&
      value.request().method() === 'PUT',
  );
  await finishDrop(page, slot);
  expect((await response).status()).toBe(409);
  await expect(page.getByRole('alert')).toContainText(
    'This board changed elsewhere',
  );
  const saved = await getBoard(request, document.board.id);
  expect(saved.slots[0]!.currentPin).toEqual(bPin);
  expect(saved.slots[0]!.revision).toBe(1);
  expect((await history(request, slotId)).map((entry) => entry.pin)).toEqual([
    bPin,
  ]);
  expect(saved.items).toEqual(document.items);
  expect(saved.edges).toEqual(document.edges);
  await expect(aNode).toHaveCSS('transform', originalTransform);
  await page.reload();
  await expect(slot.locator('img')).toHaveAttribute(
    'src',
    `/api/versions/${bPin.versionId}/thumbnail`,
  );
  expect((await getBoard(request, document.board.id)).items).toEqual(
    document.items,
  );
  expect((await history(request, slotId)).map((entry) => entry.pin)).toEqual([
    bPin,
  ]);
});
