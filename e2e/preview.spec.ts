import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { deflateSync } from 'node:zlib';
import { expect, test, type BrowserContext } from '@playwright/test';
import {
  AnnotationsSchema,
  AssetPageSchema,
  AssetVersionsSchema,
  LibrarySchema,
} from '../packages/shared/src/index.js';

function pngChunk(type: string, bytes: Buffer): Buffer {
  const chunk = Buffer.concat([Buffer.from(type), bytes]);
  let crc = 0xffffffff;
  for (const byte of chunk) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) {
      crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
    }
  }
  const length = Buffer.alloc(4);
  length.writeUInt32BE(bytes.length);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE((crc ^ 0xffffffff) >>> 0);
  return Buffer.concat([length, chunk, checksum]);
}

function previewFixture(red: number): Buffer {
  const width = 1200;
  const height = 800;
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 2;
  const pixels = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const offset = y * (width * 3 + 1) + 1 + x * 3;
      pixels[offset] = red;
      pixels[offset + 1] = Math.round((x / width) * 200);
      pixels[offset + 2] = Math.round((y / height) * 200);
    }
  }
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk('IHDR', header),
    pngChunk('IDAT', deflateSync(pixels)),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

async function blockExternalRequests(
  context: BrowserContext,
): Promise<string[]> {
  const attempts: string[] = [];
  const local = (url: string) =>
    ['127.0.0.1', 'localhost', '[::1]'].includes(new URL(url).hostname);
  await context.route('**/*', async (route) => {
    if (local(route.request().url())) await route.continue();
    else {
      attempts.push(route.request().url());
      await route.abort();
    }
  });
  await context.routeWebSocket('**/*', (socket) => {
    if (local(socket.url())) socket.connectToServer();
    else {
      attempts.push(socket.url());
      socket.close();
    }
  });
  return attempts;
}

test.use({ viewport: { width: 1440, height: 1000 } });

test('offline preview persists image notes and compares immutable replacement versions', async ({
  page,
  request,
  context,
}) => {
  const externalRequests = await blockExternalRequests(context);
  const create = await request.post('/api/libraries', {
    data: { name: 'Preview acceptance' },
  });
  expect(create.ok()).toBe(true);
  const library = LibrarySchema.parse(await create.json());
  expect(
    (
      await request.patch('/api/settings', {
        data: { activeLibraryId: library.id, language: 'en', theme: 'dark' },
      })
    ).ok(),
  ).toBe(true);
  const original = previewFixture(70);
  const replacement = previewFixture(210);
  await page.goto('/');
  await page
    .getByLabel('Import files', { exact: true })
    .and(page.locator('input[type="file"]'))
    .setInputFiles({
      name: 'preview-original.png',
      mimeType: 'image/png',
      buffer: original,
    });
  const card = page.getByRole('button', {
    name: 'Select preview-original.png',
    exact: true,
  });
  await expect(card).toBeVisible({ timeout: 15_000 });
  await card.dblclick();
  const dialog = page.getByRole('dialog', { name: 'Asset preview' });
  await expect(dialog).toBeVisible();
  const image = dialog.getByRole('img', { name: 'preview-original.png — V1' });
  await expect(image).toBeVisible();
  await expect
    .poll(async () =>
      image.evaluate((element) => Number(Reflect.get(element, 'naturalWidth'))),
    )
    .toBe(1200);
  const beforeZoom = Number(
    await dialog.getByRole('slider', { name: 'Zoom' }).inputValue(),
  );
  await dialog.getByRole('button', { name: 'Zoom in', exact: true }).click();
  expect(
    Number(await dialog.getByRole('slider', { name: 'Zoom' }).inputValue()),
  ).toBeGreaterThan(beforeZoom);
  await dialog.getByRole('button', { name: 'Fit image', exact: true }).click();
  const bounds = await image.boundingBox();
  expect(bounds).not.toBeNull();
  await dialog
    .getByRole('button', { name: 'Add annotation', exact: true })
    .click();
  await image.click({
    position: { x: bounds!.width * 0.25, y: bounds!.height * 0.6 },
  });
  const noteInput = dialog.getByRole('textbox', { name: 'Annotation text' });
  await expect(noteInput).toBeFocused();
  await noteInput.fill('Adjust shadow edge');
  await noteInput.press('Escape');
  await expect(dialog).toBeVisible();
  await dialog
    .getByRole('button', { name: 'Save annotation', exact: true })
    .click();
  await expect(
    dialog.getByRole('button', {
      name: 'Annotation 1: Adjust shadow edge',
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    dialog.getByText('Adjust shadow edge', { exact: true }),
  ).toBeVisible();
  const catalog = AssetPageSchema.parse(
    await (await request.get(`/api/libraries/${library.id}/assets`)).json(),
  );
  const asset = catalog.items[0]!;
  const notes = AnnotationsSchema.parse(
    await (await request.get(`/api/assets/${asset.id}/annotations`)).json(),
  );
  expect(notes).toHaveLength(1);
  expect(notes[0]!.versionId).toBe(asset.currentVersionId);
  expect(notes[0]!.x).toBeCloseTo(0.25, 2);
  expect(notes[0]!.y).toBeCloseTo(0.6, 2);
  await dialog
    .getByRole('button', { name: 'Edit annotation 1', exact: true })
    .click();
  await expect(noteInput).toHaveValue('Adjust shadow edge');
  await noteInput.fill('Keep the revised shadow edge');
  await dialog
    .getByRole('button', { name: 'Save annotation', exact: true })
    .click();
  await expect(
    dialog.getByRole('button', {
      name: 'Annotation 1: Keep the revised shadow edge',
      exact: true,
    }),
  ).toBeVisible();
  const editedNotes = AnnotationsSchema.parse(
    await (await request.get(`/api/assets/${asset.id}/annotations`)).json(),
  );
  expect(editedNotes).toHaveLength(1);
  expect(editedNotes[0]).toMatchObject({
    id: notes[0]!.id,
    versionId: notes[0]!.versionId,
    x: notes[0]!.x,
    y: notes[0]!.y,
    text: 'Keep the revised shadow edge',
  });

  await dialog.getByLabel('Replace file', { exact: true }).setInputFiles({
    name: 'preview-replacement.png',
    mimeType: 'image/png',
    buffer: replacement,
  });
  await expect(dialog.getByRole('button', { name: /View V2:/ })).toBeVisible({
    timeout: 15_000,
  });
  await expect(
    dialog.getByRole('img', { name: 'preview-replacement.png — V2' }),
  ).toBeVisible();
  await expect(
    dialog.getByText('Keep the revised shadow edge', { exact: true }),
  ).toHaveCount(0);
  await dialog
    .getByRole('button', { name: 'Compare versions', exact: true })
    .click();
  await expect(dialog.getByRole('img')).toHaveCount(2);
  const history = AssetVersionsSchema.parse(
    await (await request.get(`/api/assets/${asset.id}/versions`)).json(),
  );
  expect(history).toHaveLength(2);
  const first = history.find((version) => version.ordinal === 1)!;
  const second = history.find((version) => version.ordinal === 2)!;
  await expect(
    dialog.getByRole('combobox', { name: 'Left version' }),
  ).toHaveValue(first.id);
  await expect(
    dialog.getByRole('combobox', { name: 'Right version' }),
  ).toHaveValue(second.id);
  await expect(
    dialog.getByRole('img', { name: 'preview-original.png — V1' }),
  ).toHaveAttribute('src', `/api/versions/${first.id}/file`);
  await expect(
    dialog.getByRole('img', { name: 'preview-replacement.png — V2' }),
  ).toHaveAttribute('src', `/api/versions/${second.id}/file`);
  expect(
    await (await request.get(`/api/versions/${first.id}/file`)).body(),
  ).toEqual(original);
  expect(
    await (await request.get(`/api/versions/${second.id}/file`)).body(),
  ).toEqual(replacement);
  await mkdir('docs/screenshots', { recursive: true });
  await page.screenshot({ path: 'docs/screenshots/preview-compare.png' });

  await page.reload();
  await page
    .getByRole('button', { name: /Select preview-(original|replacement)\.png/ })
    .dblclick();
  await dialog.getByRole('button', { name: /View V1:/ }).click();
  await expect(
    dialog.getByText('Keep the revised shadow edge', { exact: true }),
  ).toBeVisible();
  await expect(
    dialog.getByRole('button', {
      name: 'Annotation 1: Keep the revised shadow edge',
    }),
  ).toBeVisible();
  await page.screenshot({ path: 'docs/screenshots/preview-annotation.png' });
  await dialog
    .getByRole('button', { name: 'Delete annotation 1', exact: true })
    .click();
  await expect(
    dialog.getByText('Keep the revised shadow edge', { exact: true }),
  ).toHaveCount(0);
  expect(
    AnnotationsSchema.parse(
      await (await request.get(`/api/assets/${asset.id}/annotations`)).json(),
    ),
  ).toHaveLength(0);
  await dialog
    .getByRole('button', { name: 'Close preview', exact: true })
    .focus();
  await page.keyboard.press('Escape');
  await expect(dialog).not.toBeVisible();
  expect(externalRequests).toEqual([]);
});

test('SVG preview uses a raster thumbnail and unsupported files remain downloadable', async ({
  page,
  request,
  context,
}) => {
  const externalRequests = await blockExternalRequests(context);
  const create = await request.post('/api/libraries', {
    data: { name: 'Preview formats' },
  });
  expect(create.ok()).toBe(true);
  const library = LibrarySchema.parse(await create.json());
  expect(
    (
      await request.patch('/api/settings', {
        data: { activeLibraryId: library.id, language: 'en', theme: 'light' },
      })
    ).ok(),
  ).toBe(true);
  await page.goto('/');
  const original = Buffer.from(
    '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300"><rect width="400" height="300" fill="#f49245"/></svg>',
  );
  const unknown = Buffer.from(
    'A retained original file with an unsupported format.',
  );
  await page
    .getByLabel('Import files', { exact: true })
    .and(page.locator('input[type="file"]'))
    .setInputFiles([
      {
        name: 'preview-vector.svg',
        mimeType: 'image/svg+xml',
        buffer: original,
      },
      {
        name: 'preview-model.custom',
        mimeType: 'application/octet-stream',
        buffer: unknown,
      },
    ]);
  await page
    .getByRole('button', { name: 'Select preview-vector.svg', exact: true })
    .dblclick();
  const dialog = page.getByRole('dialog', { name: 'Asset preview' });
  const svgImage = dialog.getByRole('img', { name: 'preview-vector.svg — V1' });
  await expect(svgImage).toHaveAttribute('src', /\/thumbnail\?revision=\d+$/);
  await expect
    .poll(async () =>
      svgImage.evaluate((element) =>
        Number(Reflect.get(element, 'naturalWidth')),
      ),
    )
    .toBeGreaterThan(0);
  const originalUrl = await dialog
    .getByRole('link', { name: 'Download original', exact: true })
    .getAttribute('href');
  const svgResponse = await request.get(originalUrl!);
  expect(svgResponse.headers()['content-disposition']).toContain('attachment');
  expect(await svgResponse.body()).toEqual(original);
  await dialog
    .getByRole('button', { name: 'Close preview', exact: true })
    .click();
  await page
    .getByRole('button', { name: 'Select preview-model.custom', exact: true })
    .dblclick();
  await expect(
    dialog.getByText('Preview is not available for this file type.', {
      exact: true,
    }),
  ).toBeVisible();
  await expect(dialog.getByRole('img')).toHaveCount(0);
  const unknownUrl = await dialog
    .getByRole('link', { name: 'Download original', exact: true })
    .getAttribute('href');
  expect(await (await request.get(unknownUrl!)).body()).toEqual(unknown);
  expect(externalRequests).toEqual([]);
});

test('open preview navigates adjacent assets and follows a watched file replacement', async ({
  page,
  request,
  context,
}) => {
  test.setTimeout(45_000);
  const externalRequests = await blockExternalRequests(context);
  const directory = await mkdtemp(join(tmpdir(), 'cura-preview-watch-'));
  const original = previewFixture(90);
  const replacement = previewFixture(180);
  try {
    await writeFile(join(directory, 'watch-a.png'), original);
    await writeFile(join(directory, 'watch-b.png'), previewFixture(120));
    const create = await request.post('/api/libraries', {
      data: { name: 'Live preview acceptance' },
    });
    expect(create.ok()).toBe(true);
    const library = LibrarySchema.parse(await create.json());
    expect(
      (
        await request.patch('/api/settings', {
          data: { activeLibraryId: library.id, language: 'en' },
        })
      ).ok(),
    ).toBe(true);
    expect(
      (
        await request.post(`/api/libraries/${library.id}/roots`, {
          data: { path: directory },
        })
      ).ok(),
    ).toBe(true);
    await expect
      .poll(
        async () =>
          AssetPageSchema.parse(
            await (
              await request.get(`/api/libraries/${library.id}/assets`)
            ).json(),
          ).total,
        { timeout: 15_000 },
      )
      .toBe(2);
    await page.goto('/');
    await page
      .getByRole('button', { name: 'Select watch-a.png', exact: true })
      .dblclick();
    const dialog = page.getByRole('dialog', { name: 'Asset preview' });
    await expect(
      dialog.getByRole('img', { name: 'watch-a.png — V1' }),
    ).toBeVisible();
    const forward = await dialog
      .getByRole('button', { name: 'Next asset', exact: true })
      .isEnabled();
    await dialog
      .getByRole('button', {
        name: forward ? 'Next asset' : 'Previous asset',
        exact: true,
      })
      .click();
    await expect(
      dialog.getByRole('img', { name: 'watch-b.png — V1' }),
    ).toBeVisible();
    await dialog
      .getByRole('button', { name: 'Close preview', exact: true })
      .press(forward ? 'ArrowLeft' : 'ArrowRight');
    await expect(
      dialog.getByRole('img', { name: 'watch-a.png — V1' }),
    ).toBeVisible();
    await writeFile(join(directory, 'watch-a.png'), replacement);
    await expect(
      dialog.getByRole('img', { name: 'watch-a.png — V2' }),
    ).toBeVisible({ timeout: 10_000 });
    await expect(
      dialog.getByRole('button', { name: /View V1:/ }),
    ).toBeVisible();
    const catalog = AssetPageSchema.parse(
      await (await request.get(`/api/libraries/${library.id}/assets`)).json(),
    );
    const asset = catalog.items.find((item) => item.name === 'watch-a.png')!;
    const history = AssetVersionsSchema.parse(
      await (await request.get(`/api/assets/${asset.id}/versions`)).json(),
    );
    const oldVersion = history.find((version) => version.ordinal === 1)!;
    expect(
      await (await request.get(`/api/versions/${oldVersion.id}/file`)).body(),
    ).toEqual(original);
    expect(
      await (
        await request.get(`/api/versions/${asset.currentVersionId}/file`)
      ).body(),
    ).toEqual(replacement);
    expect(externalRequests).toEqual([]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
