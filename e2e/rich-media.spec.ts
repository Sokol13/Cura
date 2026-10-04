import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { expect, test } from '@playwright/test';
import {
  AssetPageSchema,
  AssetSchema,
  AssetVersionsSchema,
  LibrarySchema,
} from '../packages/shared/src/index.js';
const fixture = (name: string) =>
  fileURLToPath(new URL(`./fixtures/rich/${name}`, import.meta.url));
const names = [
  'orange-cube.glb',
  'orange-cube.obj',
  'quadrants-raw.psd',
  'quadrants-rle.psd',
  'two-pages.pdf',
  'first-frame.mp4',
  'first-frame.mov',
];

test('six rich formats render real local pixels, retain history and rebuild all previews offline', async ({
  page,
  context,
  request,
}) => {
  test.setTimeout(120000);
  const outside: string[] = [];
  await context.route('**/*', (route) => {
    const host = new URL(route.request().url()).hostname;
    if (['127.0.0.1', 'localhost'].includes(host)) return route.continue();
    outside.push(route.request().url());
    return route.abort();
  });
  await context.routeWebSocket('**/*', (socket) => {
    if (['127.0.0.1', 'localhost'].includes(new URL(socket.url()).hostname))
      socket.connectToServer();
    else {
      outside.push(socket.url());
      socket.close();
    }
  });
  await request.patch('/api/settings', { data: { language: 'en' } });
  const library = LibrarySchema.parse(
    await (
      await request.post('/api/libraries', {
        data: { name: 'Rich fixture studio' },
      })
    ).json(),
  );
  await request.patch('/api/settings', {
    data: { activeLibraryId: library.id },
  });
  const hashes = new Map<string, string>();
  for (const name of names) {
    const bytes = await readFile(fixture(name));
    const response = await request.post(
      `/api/libraries/${library.id}/upload?name=${encodeURIComponent(name)}`,
      { headers: { 'content-type': 'application/octet-stream' }, data: bytes },
    );
    expect(response.status()).toBe(201);
    const asset = AssetSchema.parse(await response.json());
    hashes.set(
      asset.currentVersionId,
      createHash('sha256').update(bytes).digest('hex'),
    );
  }
  await page.goto('/');
  const assets = async () =>
    AssetPageSchema.parse(
      await (await request.get(`/api/libraries/${library.id}/assets`)).json(),
    ).items;
  await expect
    .poll(
      async () =>
        (await assets()).map((a) => ({
          name: a.name,
          state: a.previewState,
          error: a.previewError,
        })),
      { timeout: 45000 },
    )
    .toEqual(
      expect.arrayContaining(
        names.map((name) => ({ name, state: 'ready', error: null })),
      ),
    );
  for (const asset of await assets()) {
    const response = await request.get(
      `/api/versions/${asset.currentVersionId}/thumbnail?revision=${asset.previewRevision}`,
    );
    expect(response.headers()['content-type']).toContain('image/webp');
    const result = await page.evaluate(
      async ({ id, revision, name }) => {
        const response = await fetch(
          `/api/versions/${id}/thumbnail?revision=${revision}`,
        );
        const bitmap = await createImageBitmap(await response.blob());
        const canvas = document.createElement('canvas');
        canvas.width = bitmap.width;
        canvas.height = bitmap.height;
        const ctx = canvas.getContext('2d')!;
        ctx.drawImage(bitmap, 0, 0);
        bitmap.close();
        const point = name.endsWith('.psd')
          ? [canvas.width / 4, canvas.height / 4]
          : [canvas.width / 2, canvas.height / 2];
        return Array.from(
          ctx.getImageData(Math.floor(point[0]!), Math.floor(point[1]!), 1, 1)
            .data,
        );
      },
      {
        id: asset.currentVersionId,
        revision: asset.previewRevision,
        name: asset.name,
      },
    );
    expect(result[0], asset.name).toBeGreaterThan(150);
    expect(result[0]! - result[2]!, asset.name).toBeGreaterThan(75);
    const original = await request.get(
      `/api/versions/${asset.currentVersionId}/file`,
    );
    expect(
      createHash('sha256')
        .update(await original.body())
        .digest('hex'),
    ).toBe(hashes.get(asset.currentVersionId));
  }
  const pdf = (await assets()).find((a) => a.name === 'two-pages.pdf')!;
  await page
    .getByRole('button', { name: 'Select two-pages.pdf', exact: true })
    .dblclick();
  await expect(
    page.getByRole('dialog').getByRole('img', { name: 'two-pages.pdf — V1' }),
  ).toBeVisible();
  await page
    .getByRole('button', { name: 'Close preview', exact: true })
    .click();
  const replacement = AssetSchema.parse(
    await (
      await request.post(`/api/assets/${pdf.id}/replace?name=new-raw.psd`, {
        headers: { 'content-type': 'application/octet-stream' },
        data: await readFile(fixture('quadrants-raw.psd')),
      })
    ).json(),
  );
  await expect
    .poll(
      async () =>
        AssetSchema.parse(
          await (await request.get(`/api/assets/${pdf.id}`)).json(),
        ).previewState,
      { timeout: 15000 },
    )
    .toBe('ready');
  expect(
    AssetVersionsSchema.parse(
      await (await request.get(`/api/assets/${pdf.id}/versions`)).json(),
    ),
  ).toHaveLength(2);
  await request.post('/api/cache/clear');
  await expect
    .poll(
      async () => (await assets()).every((a) => a.previewState === 'ready'),
      { timeout: 45000 },
    )
    .toBe(true);
  for (const id of [...hashes.keys(), replacement.currentVersionId]) {
    const thumbnail = await request.get(`/api/versions/${id}/thumbnail`);
    expect(thumbnail.headers()['content-type']).toContain('image/webp');
  }
  await request.post('/api/cache/rebuild');
  await expect
    .poll(
      async () => (await assets()).every((a) => a.previewState === 'ready'),
      { timeout: 45000 },
    )
    .toBe(true);
  for (const [id, hash] of hashes) {
    const original = await request.get(`/api/versions/${id}/file`);
    expect(
      createHash('sha256')
        .update(await original.body())
        .digest('hex'),
    ).toBe(hash);
    expect(
      (await request.get(`/api/versions/${id}/thumbnail`)).headers()[
        'content-type'
      ],
    ).toContain('image/webp');
  }
  await page.reload();
  await expect(page.locator('.asset-card')).toHaveCount(names.length);
  await page.screenshot({
    path: 'docs/screenshots/v0.2-rich-previews.png',
    fullPage: true,
  });
  expect(outside).toEqual([]);
});

test('external models and corrupt video receive explicit states without fetching external resources', async ({
  page,
  context,
  request,
}) => {
  const attempted: string[] = [];
  await context.route('**/*', (route) => {
    if (new URL(route.request().url()).hostname === '127.0.0.1')
      return route.continue();
    attempted.push(route.request().url());
    return route.abort();
  });
  const library = LibrarySchema.parse(
    await (
      await request.post('/api/libraries', {
        data: { name: 'Unsupported preview fixtures' },
      })
    ).json(),
  );
  await request.patch('/api/settings', {
    data: { activeLibraryId: library.id },
  });
  for (const [name, bytes] of [
    ['external-resource.glb', await readFile(fixture('external-resource.glb'))],
    ['corrupt.mov', Buffer.from('not a movie')],
  ] as const)
    expect(
      (
        await request.post(`/api/libraries/${library.id}/upload?name=${name}`, {
          headers: { 'content-type': 'application/octet-stream' },
          data: bytes,
        })
      ).status(),
    ).toBe(201);
  await page.goto('/');
  await expect
    .poll(
      async () =>
        AssetPageSchema.parse(
          await (
            await request.get(`/api/libraries/${library.id}/assets`)
          ).json(),
        )
          .items.map((a) => a.previewError)
          .sort(),
      { timeout: 30000 },
    )
    .toEqual(['EXTERNAL_RESOURCE', 'VIDEO_CODEC']);
  expect(attempted).toEqual([]);
});

test('CJK first-page text and indented OBJ geometry produce meaningful previews', async ({
  page,
  context,
  request,
}) => {
  const external: string[] = [];
  await context.route('**/*', (route) => {
    if (new URL(route.request().url()).hostname === '127.0.0.1')
      return route.continue();
    external.push(route.request().url());
    return route.abort();
  });
  const library = LibrarySchema.parse(
    await (
      await request.post('/api/libraries', {
        data: { name: 'CJK and OBJ grammar' },
      })
    ).json(),
  );
  await request.patch('/api/settings', {
    data: { activeLibraryId: library.id },
  });
  const obj = (await readFile(fixture('orange-cube.obj'), 'utf8'))
    .split('\n')
    .map((line) => `  \t${line}`)
    .join('\n');
  for (const [name, data] of [
    ['cjk-first-page.pdf', await readFile(fixture('cjk-first-page.pdf'))],
    ['indented.obj', Buffer.from(obj)],
  ] as const) {
    expect(
      (
        await request.post(`/api/libraries/${library.id}/upload?name=${name}`, {
          headers: { 'content-type': 'application/octet-stream' },
          data,
        })
      ).status(),
    ).toBe(201);
  }
  await page.goto('/');
  const assets = async () =>
    AssetPageSchema.parse(
      await (await request.get(`/api/libraries/${library.id}/assets`)).json(),
    ).items;
  await expect
    .poll(
      async () =>
        (await assets()).map((a) => ({
          name: a.name,
          state: a.previewState,
          error: a.previewError,
        })),
      { timeout: 15000 },
    )
    .toEqual(
      expect.arrayContaining([
        { name: 'cjk-first-page.pdf', state: 'ready', error: null },
        { name: 'indented.obj', state: 'ready', error: null },
      ]),
    );
  for (const asset of await assets()) {
    const pixels = await page.evaluate(async (id) => {
      const bitmap = await createImageBitmap(
        await (await fetch(`/api/versions/${id}/thumbnail`)).blob(),
      );
      const canvas = document.createElement('canvas');
      canvas.width = bitmap.width;
      canvas.height = bitmap.height;
      const ctx = canvas.getContext('2d')!;
      ctx.drawImage(bitmap, 0, 0);
      bitmap.close();
      const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
      let dark = 0,
        colored = 0;
      for (let i = 0; i < data.length; i += 4) {
        if (
          data[i]! < 100 &&
          data[i + 1]! < 100 &&
          data[i + 2]! < 100 &&
          data[i + 3]! > 200
        )
          dark++;
        if (data[i]! > 150 && data[i]! - data[i + 2]! > 75) colored++;
      }
      return { dark, colored };
    }, asset.currentVersionId);
    expect(
      asset.name.endsWith('.pdf') ? pixels.dark : pixels.colored,
      asset.name,
    ).toBeGreaterThan(100);
  }
  expect(
    (await request.get('/assets/pdf-cmaps/UniGB-UCS2-H.bcmap')).status(),
  ).toBe(200);
  expect(external).toEqual([]);
});
