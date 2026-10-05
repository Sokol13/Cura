/// <reference lib="dom" />
/// <reference lib="dom.asynciterable" />
import { createHash } from 'node:crypto';
import {
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  rm,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test as base } from '@playwright/test';
import {
  AssetPageSchema,
  LibraryRootsSchema,
} from '../packages/shared/dist/index.js';

// A fresh real server makes the no-library state independent of suite order.
const test = base.extend({
  // eslint-disable-next-line no-empty-pattern
  baseURL: async ({}, use) => {
    // Resolve built runtime modules only during E2E, so clean type checks need
    // no server build artifacts. Type information still comes from source.
    const { createApp } = (await import(
      new URL('../packages/server/dist/app.js', import.meta.url).href
    )) as typeof import('../packages/server/src/app.js');
    const { openDatabase } = (await import(
      new URL('../packages/server/dist/database.js', import.meta.url).href
    )) as typeof import('../packages/server/src/database.js');
    const directory = await mkdtemp(join(tmpdir(), 'cura-onboarding-server-'));
    const paths = {
      data: join(directory, 'data'),
      cache: join(directory, 'cache'),
      log: join(directory, 'log'),
    };
    const database = openDatabase(paths);
    const app = await createApp({
      database,
      paths,
      onClose: () => database.close(),
    });
    try {
      await use(await app.listen({ host: '127.0.0.1', port: 0 }));
    } finally {
      await app.close();
      await rm(directory, { recursive: true, force: true });
    }
  },
});

const sha256 = (bytes: Buffer) =>
  createHash('sha256').update(bytes).digest('hex');
const artwork = Buffer.from(
  '<svg xmlns="http://www.w3.org/2000/svg" width="240" height="160"><rect width="240" height="160" fill="#e37f51"/><circle cx="120" cy="80" r="45" fill="#25465f"/></svg>',
);

test('Chinese folder-first onboarding registers nested originals through the directory browser', async ({
  page,
  request,
}) => {
  const directory = await mkdtemp(join(tmpdir(), 'cura-onboarding-originals-'));
  const root = join(directory, '中文素材');
  const nested = join(root, '场景甲');
  const original = join(nested, '晨光参考.svg');
  await mkdir(nested, { recursive: true });
  await writeFile(original, artwork);
  const originalHash = sha256(await readFile(original));
  try {
    await page.goto('/');
    await expect(
      page.getByRole('heading', {
        name: '为每一次创作，保留来路。',
        exact: true,
      }),
    ).toBeVisible();
    await expect(
      page.getByRole('button', { name: '登记本机文件夹', exact: true }),
    ).toHaveCount(0);
    await expect(
      page
        .getByRole('button', { name: '导入文件', exact: true })
        .and(page.locator('button')),
    ).toBeDisabled();
    await page.getByRole('button', { name: /创建第一个资产库/ }).click();
    const creation = page.getByRole('dialog', {
      name: '新建资产库',
      exact: true,
    });
    await creation.getByLabel('名称', { exact: true }).fill('本机创作素材');
    await creation.getByRole('button', { name: '创建', exact: true }).click();
    await expect(creation).not.toBeVisible();
    const librarySelect = page.getByRole('combobox', {
      name: '资产库',
      exact: true,
    });
    await expect(librarySelect).not.toHaveValue('');
    const libraryId = await librarySelect.inputValue();
    const empty = page.locator('.catalog-main .empty-state');
    const register = empty.getByRole('button', {
      name: '登记本机文件夹',
      exact: true,
    });
    const upload = empty.getByRole('button', { name: '导入文件', exact: true });
    await expect(register).toBeVisible();
    await expect(upload).toBeVisible();
    await expect(
      empty.getByText(
        '登记文件夹时原文件保持原位，导入文件时会复制到资产库收件箱。',
        { exact: true },
      ),
    ).toBeVisible();
    await register.focus();
    await page.keyboard.press('Tab');
    await expect(upload).toBeFocused();
    await page.keyboard.press('Shift+Tab');
    await expect(register).toBeFocused();
    await page.screenshot({
      path: 'docs/screenshots/v0.4.0-folder-onboarding-zh.png',
      fullPage: true,
    });
    await page.keyboard.press('Enter');
    const browser = page.getByRole('dialog', { name: '登记目录', exact: true });
    await expect(browser).toBeVisible();
    const directoryPath = browser.getByLabel('目录路径', { exact: true });
    await directoryPath.fill(directory);
    await directoryPath.press('Enter');
    const child = browser.getByRole('button', {
      name: '中文素材',
      exact: true,
    });
    await child.focus();
    await child.press('Enter');
    await expect(directoryPath).toHaveValue(root);
    const registered = page.waitForResponse(
      (response) =>
        response.url().endsWith(`/api/libraries/${libraryId}/roots`) &&
        response.request().method() === 'POST',
    );
    await browser
      .getByRole('button', { name: '登记目录', exact: true })
      .press('Enter');
    expect((await registered).ok()).toBe(true);
    await expect(browser).not.toBeVisible();
    await expect(
      page.getByRole('button', { name: '选择 晨光参考.svg', exact: true }),
    ).toBeVisible({ timeout: 15_000 });
    const assets = AssetPageSchema.parse(
      await (await request.get(`/api/libraries/${libraryId}/assets`)).json(),
    );
    expect(assets.total).toBe(1);
    expect(assets.items[0]).toMatchObject({
      hash: originalHash,
      relativePath: '场景甲/晨光参考.svg',
    });
    const roots = LibraryRootsSchema.parse(
      await (await request.get(`/api/libraries/${libraryId}/roots`)).json(),
    );
    expect(roots).toHaveLength(1);
    expect(roots[0]).toMatchObject({ path: root, kind: 'reference' });
    expect(sha256(await readFile(original))).toBe(originalHash);
    expect(await readdir(root)).toEqual(['场景甲']);
    expect(await readdir(nested)).toEqual(['晨光参考.svg']);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('English onboarding keeps empty filters distinct and imports through the keyboard file chooser', async ({
  page,
  request,
}) => {
  const directory = await mkdtemp(join(tmpdir(), 'cura-onboarding-upload-'));
  const original = join(directory, '上传副本.svg');
  await writeFile(original, artwork);
  try {
    expect(
      (
        await request.patch('/api/settings', {
          data: { language: 'en', theme: 'dark' },
        })
      ).ok(),
    ).toBe(true);
    await page.goto('/');
    await expect(
      page.getByRole('heading', {
        name: 'A home for your creative work.',
        exact: true,
      }),
    ).toBeVisible();
    await expect(
      page.getByRole('button', { name: 'Register local folder', exact: true }),
    ).toHaveCount(0);
    await expect(
      page
        .getByRole('button', { name: 'Import files', exact: true })
        .and(page.locator('button')),
    ).toBeDisabled();
    await page
      .getByRole('button', { name: /Create your first library/ })
      .click();
    const creation = page.getByRole('dialog', {
      name: 'New library',
      exact: true,
    });
    await creation.getByLabel('Name', { exact: true }).fill('First uploads');
    await creation.getByRole('button', { name: 'Create', exact: true }).click();
    await expect(creation).not.toBeVisible();
    const librarySelect = page.getByRole('combobox', {
      name: 'Library',
      exact: true,
    });
    await expect(librarySelect).not.toHaveValue('');
    const libraryId = await librarySelect.inputValue();
    const empty = page.locator('.catalog-main .empty-state');
    const register = empty.getByRole('button', {
      name: 'Register local folder',
      exact: true,
    });
    const upload = empty.getByRole('button', {
      name: 'Import files',
      exact: true,
    });
    await expect(register).toBeVisible();
    await expect(upload).toBeVisible();
    await expect(
      empty.getByText(
        'Registering a folder keeps originals in place; importing files copies them to your library Inbox.',
        { exact: true },
      ),
    ).toBeVisible();
    await page
      .getByRole('searchbox', { name: 'Search assets', exact: true })
      .fill('no-such-reference');
    await expect(
      empty.getByRole('heading', { name: 'No matching assets', exact: true }),
    ).toBeVisible();
    await expect(register).toHaveCount(0);
    await expect(upload).toHaveCount(0);
    await empty
      .getByRole('button', { name: 'Clear filters', exact: true })
      .click();
    await expect(register).toBeVisible();
    for (const [navigation, heading] of [
      ['Trash', 'The trash is empty'],
      ['Archived assets', 'No archived assets'],
    ] as const) {
      await page.getByRole('button', { name: navigation, exact: true }).click();
      await expect(
        empty.getByRole('heading', { name: heading, exact: true }),
      ).toBeVisible();
      await expect(register).toHaveCount(0);
      await expect(upload).toHaveCount(0);
    }
    await page.getByRole('button', { name: 'All assets', exact: true }).click();
    await expect(register).toBeVisible();
    await register.focus();
    await page.keyboard.press('Enter');
    const browser = page.getByRole('dialog', {
      name: 'Register directory',
      exact: true,
    });
    await expect(browser).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(browser).not.toBeVisible();
    await expect(register).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(upload).toBeFocused();
    await page.screenshot({
      path: 'docs/screenshots/v0.4.0-folder-onboarding-en.png',
      fullPage: true,
    });
    const chooser = page.waitForEvent('filechooser');
    await page.keyboard.press('Enter');
    await (await chooser).setFiles(original);
    await expect(
      page.getByRole('button', { name: 'Select 上传副本.svg', exact: true }),
    ).toBeVisible({ timeout: 15_000 });
    const assets = AssetPageSchema.parse(
      await (await request.get(`/api/libraries/${libraryId}/assets`)).json(),
    );
    expect(assets.total).toBe(1);
    const asset = assets.items[0];
    expect(asset).toBeDefined();
    if (!asset) throw new Error('Uploaded asset missing');
    expect(asset.hash).toBe(sha256(artwork));
    const roots = LibraryRootsSchema.parse(
      await (await request.get(`/api/libraries/${libraryId}/roots`)).json(),
    );
    expect(roots).toHaveLength(1);
    const inbox = roots[0];
    expect(inbox).toMatchObject({ id: asset.rootId, kind: 'inbox' });
    if (!inbox) throw new Error('Inbox root missing');
    expect(await readFile(join(inbox.path, asset.relativePath))).toEqual(
      artwork,
    );
    expect(await readFile(original)).toEqual(artwork);
    expect(inbox.path).not.toBe(directory);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
