import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import {
  AssetPageSchema,
  AssetSchema,
  AssetVersionsSchema,
  LibrarySchema,
  LibraryRootSchema,
} from '../packages/shared/src/index.js';

test('root removal defaults to recoverable Trash, retains history and offers explicit offline cleanup', async ({
  page,
  request,
}) => {
  const folder = await mkdtemp(join(tmpdir(), 'cura-root-removal-'));
  const original = Buffer.from(
    '<svg xmlns="http://www.w3.org/2000/svg" width="60" height="40"><rect width="60" height="40" fill="red"/></svg>',
  );
  const next = Buffer.from(original.toString().replace('red', 'blue'));
  const file = join(folder, '原始设计.svg');
  await writeFile(file, original);
  let rootId: string | undefined;
  try {
    const library = LibrarySchema.parse(
      await (
        await request.post('/api/libraries', {
          data: { name: 'Directory removal policies' },
        })
      ).json(),
    );
    await request.patch('/api/settings', {
      data: { language: 'en', theme: 'dark', activeLibraryId: library.id },
    });
    const register = async () =>
      LibraryRootSchema.parse(
        await (
          await request.post(`/api/libraries/${library.id}/roots`, {
            data: { path: folder },
          })
        ).json(),
      );
    const assets = async (query = '') =>
      AssetPageSchema.parse(
        await (
          await request.get(`/api/libraries/${library.id}/assets${query}`)
        ).json(),
      );
    const root = await register();
    rootId = root.id;
    await expect.poll(async () => (await assets()).total).toBe(1);
    const asset = (await assets()).items[0]!;
    const replaced = AssetSchema.parse(
      await (
        await request.post(
          `/api/assets/${asset.id}/replace?name=replacement.svg`,
          {
            headers: { 'content-type': 'application/octet-stream' },
            data: next,
          },
        )
      ).json(),
    );
    await request.patch(`/api/assets/${asset.id}`, {
      data: { note: '保留的项目历史', rating: 5 },
    });
    await page.goto('/');
    await page
      .getByRole('button', { name: 'Unregister directory', exact: true })
      .click();
    const dialog = page.getByRole('dialog', {
      name: 'Unregister directory',
      exact: true,
    });
    await expect(
      dialog.getByRole('radio', {
        name: 'Also remove these assets (move to Trash; recoverable)',
        exact: true,
      }),
    ).toBeChecked();
    await expect(
      dialog.getByRole('radio', {
        name: 'Only stop watching (keep history; mark assets offline)',
        exact: true,
      }),
    ).not.toBeChecked();
    await page.screenshot({
      path: 'docs/screenshots/v0.3.1-root-removal.png',
      fullPage: true,
    });
    await dialog
      .getByRole('button', { name: 'Unregister directory', exact: true })
      .click();
    rootId = undefined;
    await expect.poll(async () => (await assets()).total).toBe(0);
    await page.getByRole('button', { name: 'Trash', exact: true }).click();
    const card = page.getByRole('button', {
      name: 'Select replacement.svg',
      exact: true,
    });
    await expect(card).toBeVisible();
    await card.click();
    await page.getByRole('button', { name: 'Restore', exact: true }).click();
    await page.getByRole('button', { name: 'All assets', exact: true }).click();
    await expect(card).toBeVisible();
    expect(
      AssetSchema.parse(
        await (await request.get(`/api/assets/${asset.id}`)).json(),
      ),
    ).toMatchObject({
      id: asset.id,
      missing: true,
      deletedAt: null,
      hash: replaced.hash,
      note: '保留的项目历史',
      rating: 5,
    });
    await request.post(`/api/libraries/${library.id}/upload?name=online.svg`, {
      headers: { 'content-type': 'application/octet-stream' },
      data: Buffer.from(original.toString().replace('red', 'green')),
    });
    await page.getByRole('button', { name: 'Filters', exact: true }).click();
    await page
      .getByRole('combobox', { name: 'Source availability', exact: true })
      .selectOption('missing');
    await expect(page.locator('.asset-card')).toHaveCount(1);
    await expect(card).toBeVisible();
    expect((await assets('?missing=false')).total).toBe(1);
    const reopened = await register();
    rootId = reopened.id;
    expect(rootId).toBe(root.id);
    await expect
      .poll(async () => (await assets('?missing=true')).total)
      .toBe(0);
    expect(
      AssetSchema.parse(
        await (await request.get(`/api/assets/${asset.id}`)).json(),
      ),
    ).toMatchObject({
      id: asset.id,
      missing: false,
      currentVersionId: replaced.currentVersionId,
      hash: replaced.hash,
    });
    await page.reload();
    await page.getByRole('button', { name: 'All assets', exact: true }).click();
    await page
      .getByRole('button', { name: 'Unregister directory', exact: true })
      .click();
    await dialog
      .getByRole('radio', {
        name: 'Only stop watching (keep history; mark assets offline)',
        exact: true,
      })
      .check();
    await dialog
      .getByRole('button', { name: 'Unregister directory', exact: true })
      .click();
    rootId = undefined;
    await expect
      .poll(async () => (await assets('?missing=true')).total)
      .toBe(1);
    expect((await assets('?trash=true')).total).toBe(0);
    expect((await assets()).total).toBe(2);
    expect(
      AssetVersionsSchema.parse(
        await (await request.get(`/api/assets/${asset.id}/versions`)).json(),
      ),
    ).toHaveLength(2);
    expect(await readFile(file)).toEqual(original);
    expect(
      await (
        await request.get(`/api/versions/${replaced.currentVersionId}/file`)
      ).body(),
    ).toEqual(next);
  } finally {
    if (rootId) await request.delete(`/api/roots/${rootId}`);
    await rm(folder, { recursive: true, force: true });
  }
});
