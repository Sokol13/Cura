/// <reference lib="dom" />
import { mkdir } from 'node:fs/promises';
import {
  expect,
  test,
  type APIRequestContext,
  type Locator,
  type Page,
  type Request as BrowserRequest,
} from '@playwright/test';
import {
  AssetSchema,
  BoardDocumentSchema,
  LibrarySchema,
  SlotHistorySchema,
  type Asset,
  type BoardPin,
  type SlotRevision,
} from '../packages/shared/src/index.js';

test.use({ viewport: { width: 1500, height: 1000 } });

type Language = 'en' | 'zh-CN';
type Source = {
  asset: Asset;
  name: string;
  versionOrdinal: number;
  bytes: Buffer;
  color: [number, number, number];
};
const copy = {
  en: {
    history: 'History for Reference',
    left: 'Left slot version',
    right: 'Right slot version',
    leftPane: 'Left comparison',
    rightPane: 'Right comparison',
    local: 'Local user',
    actor: 'Changed by',
    download: 'Download pinned original',
    cleared: 'Cleared',
    unavailable: 'Preview is unavailable. Download the pinned original.',
    close: 'Close',
    sourceVersion: (number: number) => `Asset version V${number}`,
  },
  'zh-CN': {
    history: 'Reference 的历史',
    left: '左侧槽位版本',
    right: '右侧槽位版本',
    leftPane: '左侧对比',
    rightPane: '右侧对比',
    local: '本机用户',
    actor: '操作者',
    download: '下载固定版本原文件',
    cleared: '已清空',
    unavailable: '无法预览，可下载固定版本原文件。',
    close: '关闭',
    sourceVersion: (number: number) => `资产版本 V${number}`,
  },
} as const;

function artwork(color: Source['color']): Buffer {
  return Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="96" height="64"><rect width="96" height="64" fill="rgb(${color.join(',')})"/></svg>`,
  );
}
async function getBoard(request: APIRequestContext, id: string) {
  const response = await request.get(`/api/boards/${id}`);
  expect(response.ok()).toBe(true);
  return BoardDocumentSchema.parse(await response.json());
}
async function history(request: APIRequestContext, id: string) {
  const response = await request.get(`/api/slots/${id}/history`);
  expect(response.ok()).toBe(true);
  return SlotHistorySchema.parse(await response.json());
}
async function setup(request: APIRequestContext, name: string) {
  const library = LibrarySchema.parse(
    await (await request.post('/api/libraries', { data: { name } })).json(),
  );
  expect(
    (
      await request.patch('/api/settings', {
        data: { activeLibraryId: library.id, language: 'en', theme: 'dark' },
      })
    ).ok(),
  ).toBe(true);
  const board = BoardDocumentSchema.parse(
    await (
      await request.post(`/api/libraries/${library.id}/boards`, {
        data: { name, kind: 'canvas' },
      })
    ).json(),
  );
  const document = BoardDocumentSchema.parse(
    await (
      await request.post(`/api/boards/${board.board.id}/slots`, {
        data: {
          expectedRevision: board.board.revision,
          label: 'Reference',
          x: 100,
          y: 100,
          width: 260,
          height: 200,
        },
      })
    ).json(),
  );
  const slotId = document.slots[0]!.id;
  async function upload(filename: string, bytes: Buffer) {
    const response = await request.post(
      `/api/libraries/${library.id}/upload?name=${encodeURIComponent(filename)}`,
      { headers: { 'content-type': 'application/octet-stream' }, data: bytes },
    );
    expect(response.status()).toBe(201);
    return AssetSchema.parse(await response.json());
  }
  async function assign(pin: BoardPin | null) {
    const current = await getBoard(request, board.board.id);
    const slot = current.slots.find((entry) => entry.id === slotId)!;
    const response = await request.put(`/api/slots/${slotId}/assignment`, {
      data: { expectedRevision: slot.revision, pin },
    });
    expect(response.ok()).toBe(true);
  }
  return { library, boardId: board.board.id, slotId, upload, assign };
}
async function replace(
  request: APIRequestContext,
  assetId: string,
  filename: string,
  bytes: Buffer,
) {
  const response = await request.post(
    `/api/assets/${assetId}/replace?name=${encodeURIComponent(filename)}`,
    { headers: { 'content-type': 'application/octet-stream' }, data: bytes },
  );
  expect(response.ok()).toBe(true);
  return AssetSchema.parse(await response.json());
}
async function mixedHistory(request: APIRequestContext, name: string) {
  const fixture = await setup(request, name);
  const aColor: Source['color'] = [224, 48, 32];
  const bColor: Source['color'] = [37, 176, 80];
  const aBytes = artwork(aColor);
  const bBytes = artwork(bColor);
  const a = await fixture.upload('角色-A-初稿.svg', aBytes);
  const bV1 = await fixture.upload('场景-B-初稿.svg', artwork([32, 128, 208]));
  const b = await replace(request, bV1.id, '场景-B-定稿.svg', bBytes);
  const first = { assetId: a.id, versionId: a.currentVersionId };
  const second = { assetId: b.id, versionId: b.currentVersionId };
  await fixture.assign(first);
  await fixture.assign(second);
  await fixture.assign(first);
  const rows = await history(request, fixture.slotId);
  expect(rows.map((row) => row.pin)).toEqual([first, second, first]);
  return {
    ...fixture,
    rows,
    a: {
      asset: a,
      name: '角色-A-初稿.svg',
      versionOrdinal: 1,
      bytes: aBytes,
      color: aColor,
    },
    b: {
      asset: b,
      name: '场景-B-定稿.svg',
      versionOrdinal: 2,
      bytes: bBytes,
      color: bColor,
    },
  };
}
async function openHistory(
  page: Page,
  boardId: string,
  language: Language = 'en',
) {
  await page.goto(`/?workspace=boards&board=${boardId}`);
  await page
    .getByRole('button', { name: copy[language].history, exact: true })
    .click();
  const dialog = page.getByRole('dialog', {
    name: copy[language].history,
    exact: true,
  });
  await expect(dialog).toBeVisible();
  return dialog;
}
function selectors(dialog: Locator, language: Language = 'en') {
  return {
    left: dialog.getByRole('combobox', {
      name: copy[language].left,
      exact: true,
    }),
    right: dialog.getByRole('combobox', {
      name: copy[language].right,
      exact: true,
    }),
    leftPane: dialog.getByRole('region', {
      name: copy[language].leftPane,
      exact: true,
    }),
    rightPane: dialog.getByRole('region', {
      name: copy[language].rightPane,
      exact: true,
    }),
  };
}
async function expectPane(
  request: APIRequestContext,
  pane: Locator,
  row: SlotRevision,
  source: Source,
  language: Language = 'en',
) {
  expect(row).toMatchObject({
    actor: { kind: 'local' },
    source: {
      assetId: source.asset.id,
      versionId: source.asset.currentVersionId,
      name: source.name,
      type: source.asset.type,
      versionOrdinal: source.versionOrdinal,
    },
  });
  await expect(
    pane.getByRole('definition').filter({ hasText: source.name }),
  ).toBeVisible();
  await expect(
    pane.getByText(copy[language].sourceVersion(source.versionOrdinal), {
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    pane.getByText(copy[language].actor, { exact: true }),
  ).toBeVisible();
  await expect(
    pane.getByText(copy[language].local, { exact: true }),
  ).toBeVisible();
  await expect(pane.locator('time')).toHaveAttribute('datetime', row.createdAt);
  await expect(pane.locator('time')).not.toHaveText('');
  const image = pane.getByRole('img');
  await expect(image).toBeVisible();
  await expect(image).toHaveAttribute(
    'src',
    `/api/versions/${row.pin!.versionId}/thumbnail`,
  );
  await expect
    .poll(() =>
      image.evaluate(
        (element) =>
          element instanceof HTMLImageElement &&
          element.complete &&
          element.naturalWidth > 0,
      ),
    )
    .toBe(true);
  const pixel = await image.evaluate((element) => {
    if (!(element instanceof HTMLImageElement))
      throw new Error('Expected a decoded image');
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 1;
    const context = canvas.getContext('2d')!;
    context.drawImage(element, 0, 0, 1, 1);
    return Array.from(context.getImageData(0, 0, 1, 1).data);
  });
  source.color.forEach((value, index) =>
    expect(Math.abs(pixel[index]! - value)).toBeLessThan(12),
  );
  const link = pane.getByRole('link', {
    name: copy[language].download,
    exact: true,
  });
  await expect(link).toHaveAttribute(
    'href',
    `/api/versions/${row.pin!.versionId}/file`,
  );
  const original = await request.get(
    `/api/versions/${row.pin!.versionId}/file`,
  );
  expect(original.ok()).toBe(true);
  expect(await original.body()).toEqual(source.bytes);
}
async function switchLanguage(page: Page, boardId: string, language: Language) {
  const chinese = language === 'zh-CN';
  await page
    .getByRole('button', {
      name: chinese ? 'Back to library' : '返回资产库',
      exact: true,
    })
    .click();
  await page
    .getByRole('button', { name: chinese ? 'Settings' : '设置', exact: true })
    .click();
  const dialog = page.getByRole('dialog');
  await dialog
    .getByRole('combobox', { name: chinese ? 'Language' : '语言', exact: true })
    .selectOption(language);
  await expect(
    dialog.getByRole('heading', {
      name: chinese ? '设置' : 'Settings',
      exact: true,
    }),
  ).toBeVisible();
  await dialog
    .getByRole('button', { name: copy[language].close, exact: true })
    .last()
    .click();
  return openHistory(page, boardId, language);
}

test('slot history compares different assets and exact asset versions, including repeated pins in distinct revisions', async ({
  page,
  request,
}) => {
  const fixture = await mixedHistory(request, 'Slot history comparison');
  const [third, second, first] = fixture.rows;
  const dialog = await openHistory(page, fixture.boardId);
  const controls = selectors(dialog);
  // On the pre-feature runtime, this fails for genuinely missing UI controls,
  // before any assertion requiring enriched actor/source DTO fields.
  await expect(controls.left).toBeVisible();
  await expect(controls.left).toHaveValue(second!.id);
  await expect(controls.right).toHaveValue(third!.id);
  await expectPane(request, controls.leftPane, second!, fixture.b);
  await expectPane(request, controls.rightPane, third!, fixture.a);
  const leftBounds = await controls.leftPane.boundingBox();
  const rightBounds = await controls.rightPane.boundingBox();
  expect(leftBounds).not.toBeNull();
  expect(rightBounds).not.toBeNull();
  expect(leftBounds!.x + leftBounds!.width).toBeLessThanOrEqual(
    rightBounds!.x + 1,
  );
  expect(
    Math.min(
      leftBounds!.y + leftBounds!.height,
      rightBounds!.y + rightBounds!.height,
    ),
  ).toBeGreaterThan(Math.max(leftBounds!.y, rightBounds!.y));
  await controls.left.selectOption(first!.id);
  await expect(controls.right).toHaveValue(third!.id);
  expect(first!.pin).toEqual(third!.pin);
  await expectPane(request, controls.leftPane, first!, fixture.a);
  await expectPane(request, controls.rightPane, third!, fixture.a);
  await controls.right.selectOption(second!.id);
  await expectPane(request, controls.rightPane, second!, fixture.b);
  expect(await history(request, fixture.slotId)).toEqual(fixture.rows);
});

test('historical comparison survives renamed replacements and Trash, switches language, and never rewrites history', async ({
  page,
  request,
}) => {
  const fixture = await mixedHistory(
    request,
    'Historical provenance after Trash',
  );
  await replace(
    request,
    fixture.a.asset.id,
    'A-后续改名.txt',
    Buffer.from('Later nonvisual A version'),
  );
  await replace(
    request,
    fixture.b.asset.id,
    'B-后续改名.txt',
    Buffer.from('Later nonvisual B version'),
  );
  expect(
    (
      await request.post(`/api/libraries/${fixture.library.id}/assets/batch`, {
        data: {
          assetIds: [fixture.a.asset.id, fixture.b.asset.id],
          action: 'trash',
        },
      })
    ).ok(),
  ).toBe(true);
  const beforeBoard = await getBoard(request, fixture.boardId);
  const writes: string[] = [];
  page.on('request', (entry) => {
    if (
      ['POST', 'PUT', 'PATCH', 'DELETE'].includes(entry.method()) &&
      /\/api\/(boards|slots)\//.test(new URL(entry.url()).pathname)
    )
      writes.push(entry.url());
  });
  let dialog = await openHistory(page, fixture.boardId);
  await expect(selectors(dialog).left).toBeVisible();
  await dialog.getByRole('button', { name: 'Close', exact: true }).click();
  await page.reload();
  dialog = await openHistory(page, fixture.boardId);
  const [third, second, first] = fixture.rows;
  for (const [index, language] of (['en', 'zh-CN', 'en'] as const).entries()) {
    if (index > 0) {
      await dialog
        .getByRole('button', {
          name: copy[index === 1 ? 'en' : 'zh-CN'].close,
          exact: true,
        })
        .click();
      dialog = await switchLanguage(page, fixture.boardId, language);
    }
    const controls = selectors(dialog, language);
    await expect(controls.left).toHaveValue(second!.id);
    await expect(controls.right).toHaveValue(third!.id);
    await expect(
      controls.left.locator(`option[value="${third!.id}"]`),
    ).toHaveJSProperty('disabled', true);
    await expect(
      controls.right.locator(`option[value="${second!.id}"]`),
    ).toHaveJSProperty('disabled', true);
    await controls.left.focus();
    await page.keyboard.press('End');
    await page.keyboard.press('Tab');
    await expect(controls.left).toHaveValue(first!.id);
    await expect(controls.right).toHaveValue(third!.id);
    await controls.right.selectOption(second!.id);
    await expectPane(request, controls.leftPane, first!, fixture.a, language);
    await expectPane(request, controls.rightPane, second!, fixture.b, language);
    await expect(
      dialog.getByText('A-后续改名.txt', { exact: true }),
    ).toHaveCount(0);
    await expect(
      dialog.getByText('B-后续改名.txt', { exact: true }),
    ).toHaveCount(0);
    if (language === 'zh-CN') {
      await mkdir('docs/screenshots', { recursive: true });
      await page.screenshot({
        path: 'docs/screenshots/v0.4.0-slot-history.png',
        fullPage: true,
      });
    }
  }
  expect(writes).toEqual([]);
  expect(await history(request, fixture.slotId)).toEqual(fixture.rows);
  expect(await getBoard(request, fixture.boardId)).toEqual(beforeBoard);
});

test('empty, single, generic-file and cleared history have accessible comparison states without broken images', async ({
  page,
  request,
}) => {
  const fixture = await setup(request, 'Generic and cleared slot history');
  let dialog = await openHistory(page, fixture.boardId);
  await expect(
    dialog.getByText('No assignments yet.', { exact: true }),
  ).toBeVisible();
  await expect(dialog.getByRole('combobox')).toHaveCount(0);
  await dialog.getByRole('button', { name: 'Close', exact: true }).click();
  const bytes = Buffer.from('Exact retained non-previewable reference bytes.');
  const asset = await fixture.upload('参考说明.txt', bytes);
  await fixture.assign({
    assetId: asset.id,
    versionId: asset.currentVersionId,
  });
  dialog = await openHistory(page, fixture.boardId);
  await expect(
    dialog.getByText('Assign another version to compare.', { exact: true }),
  ).toBeVisible();
  await expect(dialog.getByRole('combobox')).toHaveCount(0);
  await expect(
    dialog.getByText(copy.en.unavailable, { exact: true }),
  ).toBeVisible();
  await expect(dialog.locator('img')).toHaveCount(0);
  await dialog.getByRole('button', { name: 'Close', exact: true }).click();
  await fixture.assign(null);
  const rows = await history(request, fixture.slotId);
  await page.goto(`/?workspace=boards&board=${fixture.boardId}`);
  await expect(page.locator('.board-tray-scroll')).toHaveAttribute(
    'aria-busy',
    'false',
  );
  const thumbnailRequests: string[] = [];
  const recordThumbnail = (entry: BrowserRequest) => {
    if (
      /\/api\/versions\/[^/]+\/thumbnail$/.test(new URL(entry.url()).pathname)
    )
      thumbnailRequests.push(entry.url());
  };
  page.on('request', recordThumbnail);
  await page
    .getByRole('button', { name: copy.en.history, exact: true })
    .click();
  dialog = page.getByRole('dialog', { name: copy.en.history, exact: true });
  const controls = selectors(dialog);
  await expect(controls.left).toHaveValue(rows[1]!.id);
  await expect(controls.right).toHaveValue(rows[0]!.id);
  await expect(
    controls.leftPane
      .getByRole('definition')
      .filter({ hasText: '参考说明.txt' }),
  ).toBeVisible();
  await expect(
    controls.leftPane.getByText(copy.en.unavailable, { exact: true }),
  ).toBeVisible();
  await expect(
    controls.leftPane.getByRole('link', {
      name: copy.en.download,
      exact: true,
    }),
  ).toHaveAttribute('href', `/api/versions/${asset.currentVersionId}/file`);
  await expect(
    controls.rightPane.getByText(copy.en.cleared, { exact: true }),
  ).toBeVisible();
  await expect(controls.rightPane.getByRole('link')).toHaveCount(0);
  await expect(dialog.locator('img')).toHaveCount(0);
  expect(rows[0]).toMatchObject({
    pin: null,
    source: null,
    actor: { kind: 'local' },
  });
  expect(
    await (
      await request.get(`/api/versions/${asset.currentVersionId}/file`)
    ).body(),
  ).toEqual(bytes);
  expect(thumbnailRequests).toEqual([]);
  page.off('request', recordThumbnail);
  await dialog.getByRole('button', { name: 'Close', exact: true }).click();
  dialog = await switchLanguage(page, fixture.boardId, 'zh-CN');
  const chinese = selectors(dialog, 'zh-CN');
  await expect(chinese.left).toHaveValue(rows[1]!.id);
  await expect(chinese.right).toHaveValue(rows[0]!.id);
  await expect(
    chinese.leftPane.getByText(copy['zh-CN'].unavailable, { exact: true }),
  ).toBeVisible();
  await expect(
    chinese.rightPane.getByText(copy['zh-CN'].cleared, { exact: true }),
  ).toBeVisible();
  await expect(
    chinese.leftPane.getByRole('link', {
      name: copy['zh-CN'].download,
      exact: true,
    }),
  ).toHaveAttribute('href', `/api/versions/${asset.currentVersionId}/file`);
  await expect(chinese.rightPane.getByRole('link')).toHaveCount(0);
  await expect(dialog.locator('img')).toHaveCount(0);
  await page.setViewportSize({ width: 620, height: 900 });
  const dialogBounds = await dialog.boundingBox();
  const leftBounds = await chinese.leftPane.boundingBox();
  const rightBounds = await chinese.rightPane.boundingBox();
  expect(dialogBounds!.x).toBeGreaterThanOrEqual(0);
  expect(dialogBounds!.x + dialogBounds!.width).toBeLessThanOrEqual(620);
  expect(leftBounds!.y + leftBounds!.height).toBeLessThanOrEqual(
    rightBounds!.y + 1,
  );
  await page.screenshot({
    path: 'docs/screenshots/v0.4.0-slot-history-narrow.png',
    fullPage: false,
  });
  expect(await history(request, fixture.slotId)).toEqual(rows);
});
