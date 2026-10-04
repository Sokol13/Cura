import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import sharp from 'sharp';
import {
  AssetPageSchema,
  AssetSchema,
  AssetVersionsSchema,
  LibrarySchema,
} from '@cura/shared';
import { createApp } from '../src/app.js';
import { openDatabase } from '../src/database.js';

const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const fn of cleanup.splice(0).reverse()) await fn();
});

it('registers and watches originals, retains replacement bytes through rescan, and streams thumbnails', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'cura-ingestion-'));
  cleanup.push(() => rm(dir, { recursive: true, force: true }));
  const paths = {
    data: join(dir, 'data'),
    cache: join(dir, 'cache'),
    log: join(dir, 'log'),
  };
  const db = openDatabase(paths);
  cleanup.push(async () => {
    db.close();
  });
  const app = await createApp({ staticRoot: false, database: db, paths });
  cleanup.push(() => app.close());
  const call = (
    method: 'GET' | 'POST',
    url: string,
    payload?: unknown,
    binary = false,
  ) =>
    app.inject({
      method,
      url,
      headers: {
        host: 'localhost',
        ...(binary ? { 'content-type': 'application/octet-stream' } : {}),
      },
      ...(payload === undefined ? {} : { payload: payload as string }),
    });
  const created = await call('POST', '/api/libraries', {
    name: 'Test Library',
  });
  expect(created.statusCode).toBe(201);
  const library = LibrarySchema.parse(created.json());
  const root = join(dir, 'originals');
  await mkdir(root);
  const first = await sharp({
    create: { width: 40, height: 30, channels: 3, background: '#ff0000' },
  })
    .png()
    .toBuffer();
  await writeFile(join(root, '设计.png'), first);
  expect(
    (await call('POST', `/api/libraries/${library.id}/roots`, { path: root }))
      .statusCode,
  ).toBe(201);
  const assets = async () =>
    AssetPageSchema.parse(
      (await call('GET', `/api/libraries/${library.id}/assets`)).json(),
    );
  await expect
    .poll(async () => (await assets()).total, { timeout: 10000 })
    .toBe(1);
  const asset = (await assets()).items[0]!;
  expect(asset.width).toBe(40);
  expect(
    (await call('GET', `/api/versions/${asset.currentVersionId}/thumbnail`))
      .statusCode,
  ).toBe(200);
  const second = await sharp({
    create: { width: 50, height: 30, channels: 3, background: '#0000ff' },
  })
    .png()
    .toBuffer();
  const replaced = await app.inject({
    method: 'POST',
    url: `/api/assets/${asset.id}/replace?name=next.png`,
    headers: { host: 'localhost', 'content-type': 'application/octet-stream' },
    payload: second,
  });
  expect(replaced.statusCode).toBe(200);
  const current = AssetSchema.parse(replaced.json());
  expect(current.width).toBe(50);
  expect(await readFile(join(root, '设计.png'))).toEqual(first);
  expect(
    AssetVersionsSchema.parse(
      (await call('GET', `/api/assets/${asset.id}/versions`)).json(),
    ),
  ).toHaveLength(2);
  expect(
    (await call('GET', `/api/versions/${asset.currentVersionId}/file`))
      .rawPayload,
  ).toEqual(first);
  await call('POST', `/api/libraries/${library.id}/rescan`);
  await expect
    .poll(
      async () =>
        AssetSchema.parse((await call('GET', `/api/assets/${asset.id}`)).json())
          .hash,
    )
    .toBe(current.hash);
  const started = performance.now();
  await writeFile(
    join(root, 'new.png'),
    await sharp({
      create: { width: 60, height: 30, channels: 3, background: '#00ff00' },
    })
      .png()
      .toBuffer(),
  );
  await expect
    .poll(async () => (await assets()).total, { timeout: 4900 })
    .toBe(2);
  expect(performance.now() - started).toBeLessThan(5000);
}, 20000);

it('validates input, persists organization and exports bounded diagnostic data without changing originals', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'cura-api-'));
  cleanup.push(() => rm(dir, { recursive: true, force: true }));
  const paths = {
    data: join(dir, 'data'),
    cache: join(dir, 'cache'),
    log: join(dir, 'log'),
  };
  const db = openDatabase(paths);
  cleanup.push(async () => db.close());
  const app = await createApp({ staticRoot: false, database: db, paths });
  cleanup.push(() => app.close());
  const request = (
    method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
    url: string,
    payload?: unknown,
  ) =>
    app.inject({
      method,
      url,
      headers: { host: 'localhost' },
      ...(payload === undefined
        ? {}
        : {
            payload: JSON.stringify(payload),
            headers: { host: 'localhost', 'content-type': 'application/json' },
          }),
    });
  expect(
    (await request('POST', '/api/libraries', { name: '' })).statusCode,
  ).toBe(400);
  const library = LibrarySchema.parse(
    (await request('POST', '/api/libraries', { name: 'Creative work' })).json(),
  );
  const image = await sharp({
    create: { width: 48, height: 32, channels: 3, background: '#ff8800' },
  })
    .png()
    .toBuffer();
  const upload = (name: string) =>
    app.inject({
      method: 'POST',
      url: `/api/libraries/${library.id}/upload?name=${encodeURIComponent(name)}`,
      headers: {
        host: 'localhost',
        'content-type': 'application/octet-stream',
      },
      payload: image,
    });
  expect((await upload('../escape.png')).statusCode).toBe(400);
  const asset = AssetSchema.parse((await upload('演示.png')).json());
  const folder = (
    await request('POST', `/api/libraries/${library.id}/folders`, {
      name: 'Characters',
    })
  ).json<{ id: string }>();
  const group = (
    await request('POST', `/api/libraries/${library.id}/tag-groups`, {
      name: 'Style',
    })
  ).json<{ id: string }>();
  const tag = (
    await request('POST', `/api/libraries/${library.id}/tags`, {
      name: 'hero',
      color: '#ff8800',
      groupId: group.id,
    })
  ).json<{ id: string }>();
  expect(
    (
      await request('PATCH', `/api/assets/${asset.id}`, {
        folderId: folder.id,
        tagIds: [tag.id],
        note: '森林',
        rating: 5,
        prompt: 'portrait',
      })
    ).statusCode,
  ).toBe(200);
  const found = AssetPageSchema.parse(
    (
      await request(
        'GET',
        `/api/libraries/${library.id}/assets?q=${encodeURIComponent('林')}&tagId=${tag.id}&rating=5`,
      )
    ).json(),
  );
  expect(found.items.map((item) => item.id)).toEqual([asset.id]);
  const annotation = (
    await request('POST', `/api/assets/${asset.id}/annotations`, {
      versionId: asset.currentVersionId,
      x: 0.3,
      y: 0.4,
      text: 'Refine lighting',
    })
  ).json<{ id: string }>();
  expect(annotation.id).toBeTruthy();
  expect(
    (
      await request('POST', `/api/assets/${asset.id}/annotations`, {
        versionId: asset.currentVersionId,
        x: 2,
        y: 0.4,
        text: 'invalid',
      })
    ).statusCode,
  ).toBe(400);
  expect(
    (await request('DELETE', `/api/annotations/${annotation.id}`)).statusCode,
  ).toBe(200);
  await request('POST', `/api/libraries/${library.id}/assets/batch`, {
    assetIds: [asset.id],
    action: 'trash',
  });
  expect(
    AssetPageSchema.parse(
      (await request('GET', `/api/libraries/${library.id}/assets`)).json(),
    ).total,
  ).toBe(0);
  await request('POST', `/api/libraries/${library.id}/assets/batch`, {
    assetIds: [asset.id],
    action: 'restore',
  });
  expect(
    AssetPageSchema.parse(
      (await request('GET', `/api/libraries/${library.id}/assets`)).json(),
    ).total,
  ).toBe(1);
  expect(
    (
      await request('PATCH', '/api/settings', {
        language: 'en',
        theme: 'light',
      })
    ).statusCode,
  ).toBe(200);
  const cache = await request('GET', '/api/cache');
  expect(cache.statusCode).toBe(200);
  expect(cache.json<{ files: number; bytes: number }>().bytes).toBeGreaterThan(
    0,
  );
  expect((await request('POST', '/api/cache/clear')).statusCode).toBe(200);
  expect(
    (await request('GET', `/api/versions/${asset.currentVersionId}/file`))
      .rawPayload,
  ).toEqual(image);
  expect((await request('POST', '/api/cache/rebuild')).statusCode).toBe(200);
  expect(
    (await request('GET', `/api/versions/${asset.currentVersionId}/thumbnail`))
      .headers['content-type'],
  ).toContain('image/webp');
  const diagnostics = await request('GET', '/api/diagnostics');
  expect(diagnostics.statusCode).toBe(200);
  expect(diagnostics.rawPayload.subarray(0, 2).toString()).toBe('PK');
  const badOrigin = await app.inject({
    url: '/api/libraries',
    headers: { host: 'localhost', origin: 'https://evil.example' },
  });
  expect(badOrigin.statusCode).toBe(403);
  const svg = Buffer.from(
    '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><script>alert(1)</script><rect width="10" height="10" fill="red"/></svg>',
  );
  const imported = AssetSchema.parse(
    (
      await app.inject({
        method: 'POST',
        url: `/api/libraries/${library.id}/upload?name=active.svg`,
        headers: {
          host: 'localhost',
          'content-type': 'application/octet-stream',
        },
        payload: svg,
      })
    ).json(),
  );
  const original = await request(
    'GET',
    `/api/versions/${imported.currentVersionId}/file`,
  );
  expect(original.headers['content-disposition']).toContain('attachment');
  expect(original.headers['content-security-policy']).toContain('sandbox');
}, 20000);
