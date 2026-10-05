import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import {
  AssetPageSchema,
  LibraryRootSchema,
  LibrarySchema,
  ScanSummariesSchema,
} from '../packages/shared/src/index.js';

test('registered directories show recursive scan outcomes and retain them after reload', async ({
  page,
  request,
}) => {
  const directory = await mkdtemp(join(tmpdir(), 'cura-scan-summary-'));
  const emptyFolder = join(directory, 'empty');
  const mixedFolder = join(directory, 'mixed');
  const nestedFolder = join(mixedFolder, '子目录', 'deeper');
  const roots: string[] = [];
  const artwork =
    '<svg xmlns="http://www.w3.org/2000/svg" width="80" height="60"><rect width="80" height="60" fill="#f49245"/></svg>';
  try {
    await mkdir(emptyFolder);
    await mkdir(nestedFolder, { recursive: true });
    await Promise.all([
      writeFile(join(mixedFolder, '顶层.svg'), artwork),
      writeFile(join(nestedFolder, '嵌套副本.svg'), artwork),
      writeFile(join(mixedFolder, 'notes.txt'), 'Unsupported new text file'),
      writeFile(
        join(nestedFolder, 'notes.txt'),
        'Another unsupported text file',
      ),
      writeFile(
        join(nestedFolder, 'archive.zip'),
        'Unsupported archive fixture',
      ),
    ]);
    const created = await request.post('/api/libraries', {
      data: { name: 'Recursive scan results' },
    });
    expect(created.ok()).toBeTruthy();
    const library = LibrarySchema.parse(await created.json());
    const settings = await request.patch('/api/settings', {
      data: {
        language: 'en',
        theme: 'dark',
        layout: 'grid',
        activeLibraryId: library.id,
      },
    });
    expect(settings.ok()).toBeTruthy();
    const register = async (path: string) => {
      const response = await request.post(
        `/api/libraries/${library.id}/roots`,
        {
          data: { path },
        },
      );
      expect(response.ok()).toBeTruthy();
      const root = LibraryRootSchema.parse(await response.json());
      roots.push(root.id);
      return root;
    };
    const emptyRoot = await register(emptyFolder);
    const mixedRoot = await register(mixedFolder);
    const summaries = async () => {
      const response = await request.get(`/api/libraries/${library.id}/scans`);
      expect(response.status()).toBe(200);
      return ScanSummariesSchema.parse(await response.json());
    };
    await expect
      .poll(async () => {
        const scans = await summaries();
        return [emptyRoot, mixedRoot].map(
          (root) => scans.find((scan) => scan.rootId === root.id)?.status,
        );
      })
      .toEqual(['completed', 'completed']);
    const completed = await summaries();
    expect(
      completed.find((scan) => scan.rootId === emptyRoot.id),
    ).toMatchObject({
      status: 'completed',
      phase: 'finished',
      recursive: true,
      filesFound: 0,
      supportedFound: 0,
      unsupportedSkipped: 0,
      processed: 0,
      readErrors: 0,
    });
    expect(
      completed.find((scan) => scan.rootId === mixedRoot.id),
    ).toMatchObject({
      status: 'completed',
      phase: 'finished',
      recursive: true,
      filesFound: 5,
      supportedFound: 2,
      existingGenericFound: 0,
      unsupportedSkipped: 3,
      processed: 2,
      succeeded: 2,
      readErrors: 0,
      extensions: expect.arrayContaining([
        expect.objectContaining({
          extension: '.svg',
          found: 2,
          supported: 2,
          skipped: 0,
        }),
        expect.objectContaining({
          extension: '.txt',
          found: 2,
          supported: 0,
          skipped: 2,
        }),
        expect.objectContaining({
          extension: '.zip',
          found: 1,
          supported: 0,
          skipped: 1,
        }),
      ]),
    });
    // Scan counters describe source files, even when identical bytes deduplicate.
    const assets = AssetPageSchema.parse(
      await (await request.get(`/api/libraries/${library.id}/assets`)).json(),
    );
    expect(assets.total).toBe(1);

    await page.setViewportSize({ width: 1440, height: 1100 });
    await page.goto('/');
    const empty = page.locator('.registered-root').filter({
      has: page.getByTitle(emptyFolder, { exact: true }),
    });
    const mixed = page.locator('.registered-root').filter({
      has: page.getByTitle(mixedFolder, { exact: true }),
    });
    await expect(
      empty.getByText('Scan completed', { exact: true }),
    ).toBeVisible();
    await expect(
      empty.getByText('0 supported · 0 skipped · 0 read errors'),
    ).toBeVisible();
    await expect(
      mixed.getByText('2 supported · 3 skipped · 0 read errors'),
    ).toBeVisible();
    await expect(page.locator('.connection-state')).toHaveText(
      'Scan completed',
    );
    await expect(page.getByText('Scanning 0 / 0', { exact: true })).toHaveCount(
      0,
    );

    await mixed.locator('summary').click();
    await expect(
      mixed.getByText(
        'Subfolders are scanned recursively. Symbolic links are skipped.',
      ),
    ).toBeVisible();
    const textExtension = mixed.locator('.root-scan-extensions > div').filter({
      has: page.getByText('.txt', { exact: true }),
    });
    await expect(textExtension).toContainText(
      'Found 2 · Supported 0 · Previously tracked 0 · Skipped 2 · Read errors 0',
    );
    const archiveExtension = mixed
      .locator('.root-scan-extensions > div')
      .filter({
        has: page.getByText('.zip', { exact: true }),
      });
    await expect(archiveExtension).toContainText(
      'Found 1 · Supported 0 · Previously tracked 0 · Skipped 1 · Read errors 0',
    );
    await expect(
      mixed.getByText('Files found: 5 · Processed successfully: 2'),
    ).toBeVisible();

    await page.reload();
    await expect(
      empty.getByText('Scan completed', { exact: true }),
    ).toBeVisible();
    await expect(
      empty.getByText('0 supported · 0 skipped · 0 read errors'),
    ).toBeVisible();
    await expect(
      mixed.getByText('2 supported · 3 skipped · 0 read errors'),
    ).toBeVisible();
    await expect(page.locator('.connection-state')).toHaveText(
      'Scan completed',
    );
    await empty.locator('summary').click();
    await mixed.locator('summary').click();
    await expect(textExtension).toContainText('Skipped 2');
    expect(await summaries()).toEqual(completed);
    await page.screenshot({
      path: 'docs/screenshots/v0.3.1-scan-summary.png',
      fullPage: true,
    });
  } finally {
    await Promise.allSettled(
      roots.map((id) => request.delete(`/api/roots/${id}`)),
    );
    await rm(directory, { recursive: true, force: true });
  }
});
