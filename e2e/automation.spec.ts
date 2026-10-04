/// <reference lib="dom" />
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import {
  test,
  expect,
  type Page,
  type APIRequestContext,
} from '@playwright/test';
import {
  AssetPageSchema,
  AssetSchema,
  LibrarySchema,
  AutomationProposalsPageSchema,
  ScriptsPageSchema,
  SettingDocumentsPageSchema,
  SettingDocumentSchema,
  ArchiveRulesPageSchema,
  BoardDocumentSchema,
} from '../packages/shared/src/index.js';

test.use({ viewport: { width: 1500, height: 1000 } });
const image = (color: string) =>
  Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300"><rect width="400" height="300" fill="${color}"/><circle cx="220" cy="110" r="70" fill="#f4dfb5"/><path d="M10 300L210 160L390 300" fill="#323743"/></svg>`,
  );
const base = (id: string) => `/api/libraries/${id}/automation`;
async function setup(page: Page, request: APIRequestContext, name: string) {
  const external: string[] = [];
  await page.route('**/*', (route) => {
    const url = new URL(route.request().url());
    if (url.protocol.startsWith('http') && url.hostname !== '127.0.0.1') {
      external.push(url.origin);
      return route.abort();
    }
    return route.continue();
  });
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
        name: 'Red forest portrait.svg',
        mimeType: 'image/svg+xml',
        buffer: image('#87423e'),
      },
      {
        name: 'Blue scene draft.svg',
        mimeType: 'image/svg+xml',
        buffer: image('#305c7b'),
      },
    ]);
  await expect(
    page.getByRole('button', {
      name: 'Select Red forest portrait.svg',
      exact: true,
    }),
  ).toBeVisible({ timeout: 15000 });
  const assets = AssetPageSchema.parse(
    await (await request.get(`/api/libraries/${library.id}/assets`)).json(),
  ).items;
  await page
    .getByRole('button', { name: 'Automation & documents', exact: true })
    .click();
  await expect(
    page.getByRole('heading', { name: 'Automation & documents', exact: true }),
  ).toBeVisible();
  return { library, assets, external };
}
async function asset(request: APIRequestContext, id: string) {
  return AssetSchema.parse(
    await (await request.get(`/api/assets/${id}`)).json(),
  );
}

test('offline proposals review exact versions, apply selected fields and selectively undo without overwriting manual changes', async ({
  page,
  request,
}) => {
  const { library, assets, external } = await setup(
    page,
    request,
    'Automation review',
  );
  const original = assets.find((a) => a.name === 'Red forest portrait.svg')!;
  await page
    .getByRole('checkbox', { name: `Select ${original.name}`, exact: true })
    .check();
  await page
    .getByRole('button', { name: 'Analyze selected assets', exact: true })
    .click();
  const display = page.getByRole('checkbox', {
    name: `Select Display name for ${original.name}`,
    exact: true,
  });
  await expect(display).toBeEnabled();
  const proposals = AutomationProposalsPageSchema.parse(
    await (await request.get(`${base(library.id)}/proposals`)).json(),
  );
  const proposal = proposals.items[0]!;
  expect(proposal.versionId).toBe(original.currentVersionId);
  expect(proposal.provenance.kind).toBe('metadata-rules');
  const expectedName = proposal.changes.find(
    (change) => change.field === 'displayName',
  )!.afterValue;
  await display.check();
  await page
    .getByRole('button', { name: 'Apply selected changes', exact: true })
    .click();
  await expect
    .poll(async () => (await asset(request, original.id)).displayName)
    .toBe(expectedName);
  expect((await asset(request, original.id)).tags).toEqual([]);
  const tags = page.getByRole('checkbox', {
    name: `Select Tags for ${original.name}`,
    exact: true,
  });
  await tags.check();
  await page
    .getByRole('button', { name: 'Apply selected changes', exact: true })
    .click();
  await expect
    .poll(async () => (await asset(request, original.id)).tags.length)
    .toBeGreaterThan(0);
  await request.patch(`/api/assets/${original.id}`, {
    data: { note: 'Keep my manual note' },
  });
  await tags.check();
  await page
    .getByRole('button', { name: 'Undo selected changes', exact: true })
    .click();
  await expect
    .poll(async () => (await asset(request, original.id)).tags.length)
    .toBe(0);
  expect(await asset(request, original.id)).toMatchObject({
    name: original.name,
    displayName: expectedName,
    note: 'Keep my manual note',
    currentVersionId: original.currentVersionId,
  });
  await request.patch(`/api/assets/${original.id}`, {
    data: { displayName: 'My reviewed title' },
  });
  await display.check();
  await page
    .getByRole('button', { name: 'Undo selected changes', exact: true })
    .click();
  await expect(page.getByRole('alert')).toContainText(
    'Changes that need review',
  );
  expect((await asset(request, original.id)).displayName).toBe(
    'My reviewed title',
  );
  expect(
    await (
      await request.get(`/api/versions/${original.currentVersionId}/file`)
    ).body(),
  ).toEqual(image('#87423e'));
  await page.screenshot({
    path: 'docs/screenshots/v0.3-automation.png',
    fullPage: true,
  });
  await page.reload();
  await expect(
    page.getByRole('checkbox', {
      name: `Select Display name for ${original.name}`,
      exact: true,
    }),
  ).toBeVisible();
  expect(external).toEqual([]);
});

test('archive rule CRUD previews and protects historical final pins while archiving eligible assets', async ({
  page,
  request,
}) => {
  const { library, assets } = await setup(page, request, 'Archive rules');
  const protectedAsset = assets.find(
    (a) => a.name === 'Red forest portrait.svg',
  )!;
  let board = BoardDocumentSchema.parse(
    await (
      await request.post(`/api/libraries/${library.id}/boards`, {
        data: { name: 'Final picks' },
      })
    ).json(),
  );
  board = BoardDocumentSchema.parse(
    await (
      await request.post(`/api/boards/${board.board.id}/slots`, {
        data: {
          expectedRevision: board.board.revision,
          label: 'Final',
          x: 0,
          y: 0,
          width: 300,
          height: 250,
        },
      })
    ).json(),
  );
  await request.put(`/api/slots/${board.slots[0]!.id}/assignment`, {
    data: {
      expectedRevision: 0,
      pin: {
        assetId: protectedAsset.id,
        versionId: protectedAsset.currentVersionId,
      },
    },
  });
  expect(
    (
      await request.post(
        `/api/assets/${protectedAsset.id}/replace?name=New.svg`,
        {
          headers: { 'content-type': 'application/octet-stream' },
          data: image('#656144'),
        },
      )
    ).ok(),
  ).toBe(true);
  await page
    .getByRole('button', { name: 'Archive rules', exact: true })
    .click();
  await page
    .getByRole('button', { name: 'New archive rule', exact: true })
    .click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Rule name').fill('Unfinished drafts');
  await dialog.getByLabel('Minimum age in days').fill('0');
  await dialog.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Unfinished drafts', exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Preview rule', exact: true }).click();
  await expect(
    page.getByRole('heading', {
      name: 'Protected final selections · 1',
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page.getByRole('heading', { name: 'Eligible assets · 1', exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Run rule', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Archive run result', exact: true }),
  ).toBeVisible();
  const draft = assets.find((a) => a.name === 'Blue scene draft.svg')!;
  expect((await asset(request, draft.id)).archivedAt).not.toBeNull();
  expect((await asset(request, protectedAsset.id)).archivedAt).toBeNull();
  await page.getByRole('button', { name: 'Edit', exact: true }).click();
  await dialog.getByLabel('Rule name').fill('Reviewed archive');
  await dialog.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Reviewed archive', exact: true }),
  ).toBeVisible();
  await page.reload();
  await page
    .getByRole('button', { name: 'Reviewed archive', exact: true })
    .click();
  await page.getByRole('button', { name: 'Delete', exact: true }).click();
  await dialog.getByRole('button', { name: 'Delete', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Reviewed archive', exact: true }),
  ).toHaveCount(0);
  expect(
    ArchiveRulesPageSchema.parse(
      await (await request.get(`${base(library.id)}/archive-rules`)).json(),
    ).total,
  ).toBe(0);
});

test('retained bilingual script edits and historical-version documents persist, recover conflicts and export exact sources', async ({
  page,
  request,
}) => {
  const { library, assets, external } = await setup(
    page,
    request,
    'Scripts and documents',
  );
  const original = assets.find((a) => a.name === 'Red forest portrait.svg')!;
  await request.patch(`/api/assets/${original.id}`, {
    data: {
      prompt: 'Forest traveler, warm light',
      model: 'Model V1',
      seed: '18446744073709551615',
      note: 'Original mood',
    },
  });
  expect(
    (
      await request.post(`/api/assets/${original.id}/replace?name=New.svg`, {
        headers: { 'content-type': 'application/octet-stream' },
        data: image('#664b79'),
      })
    ).ok(),
  ).toBe(true);
  await request.patch(`/api/assets/${original.id}`, {
    data: { prompt: 'Different V2', seed: '2' },
  });
  await page
    .getByRole('button', { name: 'Script breakdowns', exact: true })
    .click();
  const source = Buffer.from(
    '场景：雨夜森林\r\n人物：林舟\r\n道具：指南针\r\n林舟寻找归途。\r\n',
  );
  await page.getByLabel('Import script', { exact: true }).setInputFiles({
    name: '雨夜.fountain',
    mimeType: 'text/plain',
    buffer: source,
  });
  await expect(page.getByLabel('Entity name')).toHaveCount(3);
  await page.getByLabel('Title', { exact: true }).fill('雨夜 · Reviewed');
  await page
    .getByLabel('Notes', { exact: true })
    .nth(1)
    .fill('Main character · 主角');
  await page.getByRole('button', { name: 'Add entity', exact: true }).click();
  const newEntity = page.locator('.automation-entity').last();
  await newEntity.getByLabel('Entity name').fill('Lantern');
  await newEntity.getByLabel('Entity kind').selectOption('prop');
  await newEntity.getByRole('button', { name: 'Add source range' }).click();
  await newEntity.getByLabel('Start line').fill('3');
  await newEntity.getByLabel('End line').fill('4');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: '雨夜 · Reviewed', exact: true }),
  ).toBeVisible();
  const scripts = ScriptsPageSchema.parse(
    await (await request.get(`${base(library.id)}/scripts`)).json(),
  );
  const script = scripts.items[0]!;
  expect(
    script.entities.find((e) => e.name === 'Lantern')?.references[0]?.excerpt,
  ).toBe('道具：指南针\r\n林舟寻找归途。');
  expect(
    await (
      await request.get(`/api/versions/${script.sourcePin.versionId}/file`)
    ).body(),
  ).toEqual(source);
  await page.reload();
  await page
    .getByRole('button', { name: '雨夜 · Reviewed', exact: true })
    .click();
  await expect(page.getByLabel('Entity name')).toHaveCount(4);
  await page
    .getByRole('button', { name: 'Setting documents', exact: true })
    .click();
  await page
    .getByRole('button', { name: 'New setting document', exact: true })
    .click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Title', { exact: true }).fill('林舟设定 · V1');
  await dialog.getByLabel('Document kind').selectOption('character');
  await dialog.getByLabel('Document language').selectOption('zh-CN');
  await dialog
    .getByRole('checkbox', { name: 'Select New.svg', exact: true })
    .check();
  await dialog
    .getByLabel('New.svg version', { exact: true })
    .selectOption(original.currentVersionId);
  await dialog
    .getByRole('combobox', { name: 'Script references', exact: true })
    .selectOption(script.id);
  await dialog
    .getByRole('checkbox', { name: '林舟 · Character', exact: true })
    .check();
  await dialog
    .getByRole('button', { name: 'Generate document', exact: true })
    .click();
  await expect(page.getByLabel('Markdown content')).toContainText(
    '18446744073709551615',
  );
  let document = SettingDocumentsPageSchema.parse(
    await (await request.get(`${base(library.id)}/documents`)).json(),
  ).items[0]!;
  expect(document.sources[0]).toMatchObject({
    versionId: original.currentVersionId,
    seed: '18446744073709551615',
    prompt: 'Forest traveler, warm light',
    hash: createHash('sha256').update(image('#87423e')).digest('hex'),
  });
  expect(document.entities[0]?.name).toBe('林舟');
  await page
    .getByLabel('Markdown content')
    .fill(`${document.markdown}\n\n## Reviewed\nApproved direction.`);
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(
    page.getByText(`Revision ${document.revision + 1} · Saved`, {
      exact: true,
    }),
  ).toBeVisible();
  const downloadPromise = page.waitForEvent('download');
  await page
    .getByRole('link', { name: 'Export structured JSON', exact: true })
    .click();
  const download = await downloadPromise;
  document = SettingDocumentSchema.parse(
    JSON.parse(await readFile((await download.path())!, 'utf8')),
  );
  expect(document.markdown).toContain('Approved direction.');
  const markdownDownload = page.waitForEvent('download');
  await page
    .getByRole('link', { name: 'Export Markdown', exact: true })
    .click();
  expect(await readFile((await (await markdownDownload).path())!, 'utf8')).toBe(
    document.markdown,
  );
  await request.patch(`${base(library.id)}/documents/${document.id}`, {
    data: { expectedRevision: document.revision, title: 'Externally reviewed' },
  });
  await page.getByLabel('Title', { exact: true }).fill('My unsaved draft');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('changed elsewhere');
  await expect(page.getByLabel('Title', { exact: true })).toHaveValue(
    'My unsaved draft',
  );
  await page
    .getByRole('button', { name: 'Reload latest', exact: true })
    .click();
  await expect(page.getByLabel('Title', { exact: true })).toHaveValue(
    'Externally reviewed',
  );
  await page.reload();
  await page
    .getByRole('button', { name: 'Externally reviewed', exact: true })
    .click();
  await expect(page.getByLabel('Markdown content')).toContainText(
    'Approved direction.',
  );
  await request.patch('/api/settings', {
    data: { language: 'zh-CN', theme: 'light' },
  });
  await page.reload();
  await expect(
    page.getByRole('heading', { name: '自动化与设定文档', exact: true }),
  ).toBeVisible();
  await page
    .getByRole('button', { name: 'Externally reviewed', exact: true })
    .click();
  await page.screenshot({
    path: 'docs/screenshots/v0.3-setting-document.png',
    fullPage: true,
  });
  expect(external).toEqual([]);
});
