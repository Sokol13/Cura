/// <reference lib="dom" />
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { expect, test } from '@playwright/test';
import {
  AssetSchema,
  AssetPageSchema,
  LibrarySchema,
} from '../packages/shared/src/index.js';

const sharp = createRequire(
  new URL('../packages/server/package.json', import.meta.url),
)('sharp') as (input: Buffer) => {
  png: () => { toBuffer: () => Promise<Buffer> };
};

test('synthetic 10000-record browser catalog keeps grid and list DOM bounded while scrolling', async ({
  page,
  request,
  context,
}, testInfo) => {
  test.setTimeout(90_000);
  page.setDefaultTimeout(10_000);
  const total = 10_000;
  const outsideRequests: string[] = [];
  const offsets = new Set<number>();
  const evidence: Record<string, unknown> = {
    scope:
      'Synthetic 10000-record browser rendering only. Asset list pagination is mocked; the seed asset, thumbnail, settings and other API calls use the real local server. This is not 10000-file ingestion or database-query evidence; real ingestion/search acceptance remains the separate 1000-image stress test.',
    total,
    outsideRequests,
    environment: {
      platform: process.platform,
      browser: 'headless Chromium',
      physicalDesktopVerified: false,
    },
  };
  const loopback = (url: string) =>
    ['127.0.0.1', 'localhost', '[::1]'].includes(new URL(url).hostname);
  await context.route('**/*', async (route) => {
    if (loopback(route.request().url())) await route.continue();
    else {
      outsideRequests.push(route.request().url());
      await route.abort();
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
    const created = await request.post('/api/libraries', {
      data: { name: 'Synthetic 10000-record rendering benchmark' },
    });
    expect(created.status()).toBe(201);
    const library = LibrarySchema.parse(await created.json());
    const png = await sharp(
      Buffer.from(
        '<svg xmlns="http://www.w3.org/2000/svg" width="128" height="96"><rect width="128" height="96" fill="#2477c4"/><circle cx="80" cy="40" r="25" fill="#f5b45a"/></svg>',
      ),
    )
      .png()
      .toBuffer();
    const uploaded = await request.post(
      `/api/libraries/${library.id}/upload?name=real-thumbnail.png`,
      { data: png, headers: { 'content-type': 'application/octet-stream' } },
    );
    expect(uploaded.status()).toBe(201);
    const seed = AssetSchema.parse(await uploaded.json());
    const settings = await request.patch('/api/settings', {
      data: { activeLibraryId: library.id, language: 'en', layout: 'grid' },
    });
    expect(settings.ok()).toBe(true);
    const synthetic = Array.from({ length: total }, (_, index) =>
      AssetSchema.parse({
        ...seed,
        id: randomUUID(),
        name: `synthetic-${String(index).padStart(5, '0')}.png`,
        relativePath: `synthetic-${index}.png`,
      }),
    );
    expect(new Set(synthetic.map((asset) => asset.id)).size).toBe(total);
    const assetsPath = `/api/libraries/${library.id}/assets`;
    await context.route(`**${assetsPath}?**`, async (route) => {
      const url = new URL(route.request().url());
      const offset = Number(url.searchParams.get('offset') ?? 0);
      const limit = Number(url.searchParams.get('limit') ?? 100);
      expect(route.request().method()).toBe('GET');
      expect(limit).toBeLessThanOrEqual(200);
      offsets.add(offset);
      await route.fulfill({
        json: AssetPageSchema.parse({
          items: synthetic.slice(offset, offset + limit),
          total,
        }),
      });
    });
    await page.goto('/');
    await expect(page.getByText('10000 assets', { exact: true })).toBeVisible();
    const thumbnail = page.locator('.asset-card img').first();
    await thumbnail.evaluate(async (element) => {
      await (element as HTMLImageElement).decode();
    });
    const scroll = page.locator('.asset-scroll');
    for (let offset = 100; offset < total; offset += 100) {
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
    expect(offsets.size).toBe(100);
    evidence.uniquePagesLoaded = offsets.size;
    evidence.uniqueSyntheticAssetIds = total;
    evidence.distinctRealThumbnails = 1;
    for (const layout of ['grid', 'list'] as const) {
      await page
        .getByRole('button', {
          name: layout === 'grid' ? 'Grid view' : 'List view',
          exact: true,
        })
        .click();
      await expect(page.locator(`.asset-scroll.${layout}`)).toBeVisible();
      const result = await scroll.evaluate(async (node) => {
        const frames: number[] = [];
        const counts: number[] = [];
        const longTasks: number[] = [];
        const observer = new PerformanceObserver((records) =>
          longTasks.push(
            ...records.getEntries().map((entry) => entry.duration),
          ),
        );
        observer.observe({ type: 'longtask', buffered: false });
        const maximumScroll = node.scrollHeight - node.clientHeight;
        let previous: number | undefined;
        await new Promise<void>((resolve) => {
          let frame = 0;
          const tick = (time: number) => {
            if (previous !== undefined) frames.push(time - previous);
            previous = time;
            counts.push(node.querySelectorAll('.asset-card').length);
            node.scrollTop = maximumScroll * (1 - frame / 240);
            if (++frame <= 240) requestAnimationFrame(tick);
            else resolve();
          };
          requestAnimationFrame(tick);
        });
        longTasks.push(
          ...observer.takeRecords().map((entry) => entry.duration),
        );
        observer.disconnect();
        const sorted = [...frames].sort((a, b) => a - b);
        return {
          frames,
          longTasks,
          maximumScroll,
          frameP95Ms: sorted[Math.floor(sorted.length * 0.95)] ?? 0,
          frameMaximumMs: Math.max(...frames),
          maximumRenderedItems: Math.max(...counts),
          minimumRenderedItems: Math.min(...counts),
        };
      });
      evidence[layout] = result;
      expect(result.maximumScroll).toBeGreaterThan(200_000);
      expect(result.frames).toHaveLength(240);
      expect(result.minimumRenderedItems).toBeGreaterThan(0);
      expect(result.maximumRenderedItems).toBeLessThanOrEqual(100);
      expect(result.frameP95Ms, `${layout}: p95 frame interval`).toBeLessThan(
        34,
      );
      expect(
        result.frameMaximumMs,
        `${layout}: maximum frame interval`,
      ).toBeLessThan(100);
      expect(
        result.longTasks.filter((milliseconds) => milliseconds >= 100),
      ).toEqual([]);
    }
    expect(outsideRequests).toEqual([]);
  } finally {
    await testInfo.attach('synthetic-10000-browser-evidence.json', {
      body: JSON.stringify(evidence, null, 2),
      contentType: 'application/json',
    });
  }
});
