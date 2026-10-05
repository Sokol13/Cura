/// <reference lib="dom" />
import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import {
  expect,
  test,
  type APIRequestContext,
  type Page,
} from '@playwright/test';
import {
  AssetSchema,
  BoardDocumentSchema,
  BrandSchema,
  ExportManifestSchema,
  ExportPreviewSchema,
  LibrarySchema,
  type Asset,
} from '../packages/shared/src/index.js';

test.use({ viewport: { width: 1440, height: 1000 } });

// Independent ZIP and SHA-256 readers verify the downloaded artifact.
const inspectArchive = String.raw`
import sys,zipfile,json,hashlib
with zipfile.ZipFile(sys.argv[1]) as z:
 name=next(p for p in z.namelist() if p.endswith('/manifest.json'))
 prefix=name[:-len('manifest.json')]
 manifest=json.loads(z.read(name))
 for f in manifest['files']:
  data=z.read(prefix+f['path'])
  assert len(data)==f['size']
  assert hashlib.sha256(data).hexdigest()==f['sha256']
 print(json.dumps(manifest))
`;

const sorted = (ids: string[]) => [...ids].sort();
const pin = (asset: Asset) => ({
  assetId: asset.id,
  versionId: asset.currentVersionId,
});

async function setup(request: APIRequestContext, language: 'en' | 'zh-CN') {
  const library = LibrarySchema.parse(
    await (
      await request.post('/api/libraries', {
        data: { name: `Export scope ${language}` },
      })
    ).json(),
  );
  const imported: Asset[] = [];
  for (const [name, color] of [
    ['A-Selected.svg', '#ad553a'],
    ['B-Selected.svg', '#357876'],
    ['C-Board.svg', '#995d98'],
    ['D-History.svg', '#bf9735'],
    ['E-Brand.svg', '#456aa1'],
    ['F-Replacement.svg', '#699443'],
  ]) {
    const response = await request.post(
      `/api/libraries/${library.id}/upload?name=${name}`,
      {
        headers: { 'content-type': 'application/octet-stream' },
        data: Buffer.from(
          `<svg xmlns="http://www.w3.org/2000/svg" width="80" height="60"><rect width="80" height="60" fill="${color}"/></svg>`,
        ),
      },
    );
    expect(response.status()).toBe(201);
    imported.push(AssetSchema.parse(await response.json()));
  }
  const [a, b, c, d, e, f] = imported as [
    Asset,
    Asset,
    Asset,
    Asset,
    Asset,
    Asset,
  ];
  let board = BoardDocumentSchema.parse(
    await (
      await request.post(`/api/libraries/${library.id}/boards`, {
        data: { name: 'Retained references', kind: 'canvas' },
      })
    ).json(),
  );
  board = BoardDocumentSchema.parse(
    await (
      await request.post(`/api/boards/${board.board.id}/slots`, {
        data: {
          expectedRevision: board.board.revision,
          label: 'Historical reference',
        },
      })
    ).json(),
  );
  for (const asset of [d, a]) {
    board = BoardDocumentSchema.parse(
      await (
        await request.put(`/api/slots/${board.slots[0]!.id}/assignment`, {
          data: { expectedRevision: board.slots[0]!.revision, pin: pin(asset) },
        })
      ).json(),
    );
  }
  const item = {
    id: randomUUID(),
    kind: 'asset' as const,
    x: 80,
    y: 80,
    width: 180,
    height: 140,
    groupId: null,
    label: 'Current board reference',
    text: '',
    ...pin(c),
  };
  board = BoardDocumentSchema.parse(
    await (
      await request.put(`/api/boards/${board.board.id}/layout`, {
        data: {
          expectedRevision: board.board.revision,
          items: [item],
          edges: [],
        },
      })
    ).json(),
  );
  const replacement = await request.post(
    `/api/assets/${a.id}/replace?name=A-Selected-V2.svg`,
    {
      headers: { 'content-type': 'application/octet-stream' },
      data: Buffer.from(
        '<svg xmlns="http://www.w3.org/2000/svg" width="80" height="60"><rect width="80" height="60" fill="#dc6e54"/><circle cx="40" cy="30" r="15" fill="#f1c18b"/></svg>',
      ),
    },
  );
  expect(replacement.ok()).toBe(true);
  const aV2 = AssetSchema.parse(await replacement.json());
  expect(aV2.currentVersionId).not.toBe(a.currentVersionId);
  if (language === 'zh-CN') {
    const brand = BrandSchema.parse(
      await (
        await request.post(`/api/libraries/${library.id}/brands`, {
          data: { name: 'Independent brand reference' },
        })
      ).json(),
    );
    const response = await request.put(`/api/brands/${brand.id}`, {
      data: {
        expectedRevision: brand.revision,
        name: brand.name,
        guidelines: '',
        colors: [],
        fonts: [],
        logos: [{ name: 'Brand-only logo', pin: pin(e) }],
      },
    });
    expect(response.ok()).toBe(true);
  }
  expect(
    (
      await request.patch('/api/settings', {
        data: { activeLibraryId: library.id, language, theme: 'dark' },
      })
    ).ok(),
  ).toBe(true);
  return { library, a: aV2, b, c, d, e, f, board, item };
}

async function selectAssets(
  page: Page,
  assets: Asset[],
  language: 'en' | 'zh-CN',
) {
  await page.goto('/');
  for (const [index, asset] of assets.entries()) {
    await page
      .getByRole('button', {
        name: `${language === 'en' ? 'Select' : '选择'} ${asset.name}`,
        exact: true,
      })
      .click({ modifiers: index ? ['Control'] : [] });
  }
}

async function jobs(request: APIRequestContext, libraryId: string) {
  const response = await request.get(`/api/libraries/${libraryId}/exports`);
  expect(response.ok()).toBe(true);
  return response.json() as Promise<unknown[]>;
}

async function downloadManifest(page: Page, label: string) {
  const directory = await mkdtemp(join(tmpdir(), 'cura-preview-export-'));
  try {
    const link = page.getByRole('link', { name: label, exact: true });
    await expect(link).toBeVisible();
    const download = page.waitForEvent('download');
    await link.click();
    const path = join(directory, 'confirmed.zip');
    await (await download).saveAs(path);
    const result = await promisify(execFile)('python3', [
      '-c',
      inspectArchive,
      path,
    ]);
    return ExportManifestSchema.parse(JSON.parse(result.stdout));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

async function preview(
  request: APIRequestContext,
  libraryId: string,
  assetIds: string[],
) {
  const response = await request.post(
    `/api/libraries/${libraryId}/exports/preview`,
    {
      data: { scope: 'selection', assetIds },
    },
  );
  expect(response.status()).toBe(200);
  return ExportPreviewSchema.parse(await response.json());
}

test('English selected export previews unique board dependencies before confirmation and matches the downloaded archive', async ({
  page,
  request,
}) => {
  const fixture = await setup(request, 'en');
  const { library, a, b, c, d } = fixture;
  await selectAssets(page, [a, b], 'en');
  const launcher = page.getByRole('button', {
    name: 'Export selected assets',
    exact: true,
  });
  await launcher.click();
  const dialog = page.getByRole('dialog', {
    name: 'Neutral export',
    exact: true,
  });
  await expect(
    dialog.getByRole('combobox', { name: 'Export scope', exact: true }),
  ).toHaveValue('selection');
  const confirm = dialog.getByRole('button', {
    name: 'Export 2 selected assets + 2 assets referenced by boards',
    exact: true,
  });
  await expect(confirm).toBeEnabled();
  await expect(
    dialog.getByText('4 assets in this export', { exact: true }),
  ).toBeVisible();
  await expect(dialog.getByText('Boards: 2', { exact: true })).toBeVisible();
  const plan = await preview(request, library.id, [a.id, b.id]);
  expect(plan).toMatchObject({
    requestedAssetIds: sorted([a.id, b.id]),
    includedDependencyAssetIds: sorted([c.id, d.id]),
    requestedAssetCount: 2,
    dependencyAssetCount: 2,
    totalAssetCount: 4,
    reasons: [{ reason: 'board', count: 2 }],
  });
  expect(await jobs(request, library.id)).toEqual([]);
  await page.keyboard.press('Escape');
  await expect(dialog).not.toBeVisible();
  expect(await jobs(request, library.id)).toEqual([]);
  await expect(launcher).toBeFocused();
  await launcher.click();
  await expect(confirm).toBeEnabled();
  expect(await jobs(request, library.id)).toEqual([]);
  await page.screenshot({
    path: 'docs/screenshots/v0.4-export-preview-en.png',
    fullPage: true,
  });
  const creation = page.waitForResponse(
    (response) =>
      response.url().endsWith(`/api/libraries/${library.id}/exports`) &&
      response.request().method() === 'POST',
  );
  await confirm.click();
  const created = await creation;
  expect(created.status()).toBe(201);
  expect(created.request().postDataJSON()).toMatchObject({
    scope: 'selection',
    assetIds: expect.arrayContaining([a.id, b.id]),
    expectedPreviewToken: plan.previewToken,
  });
  const manifest = await downloadManifest(page, 'Download ZIP');
  expect(sorted(manifest.requestedAssetIds)).toEqual(plan.requestedAssetIds);
  expect(sorted(manifest.includedDependencyAssetIds)).toEqual(
    plan.includedDependencyAssetIds,
  );
  expect(sorted(manifest.assets.map((asset) => asset.id))).toEqual(
    sorted([a.id, b.id, c.id, d.id]),
  );
  expect(manifest.assets).toHaveLength(plan.totalAssetCount);
  expect(manifest.versions).toHaveLength(5);
  expect(manifest.files).toHaveLength(5);
  expect(
    manifest.versions.filter((version) => version.assetId === a.id),
  ).toHaveLength(2);
  expect(await jobs(request, library.id)).toHaveLength(1);
});

test('Chinese mixed export rejects a same-count dependency replacement and requires another explicit confirmation', async ({
  page,
  request,
}) => {
  const fixture = await setup(request, 'zh-CN');
  const { library, a, b, c, d, e, f, board, item } = fixture;
  await selectAssets(page, [a, b], 'zh-CN');
  await page.getByRole('button', { name: '导出所选资产', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '中立导出', exact: true });
  await expect(
    dialog.getByRole('combobox', { name: '导出范围', exact: true }),
  ).toHaveValue('selection');
  const confirm = dialog.getByRole('button', {
    name: '导出 2 个选定资产 + 3 个额外依赖资产',
    exact: true,
  });
  await expect(confirm).toBeEnabled();
  await expect(
    dialog.getByText('本次导出共 5 个资产', { exact: true }),
  ).toBeVisible();
  await expect(dialog.getByText('看板：2', { exact: true })).toBeVisible();
  await expect(dialog.getByText('品牌：1', { exact: true })).toBeVisible();
  const before = await preview(request, library.id, [a.id, b.id]);
  expect(before).toMatchObject({
    requestedAssetIds: sorted([a.id, b.id]),
    includedDependencyAssetIds: sorted([c.id, d.id, e.id]),
    requestedAssetCount: 2,
    dependencyAssetCount: 3,
    totalAssetCount: 5,
    reasons: [
      { reason: 'board', count: 2 },
      { reason: 'brand', count: 1 },
    ],
  });
  expect(await jobs(request, library.id)).toEqual([]);
  const change = await request.put(`/api/boards/${board.board.id}/layout`, {
    data: {
      expectedRevision: board.board.revision,
      items: [{ ...item, ...pin(f) }],
      edges: [],
    },
  });
  expect(change.ok()).toBe(true);
  const staleResponse = page.waitForResponse(
    (response) =>
      response.url().endsWith(`/api/libraries/${library.id}/exports`) &&
      response.request().method() === 'POST',
  );
  const refreshedResponse = page.waitForResponse(
    (response) =>
      response.url().endsWith(`/api/libraries/${library.id}/exports/preview`) &&
      response.request().method() === 'POST',
  );
  await confirm.click();
  const stale = await staleResponse;
  expect(stale.status()).toBe(409);
  expect(await stale.json()).toMatchObject({ code: 'EXPORT_PREVIEW_STALE' });
  expect(stale.request().postDataJSON()).toMatchObject({
    expectedPreviewToken: before.previewToken,
  });
  const refreshed = await refreshedResponse;
  expect(refreshed.status()).toBe(200);
  const after = ExportPreviewSchema.parse(await refreshed.json());
  expect(after.previewToken).not.toBe(before.previewToken);
  expect(after).toMatchObject({
    requestedAssetIds: before.requestedAssetIds,
    includedDependencyAssetIds: sorted([d.id, e.id, f.id]),
    requestedAssetCount: 2,
    dependencyAssetCount: 3,
    totalAssetCount: 5,
    reasons: before.reasons,
  });
  await expect(dialog.getByRole('alert')).toHaveText(
    '导出内容已变化，请核对更新后的数量并再次确认。',
  );
  await expect(confirm).toBeEnabled();
  expect(await jobs(request, library.id)).toEqual([]);
  await expect(
    dialog.getByRole('link', { name: '下载 ZIP', exact: true }),
  ).toHaveCount(0);
  await page.screenshot({
    path: 'docs/screenshots/v0.4-export-preview-zh.png',
    fullPage: true,
  });
  const creation = page.waitForResponse(
    (response) =>
      response.url().endsWith(`/api/libraries/${library.id}/exports`) &&
      response.request().method() === 'POST',
  );
  await confirm.click();
  const created = await creation;
  expect(created.status()).toBe(201);
  expect(created.request().postDataJSON()).toMatchObject({
    expectedPreviewToken: after.previewToken,
  });
  const manifest = await downloadManifest(page, '下载 ZIP');
  expect(sorted(manifest.requestedAssetIds)).toEqual(after.requestedAssetIds);
  expect(sorted(manifest.includedDependencyAssetIds)).toEqual(
    after.includedDependencyAssetIds,
  );
  expect(sorted(manifest.assets.map((asset) => asset.id))).toEqual(
    sorted([a.id, b.id, d.id, e.id, f.id]),
  );
  expect(manifest.assets).toHaveLength(after.totalAssetCount);
  expect(manifest.versions).toHaveLength(6);
  expect(manifest.files).toHaveLength(6);
  expect(
    manifest.versions.filter((version) => version.assetId === a.id),
  ).toHaveLength(2);
  expect(await jobs(request, library.id)).toHaveLength(1);
});
