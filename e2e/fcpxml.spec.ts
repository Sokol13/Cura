/// <reference lib="dom" />
import { createRequire } from 'node:module';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { expect, test } from '@playwright/test';
import {
  AssetSchema,
  LibrarySchema,
  BoardDocumentSchema,
  FcpxmlManifestSchema,
} from '../packages/shared/src/index.js';
const run = promisify(execFile);
type Encoder = {
  toFormat: (format: 'png' | 'jpeg') => Encoder;
  toBuffer: () => Promise<Buffer>;
};
const sharp = createRequire(
  new URL('../packages/server/package.json', import.meta.url),
)('sharp') as (input: Buffer) => Encoder;
test('offline FCPXML editor exports exact ordered historical media, inspected source timing and a relocated independently validated package', async ({
  page,
  request,
  context,
}, testInfo) => {
  test.setTimeout(90000);
  page.setDefaultTimeout(10000);
  const directory = await mkdtemp(join(tmpdir(), 'cura-fcp-e2e-')),
    external: string[] = [];
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
    const library = LibrarySchema.parse(
      await (
        await request.post('/api/libraries', {
          data: { name: 'FCPXML acceptance' },
        })
      ).json(),
    );
    expect(
      (
        await request.patch('/api/settings', {
          data: { activeLibraryId: library.id, language: 'en' },
        })
      ).ok(),
    ).toBe(true);
    await page.goto('/');
    const encode = (color: string, format: 'png' | 'jpeg') =>
      sharp(
        Buffer.from(
          `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="48"><rect width="64" height="48" fill="${color}"/><circle cx="32" cy="24" r="12" fill="#eeeeee"/></svg>`,
        ),
      )
        .toFormat(format)
        .toBuffer();
    const original = await encode('#c73542', 'jpeg'),
      replacement = await encode('#3857c9', 'png');
    const upload = page
      .getByLabel('Import files', { exact: true })
      .and(page.locator('input[type=file]'));
    await upload.setInputFiles({
      name: '历史 hero.jpg',
      mimeType: 'image/jpeg',
      buffer: original,
    });
    await expect(
      page.getByRole('button', { name: 'Select 历史 hero.jpg', exact: true }),
    ).toBeVisible();
    const find = async (q: string) =>
      AssetSchema.parse(
        (
          await (
            await request.get(`/api/libraries/${library.id}/assets`, {
              params: { q },
            })
          ).json()
        ).items[0],
      );
    const old = await find('历史 hero');
    expect(
      (
        await request.post(`/api/assets/${old.id}/replace?name=current.png`, {
          headers: { 'content-type': 'application/octet-stream' },
          data: replacement,
        })
      ).ok(),
    ).toBe(true);
    expect(
      (
        await request.patch(`/api/assets/${old.id}`, {
          data: { displayName: 'Readable hero.png' },
        })
      ).ok(),
    ).toBe(true);
    await upload.setInputFiles({
      name: 'short.mp4',
      mimeType: 'video/mp4',
      buffer: await readFile(
        fileURLToPath(
          new URL('./fixtures/rich/first-frame.mp4', import.meta.url),
        ),
      ),
    });
    await expect(
      page.getByRole('button', { name: 'Select short.mp4', exact: true }),
    ).toBeVisible();
    const video = await find('short');
    await upload.setInputFiles({
      name: 'unsupported.txt',
      mimeType: 'text/plain',
      buffer: Buffer.from('reference document'),
    });
    await expect(
      page.getByRole('button', { name: 'Select unsupported.txt', exact: true }),
    ).toBeVisible();
    const unsupported = await find('unsupported');
    let board = BoardDocumentSchema.parse(
      await (
        await request.post(`/api/libraries/${library.id}/boards`, {
          data: { name: 'Pinned storyboard' },
        })
      ).json(),
    );
    board = BoardDocumentSchema.parse(
      await (
        await request.post(`/api/boards/${board.board.id}/slots`, {
          data: { label: 'Historical board pin', expectedRevision: 0 },
        })
      ).json(),
    );
    expect(
      (
        await request.put(`/api/slots/${board.slots[0]!.id}/assignment`, {
          data: {
            expectedRevision: 0,
            pin: { assetId: old.id, versionId: old.currentVersionId },
          },
        })
      ).ok(),
    ).toBe(true);
    await page
      .getByRole('button', { name: 'FCPXML timeline', exact: true })
      .click();
    await expect(
      page.getByRole('heading', { name: 'FCPXML timeline' }),
    ).toBeVisible();
    await page
      .getByLabel('Timeline name', { exact: true })
      .fill('中文 & historical edit');
    await page
      .getByLabel('Project frame rate', { exact: true })
      .selectOption('24000/1001');
    await page.getByLabel('Asset', { exact: true }).selectOption(old.id);
    await page
      .getByLabel('Retained version', { exact: true })
      .selectOption(old.currentVersionId);
    await page
      .getByRole('button', { name: 'Add version', exact: true })
      .click();
    const clip = (number: number) =>
      page.getByRole('region', { name: `Clip ${number}`, exact: true });
    await clip(1).getByLabel('Duration (project frames)').fill('120');
    await page.getByLabel('Asset', { exact: true }).selectOption(video.id);
    await page
      .getByLabel('Retained version', { exact: true })
      .selectOption(video.currentVersionId);
    await page
      .getByRole('button', { name: 'Add version', exact: true })
      .click();
    await clip(2).getByLabel('Duration (project frames)').fill('12');
    await clip(2).getByLabel('In-point (source frames)').fill('1');
    await clip(2).getByRole('button', { name: 'Inspect video source' }).click();
    await expect(
      clip(2).getByText('Source: 1 fps · 2 frames · 64 × 48 · no audio'),
    ).toBeVisible();
    await page
      .getByLabel('Import board pins', { exact: true })
      .selectOption(board.board.id);
    await page.getByRole('button', { name: 'Append board pins' }).click();
    await clip(3).getByLabel('Duration (project frames)').fill('48');
    await page
      .getByRole('button', { name: 'Move clip 3 up', exact: true })
      .click();
    await expect(clip(2).getByLabel('Clip label')).toHaveValue(
      'Historical board pin',
    );
    await page.getByRole('button', { name: 'Export FCPXML package' }).click();
    const job = page.getByRole('region', {
      name: 'Export 中文 & historical edit',
      exact: true,
    });
    await expect(job.getByText('Ready', { exact: true })).toBeVisible({
      timeout: 30000,
    });
    const xmlDownload = page.waitForEvent('download');
    await job.getByRole('link', { name: 'Download local XML' }).click();
    const xml = await xmlDownload;
    const xmlPath = join(directory, 'download.fcpxml');
    await xml.saveAs(xmlPath);
    const validator = fileURLToPath(
      new URL('../scripts/validate-fcpxml.py', import.meta.url),
    );
    const localValidation = await run('python3', [validator, xmlPath]);
    const zipDownload = page.waitForEvent('download');
    await job.getByRole('link', { name: 'Download media ZIP' }).click();
    const download = await zipDownload;
    const zipPath = join(directory, 'package.zip');
    await download.saveAs(zipPath);
    const moved = join(directory, 'moved 中文 package');
    await run('python3', [
      '-c',
      "import zipfile,sys,pathlib; z=zipfile.ZipFile(sys.argv[1]); assert all(not pathlib.PurePosixPath(p).is_absolute() and '..' not in pathlib.PurePosixPath(p).parts and '\\\\' not in p for p in z.namelist()); z.extractall(sys.argv[2])",
      zipPath,
      moved,
    ]);
    await run(process.execPath, [join(moved, 'relink.mjs')]);
    const validated = await run('python3', [
      validator,
      join(moved, 'timeline.fcpxml'),
      '--package',
      moved,
    ]);
    const manifest = FcpxmlManifestSchema.parse(
      JSON.parse(await readFile(join(moved, 'manifest.json'), 'utf8')),
    );
    expect(manifest.timeline.clips.map((c) => c.versionId)).toEqual([
      old.currentVersionId,
      old.currentVersionId,
      video.currentVersionId,
    ]);
    expect(manifest.duration).toBe('3003/400s');
    expect(manifest.media).toHaveLength(2);
    const historical = manifest.media.find(
      (m) => m.versionId === old.currentVersionId,
    )!;
    expect(historical.name).toBe('Readable hero.jpg');
    expect(historical.hash).toBe(
      createHash('sha256').update(original).digest('hex'),
    );
    expect(await readFile(join(moved, historical.path))).toEqual(original);
    await testInfo.attach('fcpxml-independent-evidence', {
      body: JSON.stringify(
        {
          local: JSON.parse(localValidation.stdout),
          relocated: JSON.parse(validated.stdout),
          manifest,
        },
        null,
        2,
      ),
      contentType: 'application/json',
    });
    await page.locator('.fcpxml-workspace').evaluate((element) => {
      element.scrollTop = 0;
    });
    await page.screenshot({
      path: testInfo.outputPath('fcpxml-timeline.png'),
      fullPage: true,
    });
    await page.reload();
    await expect(
      page
        .getByRole('region', {
          name: 'Export 中文 & historical edit',
          exact: true,
        })
        .getByText('Ready', { exact: true }),
    ).toBeVisible();
    await page
      .getByRole('button', { name: 'Load timeline for editing', exact: true })
      .click();
    await expect(clip(3).getByLabel('In-point (source frames)')).toHaveValue(
      '1',
    );
    await page.getByRole('button', { name: 'Clear timeline' }).click();
    await page
      .getByLabel('Timeline name', { exact: true })
      .fill('Unsupported source');
    await page
      .getByLabel('Asset', { exact: true })
      .selectOption(unsupported.id);
    await page
      .getByLabel('Retained version', { exact: true })
      .selectOption(unsupported.currentVersionId);
    await page
      .getByRole('button', { name: 'Add version', exact: true })
      .click();
    await page.getByRole('button', { name: 'Export FCPXML package' }).click();
    const failed = page.getByRole('region', {
      name: 'Export Unsupported source',
      exact: true,
    });
    await expect(
      failed.getByText('Export failed', { exact: true }),
    ).toBeVisible();
    await expect(failed.getByText(/Import a PNG\/JPEG still/)).toBeVisible();
    await expect(
      failed.getByRole('link', { name: 'Download media ZIP' }),
    ).toHaveCount(0);
    expect(
      (
        await request.patch('/api/settings', { data: { language: 'zh-CN' } })
      ).ok(),
    ).toBe(true);
    await page.reload();
    await expect(
      page.getByRole('heading', { name: 'FCPXML 时间线', exact: true }),
    ).toBeVisible();
    await expect(page.getByLabel('项目帧率', { exact: true })).toBeVisible();
    expect(external).toEqual([]);
    await testInfo.attach('offline-attempts', {
      body: JSON.stringify(external),
      contentType: 'application/json',
    });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
