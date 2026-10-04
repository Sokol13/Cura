/// <reference lib="dom" />
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { expect, test } from '@playwright/test';
import { LibrarySchema } from '../packages/shared/src/index.js';

test('offline process timeline, final-output statistics and usable mock jobs survive reload', async ({
  page,
  request,
  context,
}) => {
  test.setTimeout(90_000);
  page.setDefaultTimeout(10_000);
  const directory = await mkdtemp(join(tmpdir(), 'cura-process-e2e-'));
  const external: string[] = [];
  const local = (url: string) =>
    ['127.0.0.1', 'localhost', '[::1]'].includes(new URL(url).hostname);
  await context.route('**/*', async (route) => {
    if (local(route.request().url())) await route.continue();
    else {
      external.push(route.request().url());
      await route.abort();
    }
  });
  await context.routeWebSocket('**/*', (socket) => {
    if (local(socket.url())) socket.connectToServer();
    else {
      external.push(socket.url());
      socket.close();
    }
  });
  try {
    await promisify(execFile)(process.execPath, [
      fileURLToPath(
        new URL('../scripts/generate-fixtures.mjs', import.meta.url),
      ),
      directory,
      '2',
    ]);
    const library = LibrarySchema.parse(
      await (
        await request.post('/api/libraries', {
          data: { name: 'Creative process acceptance' },
        })
      ).json(),
    );
    expect(
      (
        await request.patch('/api/settings', {
          data: { activeLibraryId: library.id, language: 'en', layout: 'grid' },
        })
      ).ok(),
    ).toBe(true);
    await page.goto('/');
    await page
      .getByLabel('Import files', { exact: true })
      .and(page.locator('input[type=file]'))
      .setInputFiles({
        name: 'process-scene.png',
        mimeType: 'image/png',
        buffer: await readFile(join(directory, 'cura-00000-sd.png')),
      });
    await page
      .getByRole('button', { name: 'Select process-scene.png', exact: true })
      .dblclick();
    const preview = page.getByRole('dialog', { name: 'Asset preview' });
    await preview.getByLabel('Replace file', { exact: true }).setInputFiles({
      name: 'process-revised.png',
      mimeType: 'image/png',
      buffer: await readFile(join(directory, 'cura-00001-comfy.png')),
    });
    await expect(
      preview.getByRole('button', { name: /View V2:/ }),
    ).toBeVisible();
    await preview
      .getByRole('button', { name: 'Close preview', exact: true })
      .click();
    await page
      .getByRole('button', { name: 'Creative process', exact: true })
      .click();
    await expect(
      page.getByRole('heading', { name: 'Creative process', exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText('2 recorded outputs', { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText(
        'Cura fixture 0, geometric landscape, studio color study',
        { exact: true },
      ),
    ).toBeVisible();
    await expect(
      page.getByText(
        'Cura fixture 1, geometric landscape, studio color study',
        { exact: true },
      ),
    ).toBeVisible();
    await expect(
      page.getByText('18446744073709551615', { exact: true }),
    ).toHaveCount(2);
    await page
      .getByRole('button', { name: 'Finalize current version', exact: true })
      .click();
    await expect(
      page.getByText('1 selected output', { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText('50.0%', { exact: true }).first(),
    ).toBeVisible();
    await expect(
      page.getByText('Manual selection', { exact: true }),
    ).toBeVisible();
    await page.reload();
    await expect(
      page.getByText('1 selected output', { exact: true }),
    ).toBeVisible();
    await page
      .getByRole('button', { name: 'Mock generator', exact: true })
      .click();
    await expect(
      page.getByText(
        'Local deterministic illustration mock. No image-generation service is contacted.',
        { exact: true },
      ),
    ).toBeVisible();
    await page
      .getByRole('textbox', { name: 'Prompt', exact: true })
      .fill('Offline copper forest');
    await page
      .getByRole('textbox', { name: 'Seed', exact: true })
      .fill('18446744073709551615');
    await page
      .getByRole('spinbutton', { name: 'Width', exact: true })
      .fill('128');
    await page
      .getByRole('spinbutton', { name: 'Height', exact: true })
      .fill('96');
    await page
      .getByRole('button', { name: 'Generate mock images', exact: true })
      .click();
    const job = page.getByRole('region', {
      name: 'Job: Offline copper forest',
      exact: true,
    });
    await expect(job.getByText('Completed', { exact: true })).toBeVisible();
    await expect(
      page.getByText('3 recorded outputs', { exact: true }),
    ).toBeVisible();
    await job
      .getByRole('button', { name: 'View result 1', exact: true })
      .click();
    await expect(
      page.getByText('Offline copper forest', { exact: true }),
    ).toBeVisible();
    const generated = page.locator('.process-timeline img').first();
    const dimensions = await generated.evaluate(async (element) => {
      const image = element as HTMLImageElement;
      await image.decode();
      return [image.naturalWidth, image.naturalHeight];
    });
    expect(dimensions).toEqual([128, 96]);
    await page
      .getByRole('button', { name: 'Mock generator', exact: true })
      .click();
    await page
      .getByRole('textbox', { name: 'Prompt', exact: true })
      .fill('Failure demonstration');
    await page
      .getByRole('combobox', { name: 'Mock behavior', exact: true })
      .selectOption('fail');
    await page
      .getByRole('button', { name: 'Generate mock images', exact: true })
      .click();
    const failed = page.getByRole('region', {
      name: 'Job: Failure demonstration',
      exact: true,
    });
    await expect(failed.getByText('Failed', { exact: true })).toBeVisible();
    await expect(
      failed.getByText(/Simulated mock-provider failure/),
    ).toBeVisible();
    await page
      .getByRole('textbox', { name: 'Prompt', exact: true })
      .fill('Cancellation demonstration');
    await page
      .getByRole('combobox', { name: 'Mock behavior', exact: true })
      .selectOption('complete');
    await page
      .getByRole('spinbutton', { name: 'Output count', exact: true })
      .fill('4');
    await page
      .getByRole('button', { name: 'Generate mock images', exact: true })
      .click();
    const cancelled = page.getByRole('region', {
      name: 'Job: Cancellation demonstration',
      exact: true,
    });
    await cancelled
      .getByRole('button', { name: 'Cancel job', exact: true })
      .click();
    await expect(
      cancelled.getByText('Cancelled', { exact: true }),
    ).toBeVisible();
    const persistedJobs = (await (
      await request.get(`/api/libraries/${library.id}/generations`)
    ).json()) as Array<{
      status: string;
      request: { prompt: string };
      assetIds: string[];
    }>;
    const cancelledJob = persistedJobs.find(
      (job) => job.request.prompt === 'Cancellation demonstration',
    )!;
    expect(cancelledJob.status).toBe('cancelled');
    expect(cancelledJob.assetIds.length).toBeLessThan(4);
    await expect(
      page.getByText(`${3 + cancelledJob.assetIds.length} recorded outputs`, {
        exact: true,
      }),
    ).toBeVisible();
    expect(external).toEqual([]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('a stale timeline cannot finalize or clear an unseen replacement version', async ({
  page,
  request,
  context,
}) => {
  test.setTimeout(30_000);
  const directory = await mkdtemp(join(tmpdir(), 'cura-process-race-'));
  const external: string[] = [];
  await context.route('**/*', async (route) => {
    if (
      ['127.0.0.1', 'localhost', '[::1]'].includes(
        new URL(route.request().url()).hostname,
      )
    )
      await route.continue();
    else {
      external.push(route.request().url());
      await route.abort();
    }
  });
  try {
    await promisify(execFile)(process.execPath, [
      fileURLToPath(
        new URL('../scripts/generate-fixtures.mjs', import.meta.url),
      ),
      directory,
      '2',
    ]);
    const library = LibrarySchema.parse(
      await (
        await request.post('/api/libraries', {
          data: { name: 'Selection concurrency' },
        })
      ).json(),
    );
    const first = await readFile(join(directory, 'cura-00000-sd.png')),
      second = await readFile(join(directory, 'cura-00001-comfy.png'));
    const upload = await request.post(
      `/api/libraries/${library.id}/upload?name=first.png`,
      { headers: { 'content-type': 'application/octet-stream' }, data: first },
    );
    expect(upload.ok()).toBe(true);
    const asset = (await upload.json()) as {
      id: string;
      currentVersionId: string;
    };
    await request.patch('/api/settings', {
      data: { activeLibraryId: library.id, language: 'en' },
    });
    await page.goto('/?workspace=process');
    await expect(
      page.getByRole('button', {
        name: 'Finalize current version',
        exact: true,
      }),
    ).toBeVisible();
    const replacement = await request.post(
      `/api/assets/${asset.id}/replace?name=second.png`,
      { headers: { 'content-type': 'application/octet-stream' }, data: second },
    );
    expect(replacement.ok()).toBe(true);
    let response = page.waitForResponse(
      (value) =>
        value.url().endsWith(`/api/assets/${asset.id}/process/selection`) &&
        value.request().method() === 'PUT',
    );
    await page
      .getByRole('button', { name: 'Finalize current version', exact: true })
      .click();
    expect((await response).status()).toBe(409);
    await expect(page.getByRole('alert')).toContainText('changed');
    await expect(
      page.getByRole('heading', { name: 'V2 · second.png', exact: true }),
    ).toBeVisible();
    expect(
      (await (await request.get(`/api/assets/${asset.id}`)).json()).finalized,
    ).toBe(false);
    await page
      .getByRole('button', { name: 'Finalize current version', exact: true })
      .click();
    await expect(
      page.getByRole('button', {
        name: 'Remove manual selection',
        exact: true,
      }),
    ).toBeVisible();
    expect(
      (
        await request.post(`/api/assets/${asset.id}/replace?name=third.png`, {
          headers: { 'content-type': 'application/octet-stream' },
          data: first,
        })
      ).ok(),
    ).toBe(true);
    response = page.waitForResponse(
      (value) =>
        value.url().endsWith(`/api/assets/${asset.id}/process/selection`) &&
        value.request().method() === 'PUT',
    );
    await page
      .getByRole('button', { name: 'Remove manual selection', exact: true })
      .click();
    expect((await response).status()).toBe(409);
    await expect(
      page.getByRole('heading', { name: 'V3 · third.png', exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText('Manual selection', { exact: true }),
    ).toHaveCount(1);
    expect(
      (await (await request.get(`/api/assets/${asset.id}`)).json()).finalized,
    ).toBe(false);
    expect(external).toEqual([]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
