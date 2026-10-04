/// <reference lib="dom" />
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rename, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import {
  expect,
  test,
  type Page,
  type APIRequestContext,
} from '@playwright/test';
import {
  AssetPageSchema,
  AssetSchema,
  AssetVersionsSchema,
  LibrarySchema,
  LibraryRootSchema,
  TagSchema,
  FolderSchema,
  CollectionSchema,
  AnnotationSchema,
  type Asset,
} from '../packages/shared/src/index.js';

const run = promisify(execFile);
const count = 1000;
const seed = '18446744073709551615';
const fixtureName = (index: number) =>
  `cura-${String(index).padStart(5, '0')}-${index % 2 === 0 ? 'sd' : 'comfy'}.png`;
const loopback = (url: string) =>
  ['127.0.0.1', 'localhost', '[::1]'].includes(new URL(url).hostname);

async function mutate(
  request: APIRequestContext,
  method: 'POST' | 'PATCH',
  path: string,
  data: unknown,
) {
  const response = await request.fetch(path, { method, data });
  expect(response.ok(), `${method} ${path}: ${await response.text()}`).toBe(
    true,
  );
  return response.json() as Promise<unknown>;
}

async function scrollEvidence(page: Page, layout: 'grid' | 'list') {
  await page
    .getByRole('button', {
      name: layout === 'grid' ? 'Grid view' : 'List view',
      exact: true,
    })
    .click();
  const scroll = page.locator(`.asset-scroll.${layout}`);
  await expect(scroll).toBeVisible();
  return scroll.evaluate(async (node) => {
    const frames: number[] = [];
    const longTasks: number[] = [];
    const counts: number[] = [];
    const observer = new PerformanceObserver((records) => {
      longTasks.push(...records.getEntries().map((entry) => entry.duration));
    });
    observer.observe({ type: 'longtask', buffered: false });
    const maximumScroll = node.scrollHeight - node.clientHeight;
    let previous: number | undefined;
    await new Promise<void>((resolve) => {
      let frame = 0;
      const tick = (time: number) => {
        if (previous !== undefined) frames.push(time - previous);
        previous = time;
        counts.push(node.querySelectorAll('.asset-card').length);
        node.scrollTop = maximumScroll * (1 - frame / 120);
        if (++frame <= 120) requestAnimationFrame(tick);
        else resolve();
      };
      requestAnimationFrame(tick);
    });
    longTasks.push(...observer.takeRecords().map((entry) => entry.duration));
    observer.disconnect();
    const ordered = [...frames].sort((a, b) => a - b);
    return {
      frames,
      longTasks,
      maximumScroll,
      frameMedianMs: ordered[Math.floor(ordered.length / 2)] ?? 0,
      frameP95Ms: ordered[Math.floor(ordered.length * 0.95)] ?? 0,
      frameMaximumMs: Math.max(...frames),
      maximumRenderedItems: Math.max(...counts),
      minimumRenderedItems: Math.min(...counts),
    };
  });
}

test('1000 distinct assets stay responsive and usable with only loopback networking', async ({
  page,
  context,
  request,
}, testInfo) => {
  test.setTimeout(180_000);
  const directory = await mkdtemp(join(tmpdir(), 'cura-stress-'));
  const outsideRequests: string[] = [];
  const timings: {
    query: string;
    sample: number;
    milliseconds: number;
    total: number;
  }[] = [];
  const evidence: Record<string, unknown> = {
    environment: {
      platform: process.platform,
      arch: process.arch,
      node: process.version,
      browser: 'headless Chromium',
      physicalDesktopVerified: false,
    },
    fixtureCount: count,
    timings,
    outsideRequests,
  };
  let rootId: string | undefined;
  let libraryId: string | undefined;
  await context.route('**/*', async (route) => {
    if (loopback(route.request().url())) await route.continue();
    else {
      outsideRequests.push(route.request().url());
      await route.abort('internetdisconnected');
    }
  });
  await context.routeWebSocket('**/*', (socket) => {
    if (loopback(socket.url())) socket.connectToServer();
    else {
      outsideRequests.push(socket.url());
      socket.close();
    }
  });
  try {
    await test.step('generate PNGs, register a real directory and wait for all assets', async () => {
      await run(process.execPath, [
        fileURLToPath(
          new URL('../scripts/generate-fixtures.mjs', import.meta.url),
        ),
        directory,
        String(count + 2),
      ]);
      // Keep two distinct images outside the watched directory for later add/replace.
      await rename(
        join(directory, fixtureName(count)),
        `${directory}-watch.png`,
      );
      await rename(
        join(directory, fixtureName(count + 1)),
        `${directory}-replace.png`,
      );
      const library = LibrarySchema.parse(
        await mutate(request, 'POST', '/api/libraries', {
          name: `Stress ${testInfo.testId}`,
        }),
      );
      libraryId = library.id;
      const started = performance.now();
      const root = LibraryRootSchema.parse(
        await mutate(request, 'POST', `/api/libraries/${library.id}/roots`, {
          path: directory,
        }),
      );
      rootId = root.id;
      await expect
        .poll(
          async () => {
            const response = await request.get(
              `/api/libraries/${library.id}/assets?limit=1`,
            );
            expect(response.status()).toBe(200);
            return AssetPageSchema.parse(await response.json()).total;
          },
          { timeout: 90_000, intervals: [100, 250, 500] },
        )
        .toBe(count);
      evidence.ingestionMilliseconds = performance.now() - started;
      await mutate(request, 'PATCH', '/api/settings', {
        activeLibraryId: library.id,
        language: 'en',
        layout: 'grid',
      });
      await page.goto('/');
      await page.reload();
      await expect(
        page.getByText('1000 assets', { exact: true }),
      ).toBeVisible();
    });
    const assetsPath = `/api/libraries/${libraryId}/assets`;
    const assets: Asset[] = [];
    for (let offset = 0; offset < count; offset += 200) {
      const response = await request.get(
        `${assetsPath}?offset=${offset}&limit=200`,
      );
      expect(response.status()).toBe(200);
      const result = AssetPageSchema.parse(await response.json());
      expect(result.total).toBe(count);
      assets.push(...result.items);
    }
    expect(new Set(assets.map((asset) => asset.hash)).size).toBe(count);
    const sd = assets.find((asset) => asset.name === fixtureName(0));
    const comfy = assets.find((asset) => asset.name === fixtureName(1));
    expect(sd).toBeDefined();
    expect(comfy).toBeDefined();
    if (!sd || !comfy)
      throw new Error('Generation fixtures missing from the catalog.');
    for (const [asset, source, model] of [
      [sd, 'sd-webui', 'cura-fixture-sd-v1'],
      [comfy, 'comfyui', 'cura-fixture-comfy-v1.safetensors'],
    ] as const) {
      expect(asset.source).toBe(source);
      expect(asset.model).toBe(model);
      expect(asset.seed).toBe(seed);
      expect(asset.prompt).toContain('geometric landscape');
      expect(asset.negativePrompt).toContain('watermark');
      expect(asset.width).toBeGreaterThan(0);
      expect(asset.colors.length).toBeGreaterThanOrEqual(5);
    }
    await test.step('fetch every thumbnail over HTTP and decode every result in Chromium', async () => {
      const thumbnails = await page.evaluate(
        async (ids) => {
          let next = 0;
          let decoded = 0;
          const failures: string[] = [];
          await Promise.all(
            Array.from({ length: 8 }, async () => {
              while (next < ids.length) {
                const id = ids[next++];
                try {
                  const response = await fetch(`/api/versions/${id}/thumbnail`);
                  if (
                    response.status !== 200 ||
                    !response.headers
                      .get('content-type')
                      ?.startsWith('image/webp')
                  )
                    throw new Error(
                      `HTTP ${response.status} / ${response.headers.get('content-type')}`,
                    );
                  const bitmap = await createImageBitmap(await response.blob());
                  if (bitmap.width < 1 || bitmap.height < 1)
                    throw new Error('Empty decoded thumbnail');
                  bitmap.close();
                  decoded++;
                } catch (error) {
                  failures.push(`${id}: ${String(error)}`);
                }
              }
            }),
          );
          return { requested: ids.length, decoded, failures };
        },
        assets.map((asset) => asset.currentVersionId),
      );
      evidence.thumbnails = thumbnails;
      expect(thumbnails.failures).toEqual([]);
      expect(thumbnails.decoded).toBe(count);
    });
    await test.step('measure every full-text/filter query, including its first request', async () => {
      const tag = TagSchema.parse(
        await mutate(request, 'POST', `/api/libraries/${libraryId}/tags`, {
          name: 'acceptance-tag',
          color: '#dc503c',
        }),
      );
      const folder = FolderSchema.parse(
        await mutate(request, 'POST', `/api/libraries/${libraryId}/folders`, {
          name: 'Stress folder',
        }),
      );
      await mutate(request, 'PATCH', `/api/assets/${sd.id}`, {
        rating: 5,
        note: 'acceptance orchid 角色素材',
        tagIds: [tag.id],
        folderId: folder.id,
      });
      const color = sd.colors[0];
      if (!color) throw new Error('No extracted palette.');
      const after = new Date(Date.now() - 86_400_000).toISOString();
      const before = new Date(Date.now() + 86_400_000).toISOString();
      const cases: {
        name: string;
        params: Record<string, string>;
        expected?: number;
      }[] = [
        { name: 'all', params: {}, expected: count },
        { name: 'fulltext', params: { q: 'acceptance orchid' }, expected: 1 },
        { name: 'fulltext-cjk', params: { q: '角色' }, expected: 1 },
        { name: 'fulltext-tag', params: { q: 'acceptance-tag' }, expected: 1 },
        { name: 'tag', params: { tagId: tag.id }, expected: 1 },
        { name: 'rating', params: { rating: '5' }, expected: 1 },
        { name: 'type', params: { type: 'image/png' }, expected: count },
        { name: 'color', params: { color } },
        { name: 'source', params: { source: 'comfyui' }, expected: 500 },
        { name: 'date', params: { after, before }, expected: count },
        {
          name: 'dimension',
          params: { minWidth: '160', minHeight: '128' },
          expected: 248,
        },
        { name: 'folder', params: { folderId: folder.id }, expected: 1 },
        {
          name: 'combined',
          params: {
            q: 'orchid',
            tagId: tag.id,
            rating: '5',
            type: 'image/png',
            color,
            source: 'sd-webui',
            after,
            before,
            minWidth: '128',
            minHeight: '96',
            folderId: folder.id,
          },
          expected: 1,
        },
        { name: 'similar', params: { similarTo: sd.id }, expected: count },
      ];
      for (let sample = 0; sample < 5; sample++) {
        for (const query of cases) {
          const started = performance.now();
          const response = await request.get(
            `${assetsPath}?${new URLSearchParams({ limit: '200', ...query.params })}`,
          );
          const body: unknown = await response.json();
          const milliseconds = performance.now() - started;
          expect(response.status()).toBe(200);
          const result = AssetPageSchema.parse(body);
          timings.push({
            query: query.name,
            sample,
            milliseconds,
            total: result.total,
          });
          if (query.expected !== undefined)
            expect(result.total, query.name).toBe(query.expected);
          else expect(result.total, query.name).toBeGreaterThan(0);
          if (result.total === 1)
            expect(result.items[0]?.id, query.name).toBe(sd.id);
          expect(
            milliseconds,
            `${query.name}, sample ${sample}, complete HTTP response`,
          ).toBeLessThan(200);
        }
      }
      evidence.querySummary = cases.map(({ name }) => {
        const values = timings
          .filter((entry) => entry.query === name)
          .map((entry) => entry.milliseconds)
          .sort((a, b) => a - b);
        return {
          query: name,
          medianMilliseconds: values[2],
          worstMilliseconds: Math.max(...values),
        };
      });
      const collection = CollectionSchema.parse(
        await mutate(
          request,
          'POST',
          `/api/libraries/${libraryId}/collections`,
          { name: 'Five-star orchids', rules: { q: 'orchid', rating: 5 } },
        ),
      );
      expect(collection.rules.rating).toBe(5);
      const annotation = AnnotationSchema.parse(
        await mutate(request, 'POST', `/api/assets/${sd.id}/annotations`, {
          versionId: sd.currentVersionId,
          x: 0.25,
          y: 0.5,
          text: 'Keep this composition',
        }),
      );
      expect(annotation.versionId).toBe(sd.currentVersionId);
      await mutate(
        request,
        'POST',
        `/api/libraries/${libraryId}/assets/batch`,
        { assetIds: [sd.id], action: 'trash' },
      );
      const trashed = await request.get(`${assetsPath}?trash=true`);
      expect(
        AssetPageSchema.parse(await trashed.json()).items.map(
          (asset) => asset.id,
        ),
      ).toEqual([sd.id]);
      await mutate(
        request,
        'POST',
        `/api/libraries/${libraryId}/assets/batch`,
        { assetIds: [sd.id], action: 'restore' },
      );
    });
    await test.step('load all 1000 records and measure grid/list virtualization and scrolling', async () => {
      await page.reload();
      await expect(page.locator('.asset-card').first()).toBeVisible();
      const scroll = page.locator('.asset-scroll');
      for (let offset = 100; offset < count; offset += 100) {
        const height = await scroll.evaluate((node) => node.scrollHeight);
        const response = page.waitForResponse((reply) => {
          const url = new URL(reply.url());
          return (
            url.pathname === assetsPath &&
            url.searchParams.get('offset') === String(offset)
          );
        });
        await scroll.evaluate((node) => {
          node.scrollTop = node.scrollHeight;
        });
        expect((await response).status()).toBe(200);
        await expect
          .poll(() => scroll.evaluate((node) => node.scrollHeight))
          .toBeGreaterThan(height);
        expect(await page.locator('.asset-card').count()).toBeLessThanOrEqual(
          100,
        );
      }
      await expect(
        page.getByRole('button', { name: 'Load more assets', exact: true }),
      ).toHaveCount(0);
      for (const layout of ['grid', 'list'] as const) {
        const result = await scrollEvidence(page, layout);
        evidence[`${layout}Scroll`] = result;
        expect(result.frames).toHaveLength(120);
        expect(result.maximumScroll).toBeGreaterThan(20_000);
        expect(result.minimumRenderedItems).toBeGreaterThan(0);
        expect(result.maximumRenderedItems).toBeLessThanOrEqual(100);
        expect(
          result.frameP95Ms,
          `${layout}: 95th percentile frame interval`,
        ).toBeLessThan(34);
        expect(
          result.frameMaximumMs,
          `${layout}: longest frame interval`,
        ).toBeLessThan(100);
        expect(
          result.longTasks.filter((duration) => duration >= 100),
          `${layout}: tasks >=100 ms`,
        ).toEqual([]);
      }
    });
    await test.step('a newly watched file appears in the API and browser within five seconds', async () => {
      await page
        .getByRole('textbox', { name: 'Search assets' })
        .fill(fixtureName(count));
      await expect(
        page.getByText('No matching assets', { exact: true }),
      ).toBeVisible();
      const started = performance.now();
      await rename(
        `${directory}-watch.png`,
        join(directory, fixtureName(count)),
      );
      await Promise.all([
        expect
          .poll(
            async () => {
              const response = await request.get(
                `${assetsPath}?q=${encodeURIComponent(fixtureName(count))}`,
              );
              return AssetPageSchema.parse(await response.json()).total;
            },
            { timeout: 5_000, intervals: [50, 100] },
          )
          .toBe(1)
          .then(() => {
            evidence.watcherApiMilliseconds = performance.now() - started;
          }),
        expect(
          page.getByRole('button', {
            name: `Select ${fixtureName(count)}`,
            exact: true,
          }),
        )
          .toBeVisible({ timeout: 5_000 })
          .then(() => {
            evidence.watcherBrowserMilliseconds = performance.now() - started;
          }),
      ]);
      expect(evidence.watcherApiMilliseconds).toBeLessThan(5_000);
      expect(evidence.watcherBrowserMilliseconds).toBeLessThan(5_000);
    });
    await test.step('offline replacement preserves original bytes and diagnostics download works', async () => {
      const original = await request.get(
        `/api/versions/${sd.currentVersionId}/file`,
      );
      expect(original.status()).toBe(200);
      const originalBytes = await original.body();
      const replacementBytes = await readFile(`${directory}-replace.png`);
      const response = await request.post(
        `/api/assets/${sd.id}/replace?name=replaced.png`,
        {
          data: replacementBytes,
          headers: { 'content-type': 'application/octet-stream' },
        },
      );
      expect(response.ok()).toBe(true);
      const replacement = AssetSchema.parse(await response.json());
      expect(replacement.currentVersionId).not.toBe(sd.currentVersionId);
      const versions = await request.get(`/api/assets/${sd.id}/versions`);
      expect(AssetVersionsSchema.parse(await versions.json())).toHaveLength(2);
      const retained = await request.get(
        `/api/versions/${sd.currentVersionId}/file`,
      );
      expect(await retained.body()).toEqual(originalBytes);
      const updated = await request.get(
        `/api/versions/${replacement.currentVersionId}/file`,
      );
      expect(await updated.body()).toEqual(replacementBytes);
      const diagnostics = await request.get('/api/diagnostics');
      expect(diagnostics.status()).toBe(200);
      const archive = await diagnostics.body();
      expect(archive.subarray(0, 4).toString('hex')).toBe('504b0304');
      expect(archive.length).toBeGreaterThan(200);
    });
    expect(
      outsideRequests,
      'The complete flow must not attempt external HTTP or WebSocket connections',
    ).toEqual([]);
  } finally {
    await testInfo.attach('p0-stress-evidence.json', {
      body: JSON.stringify(evidence, null, 2),
      contentType: 'application/json',
    });
    if (rootId) await request.delete(`/api/roots/${rootId}`);
    await Promise.all(
      [directory, `${directory}-watch.png`, `${directory}-replace.png`].map(
        (path) => rm(path, { recursive: true, force: true }),
      ),
    );
  }
});
