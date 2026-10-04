import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import {
  AssetPageSchema,
  AssetSchema,
  AssetVersionsSchema,
  CollectionsSchema,
  LibrarySchema,
} from '../packages/shared/src/index.js';

test('display labels and archive workflows preserve original files and version identity', async ({
  page,
  request,
}) => {
  const directory = await mkdtemp(join(tmpdir(), 'cura-archive-ui-'));
  const originalName = '原始设定.svg';
  const original = Buffer.from(
    '<svg xmlns="http://www.w3.org/2000/svg" width="160" height="120"><rect width="160" height="120" fill="#e48242"/><circle cx="80" cy="60" r="35" fill="#223344"/></svg>',
  );
  const originalHash = createHash('sha256').update(original).digest('hex');
  let rootId = '';
  try {
    await writeFile(join(directory, originalName), original);
    const library = LibrarySchema.parse(
      await (
        await request.post('/api/libraries', {
          data: { name: 'Archive acceptance' },
        })
      ).json(),
    );
    await request.patch('/api/settings', {
      data: {
        activeLibraryId: library.id,
        language: 'en',
        theme: 'dark',
        layout: 'grid',
      },
    });
    const root = await request.post(`/api/libraries/${library.id}/roots`, {
      data: { path: directory },
    });
    expect(root.status()).toBe(201);
    rootId = ((await root.json()) as { id: string }).id;
    await expect
      .poll(
        async () =>
          AssetPageSchema.parse(
            await (
              await request.get(`/api/libraries/${library.id}/assets`)
            ).json(),
          ).total,
      )
      .toBe(1);
    const asset = AssetPageSchema.parse(
      await (await request.get(`/api/libraries/${library.id}/assets`)).json(),
    ).items[0]!;
    const versions = AssetVersionsSchema.parse(
      await (await request.get(`/api/assets/${asset.id}/versions`)).json(),
    );
    await page.goto('/');
    await page
      .getByRole('button', { name: `Select ${originalName}`, exact: true })
      .click();
    const inspector = page.getByRole('complementary', {
      name: 'Asset details',
      exact: true,
    });
    await inspector
      .getByLabel('Display name', { exact: true })
      .fill('主角设定.jpg');
    await inspector
      .getByRole('button', { name: 'Save changes', exact: true })
      .click();
    await expect(inspector.getByRole('status')).toHaveText('Saved');
    await expect(
      inspector.getByText(originalName, { exact: true }),
    ).toBeVisible();
    await expect(
      inspector.getByRole('link', { name: 'Download original', exact: true }),
    ).toHaveAttribute('download', '主角设定.svg');
    await page.getByRole('searchbox').fill('主角设定');
    const card = page.getByRole('button', {
      name: 'Select 主角设定.jpg',
      exact: true,
    });
    await expect(card).toBeVisible();
    await expect(page.locator('.asset-card')).toHaveCount(1);
    await card.click();
    await page
      .getByRole('button', { name: 'Archive selected assets', exact: true })
      .click();
    await expect(page.locator('.asset-card')).toHaveCount(0);
    expect(
      AssetSchema.parse(
        await (await request.get(`/api/assets/${asset.id}`)).json(),
      ).archivedAt,
    ).not.toBeNull();
    await page
      .getByRole('button', { name: 'Archived assets', exact: true })
      .click();
    await expect(card).toBeVisible();
    await page
      .getByRole('button', { name: 'Save search', exact: true })
      .click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('Name', { exact: true }).fill('Archived leads');
    await dialog.getByRole('button', { name: 'Create', exact: true }).click();
    await expect(dialog).not.toBeVisible();
    const collection = CollectionsSchema.parse(
      await (
        await request.get(`/api/libraries/${library.id}/collections`)
      ).json(),
    ).find((item) => item.name === 'Archived leads');
    expect(collection?.rules.archived).toBe(true);
    await page.getByRole('button', { name: 'All assets', exact: true }).click();
    await expect(page.locator('.asset-card')).toHaveCount(0);
    await page
      .getByRole('button', { name: 'Archived leads', exact: true })
      .click();
    await expect(card).toBeVisible();
    await card.click();
    await page
      .getByRole('button', { name: 'Restore from archive', exact: true })
      .click();
    await expect(page.locator('.asset-card')).toHaveCount(0);
    await page.getByRole('button', { name: 'All assets', exact: true }).click();
    await expect(card).toBeVisible();
    await card.click();
    const restored = AssetSchema.parse(
      await (await request.get(`/api/assets/${asset.id}`)).json(),
    );
    expect(restored.archivedAt).toBeNull();
    expect(restored.displayName).toBe('主角设定.jpg');
    expect(restored.name).toBe(originalName);
    expect(restored.hash).toBe(originalHash);
    expect(restored.currentVersionId).toBe(asset.currentVersionId);
    const retained = AssetVersionsSchema.parse(
      await (await request.get(`/api/assets/${asset.id}/versions`)).json(),
    );
    expect(retained.map(({ id, name, hash }) => ({ id, name, hash }))).toEqual(
      versions.map(({ id, name, hash }) => ({ id, name, hash })),
    );
    expect(await readFile(join(directory, originalName))).toEqual(original);
    expect(
      await (
        await request.get(`/api/versions/${asset.currentVersionId}/file`)
      ).body(),
    ).toEqual(original);
    await request.patch('/api/settings', {
      data: { language: 'zh-CN', theme: 'light' },
    });
    await page.reload();
    await page
      .getByRole('button', { name: '选择 主角设定.jpg', exact: true })
      .click();
    await expect(page.getByLabel('显示名称', { exact: true })).toHaveValue(
      '主角设定.jpg',
    );
    await expect(
      page.getByRole('button', { name: '已归档资产', exact: true }),
    ).toBeVisible();
    await page.screenshot({
      path: 'docs/screenshots/v0.3-catalog-archive.png',
      fullPage: true,
    });
  } finally {
    if (rootId)
      await request.delete(`/api/roots/${rootId}`).catch(() => undefined);
    await rm(directory, { recursive: true, force: true });
  }
});
