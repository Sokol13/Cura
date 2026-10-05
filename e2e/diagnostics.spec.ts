import { randomUUID } from 'node:crypto';
import {
  mkdir,
  mkdtemp,
  readFile,
  rename,
  rm,
  writeFile,
} from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import {
  DiagnosticLogSchema,
  DiagnosticsSchema,
  ErrorResponseSchema,
  LibraryRootSchema,
  LibrarySchema,
  ScanSummariesSchema,
} from '../packages/shared/src/index.js';
import {
  createMetadataPng,
  textChunk,
} from '../packages/server/test/media-fixtures.js';

// Use the server's declared ZIP dependency without adding a root dependency.
const require = createRequire(
  new URL('../packages/server/package.json', import.meta.url),
);
const { unzipSync } = require('fflate') as {
  unzipSync: (bytes: Uint8Array) => Record<string, Uint8Array>;
};

test('Settings downloads actionable diagnostics with scan, thumbnail and metadata warnings but no private paths', async ({
  page,
  request,
}) => {
  const directory = await mkdtemp(join(tmpdir(), 'cura-diagnostics-browser-'));
  const privateToken = `private-client-${randomUUID()}`;
  const watched = join(directory, privateToken);
  const moved = join(directory, `${privateToken}-moved`);
  const corruptName = `${privateToken}-broken.png`;
  const metadataName = `${privateToken}-metadata.png`;
  let rootId: string | undefined;
  try {
    await mkdir(watched);
    await Promise.all([
      writeFile(
        join(watched, `${privateToken}-art.svg`),
        '<svg xmlns="http://www.w3.org/2000/svg" width="80" height="60"><rect width="80" height="60" fill="orange"/></svg>',
      ),
      writeFile(join(watched, corruptName), `Not a PNG: ${privateToken}`),
      writeFile(
        join(watched, metadataName),
        createMetadataPng(textChunk('prompt', `{"${privateToken}":`)),
      ),
    ]);
    const created = await request.post('/api/libraries', {
      data: { name: privateToken },
    });
    expect(created.status()).toBe(201);
    const library = LibrarySchema.parse(await created.json());
    const preferences = await request.patch('/api/settings', {
      data: { language: 'en', theme: 'dark', activeLibraryId: library.id },
    });
    expect(preferences.ok()).toBeTruthy();
    const registered = await request.post(
      `/api/libraries/${library.id}/roots`,
      {
        data: { path: watched },
      },
    );
    expect(registered.ok()).toBeTruthy();
    const root = LibraryRootSchema.parse(await registered.json());
    rootId = root.id;
    const latestScan = async () => {
      const response = await request.get(`/api/libraries/${library.id}/scans`);
      expect(response.status()).toBe(200);
      return ScanSummariesSchema.parse(await response.json()).find(
        (scan) => scan.rootId === root.id,
      );
    };
    await expect
      .poll(async () => (await latestScan())?.status)
      .toBe('completed');
    const firstScan = await latestScan();
    expect(firstScan).toMatchObject({
      supportedFound: 3,
      processed: 3,
      succeeded: 3,
    });

    await page.goto('/');
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Settings', exact: true });
    await expect(dialog).toBeVisible();
    await dialog
      .getByRole('button', { name: 'Close', exact: true })
      .last()
      .click();
    await rename(watched, moved);
    const rescanned = await request.post(`/api/libraries/${library.id}/rescan`);
    // Existing watchers enqueue asynchronously; a watcher already closed by the
    // missing directory reports ENOENT immediately. Both must persist failure.
    expect([200, 404]).toContain(rescanned.status());
    if (rescanned.status() === 404)
      expect(ErrorResponseSchema.parse(await rescanned.json()).code).toBe(
        'ENOENT',
      );
    await expect
      .poll(async () => {
        const scan = await latestScan();
        return {
          status: scan?.status,
          changed: scan?.scanId !== firstScan?.scanId,
        };
      })
      .toEqual({ status: 'failed', changed: true });
    const failedScan = await latestScan();
    expect(failedScan?.readErrors).toBeGreaterThan(0);

    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    const downloaded = page.waitForEvent('download');
    await dialog
      .getByRole('link', { name: 'Export diagnostic logs', exact: true })
      .click();
    const download = await downloaded;
    expect(download.suggestedFilename()).toBe('cura-diagnostics.zip');
    const archivePath = join(directory, 'diagnostics.zip');
    await download.saveAs(archivePath);
    const entries = unzipSync(await readFile(archivePath));
    expect(Object.keys(entries).sort()).toEqual([
      'diagnostics.json',
      'logs.json',
    ]);
    const readJson = (name: string): unknown => {
      const bytes = entries[name];
      if (!bytes) throw new Error(`Diagnostic ZIP is missing ${name}`);
      return JSON.parse(Buffer.from(bytes).toString('utf8')) as unknown;
    };
    const diagnostics = DiagnosticsSchema.parse(readJson('diagnostics.json'));
    const logs = DiagnosticLogSchema.array()
      .max(200)
      .parse(readJson('logs.json'));
    const rootScan = diagnostics.rootScanSummaries.find(
      (entry) => entry.rootId === root.id,
    );
    expect(rootScan).toMatchObject({
      rootId: root.id,
      libraryId: library.id,
      capture: { status: 'ok' },
      latestScanSummary: {
        scanId: failedScan?.scanId,
        status: 'failed',
        phase: 'finished',
      },
    });
    expect(rootScan?.latestScanSummary?.readErrors).toBeGreaterThan(0);
    expect(rootScan?.latestScanSummary?.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ relativePath: null, code: 'ENOENT' }),
      ]),
    );
    expect(
      diagnostics.rootScanSummaries.every(
        (entry) =>
          entry.latestScanSummary?.errors.every(
            (error) => error.relativePath === null,
          ) ?? true,
      ),
    ).toBe(true);
    for (const [operation, code] of [
      ['thumbnail', 'NATIVE_THUMBNAIL_FAILED'],
      ['metadata', 'METADATA_PARSE_WARNINGS'],
      ['scan', 'SCAN_FAILED'],
    ]) {
      expect(logs).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            operation,
            code,
            rootId: root.id,
            libraryId: library.id,
          }),
        ]),
      );
    }
    expect(logs.every((entry) => entry.level >= 40)).toBe(true);
    expect(diagnostics.mediaQueue).toMatchObject({
      capacity: 64,
      closed: false,
      workerFailed: false,
      acceptingWork: true,
    });
    expect(diagnostics.previewStates?.total).toBeGreaterThanOrEqual(3);
    expect(diagnostics.previewStates?.ready).toBeGreaterThanOrEqual(2);
    expect(diagnostics.integrity).toMatchObject({
      status: 'ok',
      integrityCheck: 'ok',
      foreignKeyCheck: 'ok',
      issues: [],
      truncated: false,
    });
    expect(diagnostics.pathsRedacted).toBe(true);
    expect(
      Object.values(diagnostics.capture).every(
        (section) => section.status === 'ok',
      ),
    ).toBe(true);
    const serialized = Object.values(entries)
      .map((bytes) => Buffer.from(bytes).toString('utf8'))
      .join('\n');
    for (const privateValue of [
      privateToken,
      directory,
      watched,
      moved,
      corruptName,
      metadataName,
    ])
      expect(serialized).not.toContain(privateValue);
  } finally {
    try {
      if (rootId) await request.delete(`/api/roots/${rootId}`);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }
});
