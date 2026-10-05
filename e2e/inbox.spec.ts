/// <reference lib="dom" />
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import {
  AssetPageSchema,
  AssetVersionsSchema,
  LibraryRootsSchema,
  LibrarySchema,
} from '../packages/shared/dist/index.js';

const localDay = (date: Date) =>
  [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0'),
  ].join('-');
const artwork = (color: string) =>
  Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="320" height="240"><rect width="320" height="240" fill="${color}"/><circle cx="160" cy="120" r="72" fill="#ffe4bf"/></svg>`,
  );

test('native uploads display readable dated Chinese paths and retain same-name files independently', async ({
  page,
  request,
}) => {
  const directory = await mkdtemp(join(tmpdir(), 'cura-dated-inbox-browser-'));
  const originalPaths = [
    join(directory, 'first', '中文灵感.svg'),
    join(directory, 'second', '中文灵感.svg'),
  ];
  const originals = [artwork('#be633b'), artwork('#305473')];
  for (const [index, file] of originalPaths.entries()) {
    await mkdir(join(directory, index === 0 ? 'first' : 'second'));
    await writeFile(file, originals[index]!);
  }
  try {
    const created = await request.post('/api/libraries', {
      data: { name: 'Readable Inbox acceptance' },
    });
    expect(created.status()).toBe(201);
    const library = LibrarySchema.parse(await created.json());
    expect(
      (
        await request.patch('/api/settings', {
          data: {
            language: 'en',
            activeLibraryId: library.id,
            theme: 'dark',
            layout: 'grid',
          },
        })
      ).ok(),
    ).toBe(true);
    await page.goto('/');
    await expect(
      page.getByRole('heading', { name: library.name, exact: true }),
    ).toBeVisible();
    const upload = async (file: string) => {
      const chooser = page.waitForEvent('filechooser');
      await page
        .getByRole('button', { name: 'Import files', exact: true })
        .and(page.locator('button'))
        .first()
        .click();
      const response = page.waitForResponse(
        (result) =>
          new URL(result.url()).pathname ===
            `/api/libraries/${library.id}/upload` &&
          result.request().method() === 'POST',
      );
      await (await chooser).setFiles(file);
      const uploaded = await response;
      expect(uploaded.status()).toBe(201);
      const expectedHash = createHash('sha256')
        .update(await readFile(file))
        .digest('hex');
      const catalog = AssetPageSchema.parse(
        await (await request.get(`/api/libraries/${library.id}/assets`)).json(),
      );
      const asset = catalog.items.find((item) => item.hash === expectedHash);
      if (!asset) throw new Error('Uploaded bytes were not cataloged');
      return asset;
    };
    const before = localDay(new Date());
    const first = await upload(originalPaths[0]!);
    const day = first.relativePath.split('/')[0];
    expect([before, localDay(new Date())]).toContain(day);
    expect(first.relativePath).toBe(`${day}/中文灵感.svg`);
    await page
      .getByRole('button', { name: `Select ${first.name}`, exact: true })
      .click();
    const inspector = page.getByRole('complementary', {
      name: 'Asset details',
      exact: true,
    });
    await expect(
      inspector.getByText(first.relativePath, { exact: true }),
    ).toBeVisible();
    const secondBefore = localDay(new Date());
    const second = await upload(originalPaths[1]!);
    expect(second.id).not.toBe(first.id);
    expect([secondBefore, localDay(new Date())]).toContain(
      second.relativePath.split('/')[0],
    );
    expect(second.relativePath.split('/')[1]).toMatch(
      /^中文灵感-[a-f\d]{8}\.svg$/,
    );
    await page
      .getByRole('button', { name: `Select ${second.name}`, exact: true })
      .click();
    await expect(
      inspector.getByText(second.relativePath, { exact: true }),
    ).toBeVisible();
    const catalog = AssetPageSchema.parse(
      await (await request.get(`/api/libraries/${library.id}/assets`)).json(),
    );
    expect(catalog.items.map((asset) => asset.id).sort()).toEqual(
      [first.id, second.id].sort(),
    );
    const roots = LibraryRootsSchema.parse(
      await (await request.get(`/api/libraries/${library.id}/roots`)).json(),
    );
    const inbox = roots.find((root) => root.kind === 'inbox');
    if (!inbox) throw new Error('Uploaded Inbox root missing');
    for (const [index, asset] of [first, second].entries()) {
      const bytes = originals[index]!;
      expect(asset.hash).toBe(createHash('sha256').update(bytes).digest('hex'));
      expect(await readFile(join(inbox.path, asset.relativePath))).toEqual(
        bytes,
      );
      expect(await readFile(originalPaths[index]!)).toEqual(bytes);
      expect(
        await (
          await request.get(`/api/versions/${asset.currentVersionId}/file`)
        ).body(),
      ).toEqual(bytes);
      expect(
        AssetVersionsSchema.parse(
          await (await request.get(`/api/assets/${asset.id}/versions`)).json(),
        ),
      ).toHaveLength(1);
    }
    await page.screenshot({
      path: 'docs/screenshots/v0.4.0-dated-inbox.png',
      fullPage: true,
    });
    await page.reload();
    await expect(
      page.getByRole('button', { name: `Select ${first.name}`, exact: true }),
    ).toBeVisible();
    await page
      .getByRole('button', { name: `Select ${second.name}`, exact: true })
      .click();
    await expect(
      inspector.getByText(second.relativePath, { exact: true }),
    ).toBeVisible();
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
