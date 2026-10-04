/// <reference lib="dom" />
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
  SlotHistorySchema,
  type BoardDocument,
} from '../packages/shared/src/index.js';

test.use({ viewport: { width: 1500, height: 1000 } });
function artwork(color: string) {
  return Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300"><rect width="400" height="300" fill="${color}"/><circle cx="200" cy="130" r="90" fill="#efc894"/><path d="M50 300L200 160L350 300" fill="#252c35"/></svg>`,
  );
}
async function setup(page: Page, request: APIRequestContext, name: string) {
  const library = LibrarySchema.parse(
    await (await request.post('/api/libraries', { data: { name } })).json(),
  );
  await request.patch('/api/settings', {
    data: { activeLibraryId: library.id, language: 'en', theme: 'dark' },
  });
  await page.goto('/');
  await page
    .getByLabel('Import files', { exact: true })
    .and(page.locator('input[type="file"]'))
    .setInputFiles([
      {
        name: 'Character.svg',
        mimeType: 'image/svg+xml',
        buffer: artwork('#ab593e'),
      },
      {
        name: 'Scene.svg',
        mimeType: 'image/svg+xml',
        buffer: artwork('#356f70'),
      },
    ]);
  await expect(
    page.getByRole('button', { name: 'Select Character.svg', exact: true }),
  ).toBeVisible({ timeout: 15000 });
  await page.getByRole('button', { name: 'Boards', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Boards', exact: true }),
  ).toBeVisible();
  return library;
}
async function createBoard(
  page: Page,
  name: string,
  options: {
    template?: string;
    matrix?: 'Characters × angles' | 'Scenes × options';
  } = {},
) {
  await page.getByRole('button', { name: 'New board', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Board name', { exact: true }).fill(name);
  if (options.matrix) {
    await dialog
      .getByRole('combobox', { name: 'Board type', exact: true })
      .selectOption('matrix');
    await dialog
      .getByRole('combobox', { name: 'Matrix layout', exact: true })
      .selectOption({ label: options.matrix });
  }
  if (options.template)
    await dialog
      .getByRole('combobox', { name: 'Slot template', exact: true })
      .selectOption({ label: options.template });
  await dialog.getByRole('button', { name: 'Create', exact: true }).click();
  await expect(page.getByRole('heading', { name, exact: true })).toBeVisible();
  return new URL(page.url()).searchParams.get('board')!;
}
async function getBoard(
  request: APIRequestContext,
  id: string,
): Promise<BoardDocument> {
  return BoardDocumentSchema.parse(
    await (await request.get(`/api/boards/${id}`)).json(),
  );
}
async function dragPin(page: Page, name: string, target: Locator) {
  await page
    .getByRole('button', { name: `Drag ${name}`, exact: true })
    .dragTo(target);
}
async function moveNode(page: Page, node: Locator, dx: number, dy: number) {
  const bounds = await node.boundingBox();
  expect(bounds).not.toBeNull();
  await page.mouse.move(bounds!.x + bounds!.width / 2, bounds!.y + 18);
  await page.mouse.down();
  await page.mouse.move(
    bounds!.x + bounds!.width / 2 + dx,
    bounds!.y + 18 + dy,
    { steps: 12 },
  );
  await page.mouse.up();
}

test('real slot drops finalize exact versions, retain replacement history and reuse all preset/custom templates', async ({
  page,
  request,
}) => {
  await setup(page, request, 'Board slots');
  const id = await createBoard(page, 'Character shots', {
    template: 'Character studies',
  });
  await expect(page.locator('[data-slot-id]')).toHaveCount(4);
  const reference = page.getByRole('region', {
    name: 'Drop asset into Reference',
    exact: true,
  });
  await dragPin(page, 'Character.svg', reference);
  await expect(reference.getByText('V1', { exact: true })).toBeVisible();
  let board = await getBoard(request, id);
  const slot = board.slots.find((entry) => entry.label === 'Reference')!;
  const firstPin = slot.currentPin!;
  const finalized = AssetSchema.parse(
    await (await request.get(`/api/assets/${firstPin.assetId}`)).json(),
  );
  expect(finalized.finalized).toBe(true);
  const replacement = await request.post(
    `/api/assets/${firstPin.assetId}/replace?name=Character.svg`,
    {
      headers: { 'content-type': 'application/octet-stream' },
      data: artwork('#663bb0'),
    },
  );
  expect(replacement.ok()).toBe(true);
  const replaced = AssetSchema.parse(await replacement.json());
  expect(replaced.currentVersionId).not.toBe(firstPin.versionId);
  await page.reload();
  await expect(reference.locator('img')).toHaveAttribute(
    'src',
    `/api/versions/${firstPin.versionId}/thumbnail`,
  );
  await dragPin(page, 'Character.svg', reference);
  await expect(reference.getByText('V2', { exact: true })).toBeVisible();
  await reference
    .getByRole('button', { name: 'History for Reference' })
    .click();
  const history = page.getByRole('dialog', { name: 'History for Reference' });
  await expect(
    history.getByText('Slot version V1', { exact: true }),
  ).toBeVisible();
  await expect(
    history.getByText('Slot version V2', { exact: true }),
  ).toBeVisible();
  expect(
    SlotHistorySchema.parse(
      await (await request.get(`/api/slots/${slot.id}/history`)).json(),
    ).map((entry) => entry.pin?.versionId),
  ).toEqual([replaced.currentVersionId, firstPin.versionId]);
  await history.getByRole('button', { name: 'Close', exact: true }).click();
  await page
    .getByRole('button', { name: 'Choose version for Character.svg' })
    .click();
  await page
    .getByRole('combobox', { name: 'Character.svg version' })
    .selectOption(firstPin.versionId);
  await dragPin(page, 'Character.svg', reference);
  await expect(reference.getByText('V3', { exact: true })).toBeVisible();
  expect(
    (await getBoard(request, id)).slots.find((entry) => entry.id === slot.id)
      ?.currentPin,
  ).toEqual(firstPin);
  await page.reload();
  await expect(reference.getByText('V3', { exact: true })).toBeVisible();
  for (const name of ['Close-up', 'Wide shot', '35° view']) {
    const frame = page.getByRole('region', {
      name: `Drop asset into ${name}`,
      exact: true,
    });
    await dragPin(page, 'Scene.svg', frame);
    await expect(frame.getByText('V1', { exact: true })).toBeVisible();
  }
  await page.screenshot({
    path: 'docs/screenshots/v0.2-boards.png',
    fullPage: true,
  });
  for (const [template, count] of [
    ['Scene explorations', 3],
    ['Product development', 3],
    ['Brand variations', 3],
  ] as const) {
    await createBoard(page, `${template} board`, { template });
    await expect(page.locator('[data-slot-id]')).toHaveCount(count);
  }
  await page
    .getByRole('button', { name: 'Manage templates', exact: true })
    .click();
  await page.getByRole('button', { name: 'New template', exact: true }).click();
  let dialog = page.getByRole('dialog');
  await dialog
    .getByLabel('Template name', { exact: true })
    .fill('Campaign pair');
  await dialog.getByLabel('Frame label', { exact: true }).fill('Hero');
  await dialog.getByRole('button', { name: 'Add frame', exact: true }).click();
  await dialog.getByLabel('Frame label', { exact: true }).nth(1).fill('Detail');
  await dialog.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByText('Campaign pair', { exact: true })).toBeVisible();
  await page
    .getByRole('dialog')
    .getByRole('button', { name: 'Close', exact: true })
    .click();
  const customId = await createBoard(page, 'Reusable campaign', {
    template: 'Campaign pair',
  });
  await expect(
    page.getByRole('region', { name: 'Drop asset into Hero', exact: true }),
  ).toBeVisible();
  await expect(page.locator('[data-slot-id]')).toHaveCount(2);
  await page
    .getByRole('button', { name: 'Manage templates', exact: true })
    .click();
  await page
    .getByRole('button', { name: 'Edit template · Campaign pair', exact: true })
    .click();
  dialog = page.getByRole('dialog');
  await dialog
    .getByLabel('Template name', { exact: true })
    .fill('Campaign revised');
  await dialog.getByRole('button', { name: 'Save', exact: true }).click();
  await page
    .getByRole('button', {
      name: 'Delete template · Campaign revised',
      exact: true,
    })
    .click();
  await page
    .getByRole('dialog')
    .getByRole('button', { name: 'Delete', exact: true })
    .click();
  await expect(page.getByText('Campaign revised', { exact: true })).toHaveCount(
    0,
  );
  await page
    .getByRole('dialog')
    .getByRole('button', { name: 'Close', exact: true })
    .click();
  await page.reload();
  board = await getBoard(request, customId);
  expect(board.slots.map((entry) => entry.label)).toEqual(['Hero', 'Detail']);
  await expect(
    page.getByRole('region', { name: 'Drop asset into Hero', exact: true }),
  ).toBeVisible();
});

test('canvas nodes, connections, groups, dimensions and viewport survive real dragging and reload', async ({
  page,
  request,
}) => {
  await setup(page, request, 'Canvas layout');
  const id = await createBoard(page, 'Visual direction');
  const flow = page.locator('.board-flow');
  await page
    .getByRole('button', { name: 'Drag Character.svg', exact: true })
    .dragTo(flow, { targetPosition: { x: 100, y: 110 } });
  await expect
    .poll(async () => (await getBoard(request, id)).items.length)
    .toBe(1);
  let board = await getBoard(request, id);
  const assetId = board.items[0]!.id;
  await page.getByRole('button', { name: 'Add text', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Label', { exact: true }).fill('Lighting direction');
  await dialog
    .getByRole('textbox', { name: 'Text', exact: true })
    .fill('Warm rim light, soft background.');
  await dialog.getByLabel('Width', { exact: true }).fill('280');
  await dialog.getByRole('button', { name: 'Save', exact: true }).click();
  await expect
    .poll(async () => (await getBoard(request, id)).items.length)
    .toBe(2);
  board = await getBoard(request, id);
  const note = board.items.find((entry) => entry.kind === 'text')!;
  const noteNode = page.locator(`.react-flow__node[data-id="${note.id}"]`);
  await moveNode(page, noteNode, 160, 80);
  await expect
    .poll(
      async () =>
        (await getBoard(request, id)).items.find(
          (entry) => entry.id === note.id,
        )?.x,
    )
    .toBeGreaterThan(note.x + 100);
  const source = page.locator(
    `.react-flow__node[data-id="${assetId}"] .react-flow__handle-right`,
  );
  const target = noteNode.locator('.react-flow__handle-left');
  await source.dragTo(target);
  await expect
    .poll(async () => (await getBoard(request, id)).edges.length)
    .toBe(1);
  await page.locator(`.react-flow__node[data-id="${assetId}"]`).click();
  await noteNode.click({ modifiers: ['Shift'] });
  await page
    .getByRole('button', { name: 'Group selection', exact: true })
    .click();
  await expect
    .poll(
      async () =>
        (await getBoard(request, id)).items.filter(
          (entry) => entry.kind === 'group',
        ).length,
    )
    .toBe(1);
  board = await getBoard(request, id);
  const group = board.items.find((entry) => entry.kind === 'group')!;
  const beforeX = board.items.find((entry) => entry.id === note.id)!.x;
  expect(
    board.items
      .filter((entry) => entry.kind !== 'group')
      .every((entry) => entry.groupId === group.id),
  ).toBe(true);
  await moveNode(
    page,
    page.locator(`.react-flow__node[data-id="${group.id}"]`),
    25,
    35,
  );
  await expect
    .poll(
      async () =>
        (await getBoard(request, id)).items.find(
          (entry) => entry.id === note.id,
        )?.x,
    )
    .toBeGreaterThan(beforeX + 15);
  await page.getByRole('button', { name: 'Zoom out', exact: true }).click();
  await expect
    .poll(async () => (await getBoard(request, id)).board.viewport.zoom)
    .toBeLessThan(1);
  const saved = await getBoard(request, id);
  await page.reload();
  await expect(
    page.getByText('Warm rim light, soft background.', { exact: true }),
  ).toBeVisible();
  const reloaded = await getBoard(request, id);
  expect(reloaded.items).toEqual(saved.items);
  expect(reloaded.edges).toEqual(saved.edges);
  expect(reloaded.board.viewport).toEqual(saved.board.viewport);
  expect(reloaded.items.find((entry) => entry.id === note.id)?.width).toBe(280);
  await page
    .locator(`.react-flow__node[data-id="${group.id}"]`)
    .click({ position: { x: 20, y: 15 } });
  await page
    .getByRole('button', { name: 'Ungroup selection', exact: true })
    .click();
  await expect
    .poll(
      async () =>
        (await getBoard(request, id)).items.filter(
          (entry) => entry.kind === 'group',
        ).length,
    )
    .toBe(0);
  expect(
    (await getBoard(request, id)).items.every(
      (entry) => entry.groupId === null,
    ),
  ).toBe(true);
  await page.getByRole('button', { name: 'Rename board', exact: true }).click();
  const rename = page.getByRole('dialog');
  await rename
    .getByLabel('Board name', { exact: true })
    .fill('Unconfirmed change');
  const concurrent = await getBoard(request, id);
  expect(
    (
      await request.patch(`/api/boards/${id}`, {
        data: {
          expectedRevision: concurrent.board.revision,
          name: 'Updated elsewhere',
        },
      })
    ).ok(),
  ).toBe(true);
  await rename.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(rename.getByRole('alert')).toContainText(
    'This change was not saved',
  );
  expect((await getBoard(request, id)).board.name).toBe('Updated elsewhere');
  await rename.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Updated elsewhere', exact: true }),
  ).toBeVisible();
});

test('character and scene matrices retain exact cell pins through axis edits, reordering and reload', async ({
  page,
  request,
}) => {
  await setup(page, request, 'Matrix studies');
  for (const preset of ['Characters × angles', 'Scenes × options'] as const) {
    const id = await createBoard(page, `${preset} study`, { matrix: preset });
    let board = await getBoard(request, id);
    const row = board.board.rows[0]!;
    const column = board.board.columns[0]!;
    const slot = board.slots.find(
      (entry) => entry.rowId === row.id && entry.columnId === column.id,
    )!;
    const cell = page.locator(`[data-slot-id="${slot.id}"]`);
    await dragPin(page, 'Scene.svg', cell);
    await expect(cell.getByText('V1', { exact: true })).toBeVisible();
    const pin = (await getBoard(request, id)).slots.find(
      (entry) => entry.id === slot.id,
    )!.currentPin;
    await page
      .getByRole('button', { name: `Rename ${row.label}`, exact: true })
      .click();
    let dialog = page.getByRole('dialog');
    await dialog.getByLabel('Row name', { exact: true }).fill('Maya');
    await dialog.getByRole('button', { name: 'Save', exact: true }).click();
    await page
      .getByRole('button', { name: 'Move down Maya', exact: true })
      .click();
    await expect
      .poll(async () => (await getBoard(request, id)).board.rows[1]?.label)
      .toBe('Maya');
    await page
      .getByRole('button', { name: `Rename ${column.label}`, exact: true })
      .click();
    dialog = page.getByRole('dialog');
    await dialog
      .getByLabel('Column name', { exact: true })
      .fill('Approved angle');
    await dialog.getByRole('button', { name: 'Save', exact: true }).click();
    await page
      .getByRole('button', { name: 'Move right Approved angle', exact: true })
      .click();
    await expect
      .poll(async () => (await getBoard(request, id)).board.columns[1]?.label)
      .toBe('Approved angle');
    await page.reload();
    await expect(cell.getByText('V1', { exact: true })).toBeVisible();
    board = await getBoard(request, id);
    expect(board.slots.find((entry) => entry.id === slot.id)).toMatchObject({
      rowId: row.id,
      columnId: column.id,
      currentPin: pin,
    });
    await page.getByRole('button', { name: 'Add row', exact: true }).click();
    dialog = page.getByRole('dialog');
    await dialog.getByLabel('Row name', { exact: true }).fill('Extra');
    await dialog.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(
      page.getByRole('button', { name: 'Rename Extra', exact: true }),
    ).toBeVisible();
    await page
      .getByRole('button', { name: 'Remove Extra', exact: true })
      .click();
    await page
      .getByRole('dialog')
      .getByRole('button', { name: 'Delete', exact: true })
      .click();
    await expect(
      page.getByRole('button', { name: 'Rename Extra', exact: true }),
    ).toHaveCount(0);
    await cell.getByRole('button', { name: /Choose asset for/ }).click();
    await page.getByRole('button', { name: 'Clear slot', exact: true }).click();
    await expect(cell.getByText('V2', { exact: true })).toBeVisible();
  }
});
