/// <reference lib="dom" />
import { createRequire } from 'node:module';
import { expect, test } from '@playwright/test';
import {
  AssetPageSchema,
  LibrarySchema,
} from '../packages/shared/src/index.js';

type RasterFormat = 'png' | 'jpeg' | 'webp' | 'gif' | 'avif';
type Encoder = {
  toFormat: (format: RasterFormat) => Encoder;
  toBuffer: () => Promise<Buffer>;
};
const sharp = createRequire(
  new URL('../packages/server/package.json', import.meta.url),
)('sharp') as (input: Buffer) => Encoder;
const drawing = Buffer.from(
  '<svg xmlns="http://www.w3.org/2000/svg" width="256" height="192"><rect width="256" height="192" fill="#b33552"/><circle cx="180" cy="70" r="40" fill="#afcd5f"/><rect x="0" y="140" width="256" height="52" fill="#2c74c2"/></svg>',
);

test('all six P0 image formats upload, retain their bytes and render meaningful previews offline', async ({
  page,
  request,
  context,
}, testInfo) => {
  test.setTimeout(90_000);
  const attemptedExternalRequests: string[] = [];
  const local = (url: string) =>
    ['127.0.0.1', 'localhost', '[::1]'].includes(new URL(url).hostname);
  await context.route('**/*', async (route) => {
    if (local(route.request().url())) await route.continue();
    else {
      attemptedExternalRequests.push(route.request().url());
      await route.abort();
    }
  });
  await context.routeWebSocket('**/*', (socket) => {
    if (local(socket.url())) socket.connectToServer();
    else {
      attemptedExternalRequests.push(socket.url());
      socket.close();
    }
  });
  const results: Record<string, unknown>[] = [];
  try {
    const response = await request.post('/api/libraries', {
      data: { name: 'Six-format acceptance' },
    });
    expect(response.status()).toBe(201);
    const library = LibrarySchema.parse(await response.json());
    const settings = await request.patch('/api/settings', {
      data: { activeLibraryId: library.id, language: 'en', layout: 'grid' },
    });
    expect(settings.ok()).toBe(true);
    const fixtures = await Promise.all(
      (['png', 'jpeg', 'webp', 'gif', 'avif', 'svg'] as const).map(
        async (format) => ({
          name: `acceptance-format.${format}`,
          mimeType: format === 'svg' ? 'image/svg+xml' : `image/${format}`,
          buffer:
            format === 'svg'
              ? drawing
              : await sharp(drawing).toFormat(format).toBuffer(),
        }),
      ),
    );
    await page.goto('/');
    await page
      .getByLabel('Import files', { exact: true })
      .and(page.locator('input[type="file"]'))
      .setInputFiles(fixtures);
    await expect(page.getByText('6 assets', { exact: true })).toBeVisible({
      timeout: 30_000,
    });
    const catalogResponse = await request.get(
      `/api/libraries/${library.id}/assets`,
    );
    expect(catalogResponse.status()).toBe(200);
    const catalog = AssetPageSchema.parse(await catalogResponse.json());
    expect(catalog.total).toBe(6);
    expect(new Set(catalog.items.map((asset) => asset.hash)).size).toBe(6);
    for (const fixture of fixtures) {
      await test.step(`${fixture.mimeType} original, thumbnail and browser preview`, async () => {
        const asset = catalog.items.find(
          (candidate) => candidate.name === fixture.name,
        );
        expect(asset).toBeDefined();
        if (!asset) throw new Error(`Missing imported ${fixture.name}`);
        expect(asset.type).toBe(fixture.mimeType);
        expect([asset.width, asset.height]).toEqual([256, 192]);
        const original = await request.get(
          `/api/versions/${asset.currentVersionId}/file`,
        );
        expect(original.status()).toBe(200);
        expect(original.headers()['content-type']).toContain(fixture.mimeType);
        expect(await original.body()).toEqual(fixture.buffer);
        if (fixture.mimeType === 'image/svg+xml')
          expect(original.headers()['content-disposition']).toContain(
            'attachment',
          );
        const card = page.getByRole('button', {
          name: `Select ${fixture.name}`,
          exact: true,
        });
        await card.scrollIntoViewIfNeeded();
        const thumbnail = await card
          .locator('img')
          .evaluate(async (element) => {
            const image = element as HTMLImageElement;
            await image.decode();
            return { width: image.naturalWidth, height: image.naturalHeight };
          });
        expect([thumbnail.width, thumbnail.height]).toEqual([256, 192]);
        await card.dblclick();
        const dialog = page.getByRole('dialog', { name: 'Asset preview' });
        const image = dialog.getByRole('img', { name: `${fixture.name} — V1` });
        await expect(image).toBeVisible();
        await expect(image).toHaveAttribute(
          'src',
          fixture.mimeType === 'image/svg+xml' ? /\/thumbnail$/ : /\/file$/,
        );
        const pixels = await image.evaluate(async (element) => {
          const image = element as HTMLImageElement;
          await image.decode();
          const canvas = document.createElement('canvas');
          canvas.width = image.naturalWidth;
          canvas.height = image.naturalHeight;
          const drawing = canvas.getContext('2d');
          if (!drawing) throw new Error('Canvas rendering is unavailable');
          drawing.drawImage(image, 0, 0);
          return {
            width: image.naturalWidth,
            height: image.naturalHeight,
            samples: [
              [16, 16],
              [180, 70],
              [60, 170],
            ].map(([x, y]) =>
              Array.from(drawing.getImageData(x!, y!, 1, 1).data).slice(0, 3),
            ),
          };
        });
        expect([pixels.width, pixels.height]).toEqual([256, 192]);
        const expectedColors = [
          [179, 53, 82],
          [175, 205, 95],
          [44, 116, 194],
        ];
        pixels.samples.forEach((rgb, index) =>
          rgb.forEach((channel, component) =>
            expect(
              Math.abs(channel - expectedColors[index]![component]!),
            ).toBeLessThan(20),
          ),
        );
        results.push({
          format: fixture.mimeType,
          originalBytes: fixture.buffer.length,
          thumbnail,
          preview: pixels,
        });
        await dialog
          .getByRole('button', { name: 'Close preview', exact: true })
          .click();
      });
    }
    expect(attemptedExternalRequests).toEqual([]);
  } finally {
    await testInfo.attach('p0-six-format-evidence.json', {
      body: JSON.stringify(
        {
          environment: 'Linux headless Chromium',
          results,
          attemptedExternalRequests,
        },
        null,
        2,
      ),
      contentType: 'application/json',
    });
  }
});
