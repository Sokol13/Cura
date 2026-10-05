import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import {
  AssetPageSchema,
  LibrarySchema,
  LibraryRootSchema,
} from '../packages/shared/src/index.js';
import { writePsdFixture } from '../packages/server/test/psd-fixtures.js';

test('large registered PSDs become visible without downloading full originals to the browser', async ({
  page,
  request,
}) => {
  test.setTimeout(60_000);
  await mkdir('.tmp', { recursive: true });
  const folder = await mkdtemp(join(process.cwd(), '.tmp', 'desktop-psd-'));
  const examples = [
    {
      width: 3866,
      height: 6871,
      resources: [
        {
          id: 1036 as const,
          format: 'jpeg' as const,
          color: [230, 40, 20] as [number, number, number],
        },
      ],
    },
    {
      width: 8192,
      height: 8192,
      resources: [
        {
          id: 1033 as const,
          format: 'raw' as const,
          color: [230, 40, 20] as [number, number, number],
        },
      ],
    },
    { width: 13391, height: 7032 },
  ];
  let rootId: string | undefined;
  try {
    for (const example of examples)
      await writePsdFixture(
        join(folder, `${example.width}x${example.height}.psd`),
        example,
      );
    const library = LibrarySchema.parse(
      await (
        await request.post('/api/libraries', {
          data: { name: 'Large PSD desktop regression' },
        })
      ).json(),
    );
    await request.patch('/api/settings', {
      data: { activeLibraryId: library.id, language: 'en' },
    });
    const fullDownloads: string[] = [];
    await page.route('**/api/versions/*/file**', async (route) => {
      fullDownloads.push(route.request().url());
      await route.abort();
    });
    await page.goto('/');
    const root = LibraryRootSchema.parse(
      await (
        await request.post(`/api/libraries/${library.id}/roots`, {
          data: { path: folder },
        })
      ).json(),
    );
    rootId = root.id;
    await expect
      .poll(
        async () =>
          AssetPageSchema.parse(
            await (
              await request.get(`/api/libraries/${library.id}/assets`)
            ).json(),
          ).items.filter((a) => a.previewState === 'ready').length,
        { timeout: 30_000 },
      )
      .toBe(3);
    const assets = AssetPageSchema.parse(
      await (await request.get(`/api/libraries/${library.id}/assets`)).json(),
    ).items;
    for (const example of examples) {
      const name = `${example.width}x${example.height}.psd`;
      expect(assets.find((a) => a.name === name)).toMatchObject({
        width: example.width,
        height: example.height,
        previewState: 'ready',
        previewError: null,
      });
      const card = page.getByRole('button', {
        name: `Select ${name}`,
        exact: true,
      });
      await expect(card).toBeVisible();
      await expect
        .poll(() =>
          card
            .locator('img')
            .evaluate(
              (img: HTMLImageElement) => img.complete && img.naturalWidth > 0,
            ),
        )
        .toBe(true);
    }
    for (const endpoint of ['clear', 'rebuild']) {
      expect((await request.post(`/api/cache/${endpoint}`)).ok()).toBe(true);
      expect(
        (await request.get(`/api/libraries/${library.id}/previews`)).ok(),
      ).toBe(true);
      await expect
        .poll(
          async () =>
            AssetPageSchema.parse(
              await (
                await request.get(`/api/libraries/${library.id}/assets`)
              ).json(),
            ).items.filter((a) => a.previewState === 'ready').length,
        )
        .toBe(3);
    }
    expect(fullDownloads).toEqual([]);
    await page.screenshot({
      path: 'docs/screenshots/v0.3.1-large-psd.png',
      fullPage: true,
    });
  } finally {
    if (rootId) await request.delete(`/api/roots/${rootId}`);
    await rm(folder, { recursive: true, force: true });
  }
});
