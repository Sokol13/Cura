/// <reference lib="dom" />
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { expect, test } from '@playwright/test';
import {
  AssetSchema,
  LibrarySchema,
  ExportManifestSchema,
  LibraryRootSchema,
  BoardDocumentSchema,
  BrandSchema,
  CmfBoardSchema,
} from '../packages/shared/src/index.js';

// Python's standard-library ZIP/CSV/SHA-256 readers independently inspect the downloaded artifact.
const inspect = String.raw`
import sys,zipfile,json,csv,io,hashlib,pathlib
with zipfile.ZipFile(sys.argv[1]) as z:
 names=z.namelist()
 assert len(names)==len(set(names)), 'Duplicate archive entries'
 assert all(not pathlib.PurePosixPath(p).is_absolute() and '..' not in pathlib.PurePosixPath(p).parts and '\\' not in p for p in names)
 manifest_name=next(p for p in names if p.endswith('/manifest.json'))
 prefix=manifest_name[:-len('manifest.json')]
 manifest=json.loads(z.read(manifest_name))
 for f in manifest['files']:
  data=z.read(prefix+f['path'])
  assert len(data)==f['size']
  assert hashlib.sha256(data).hexdigest()==f['sha256']
 version_ids={v['id'] for v in manifest['versions']}
 for asset in manifest['assets']: assert asset['currentVersionId'] in version_ids
 for v in manifest['versions']: assert prefix+v['file'] in names
 rows=list(csv.DictReader(io.StringIO(z.read(prefix+'assets.csv').decode('utf-8-sig'),newline='')))
 assert len(rows)==len(manifest['assets'])
 print(json.dumps({'manifest':manifest,'csv':rows,'entries':len(names)},ensure_ascii=False))
`;

test('offline user downloads whole and selected portable archives with complete history and pinned dependencies', async ({
  page,
  request,
  context,
}, testInfo) => {
  test.setTimeout(120_000);
  page.setDefaultTimeout(10_000);
  const directory = await mkdtemp(join(tmpdir(), 'cura-export-e2e-')),
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
    await promisify(execFile)(process.execPath, [
      fileURLToPath(
        new URL('../scripts/generate-fixtures.mjs', import.meta.url),
      ),
      directory,
      '205',
    ]);
    const library = LibrarySchema.parse(
      await (
        await request.post('/api/libraries', {
          data: { name: 'Neutral export 中文' },
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
    const root = LibraryRootSchema.parse(
      await (
        await request.post(`/api/libraries/${library.id}/roots`, {
          data: { path: directory },
        })
      ).json(),
    );
    await expect
      .poll(
        async () =>
          (
            (await (
              await request.get(`/api/libraries/${library.id}/assets`)
            ).json()) as { total: number }
          ).total,
        { timeout: 60000 },
      )
      .toBe(205);
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
    const original = await find('cura-00000-sd'),
      dependency = await find('cura-00001-comfy'),
      trashed = await find('cura-00002');
    const pin = {
      assetId: dependency.id,
      versionId: dependency.currentVersionId,
    };
    let board = BoardDocumentSchema.parse(
      await (
        await request.post(`/api/libraries/${library.id}/boards`, {
          data: { name: 'Historical pins' },
        })
      ).json(),
    );
    board = BoardDocumentSchema.parse(
      await (
        await request.post(`/api/boards/${board.board.id}/slots`, {
          data: { label: 'Final hero', expectedRevision: board.board.revision },
        })
      ).json(),
    );
    expect(
      (
        await request.put(`/api/slots/${board.slots[0]!.id}/assignment`, {
          data: { expectedRevision: 0, pin },
        })
      ).ok(),
    ).toBe(true);
    const brand = BrandSchema.parse(
      await (
        await request.post(`/api/libraries/${library.id}/brands`, {
          data: { name: '中文品牌' },
        })
      ).json(),
    );
    expect(
      (
        await request.put(`/api/brands/${brand.id}`, {
          data: {
            expectedRevision: 0,
            name: brand.name,
            guidelines: '# 保留创作\nLocal guidelines',
            colors: [{ name: '铜', hex: '#b87333' }],
            fonts: [],
            logos: [{ name: '标志', pin }],
          },
        })
      ).ok(),
    ).toBe(true);
    const cmf = CmfBoardSchema.parse(
      await (
        await request.post(`/api/libraries/${library.id}/cmf-boards`, {
          data: { name: '材料' },
        })
      ).json(),
    );
    expect(
      (
        await request.put(`/api/cmf-boards/${cmf.id}`, {
          data: {
            expectedRevision: 0,
            name: cmf.name,
            entries: [
              {
                name: '金属',
                colorName: '铜',
                hex: '#b87333',
                process: '拉丝',
                pin,
              },
            ],
          },
        })
      ).ok(),
    ).toBe(true);
    expect(
      (
        await request.patch(`/api/assets/${original.id}`, {
          data: { note: '=SUM(1,2)\n第二行,"quoted"', finalized: true },
        })
      ).ok(),
    ).toBe(true);
    expect(
      (
        await request.post(`/api/assets/${original.id}/annotations`, {
          data: {
            versionId: original.currentVersionId,
            x: 0.25,
            y: 0.5,
            text: '旧版注释',
          },
        })
      ).ok(),
    ).toBe(true);
    await page.goto('/');
    await page
      .getByRole('searchbox', { name: 'Search assets', exact: true })
      .fill('cura-00000-sd');
    await page
      .getByRole('button', { name: `Select ${original.name}`, exact: true })
      .dblclick();
    const preview = page.getByRole('dialog', { name: 'Asset preview' });
    await preview.getByLabel('Replace file', { exact: true }).setInputFiles({
      name: 'revised.png',
      mimeType: 'image/png',
      buffer: await readFile(join(directory, 'cura-00204-sd.png')),
    });
    await expect(
      preview.getByRole('button', { name: /View V2:/ }),
    ).toBeVisible();
    await preview
      .getByRole('button', { name: 'Close preview', exact: true })
      .click();
    expect(
      (
        await request.post(`/api/libraries/${library.id}/assets/batch`, {
          data: { assetIds: [trashed.id], action: 'trash' },
        })
      ).ok(),
    ).toBe(true);
    expect((await request.delete(`/api/roots/${root.id}`)).ok()).toBe(true);
    await page
      .getByRole('button', { name: 'Creative process', exact: true })
      .click();
    await page
      .getByRole('textbox', { name: 'Find an asset', exact: true })
      .fill('revised.png');
    await page
      .getByRole('combobox', { name: 'Asset timeline', exact: true })
      .selectOption(original.id);
    await page.getByRole('button', { name: 'Export', exact: true }).click();
    await page
      .getByRole('button', { name: 'Export whole library', exact: true })
      .click();
    const whole = page
      .getByRole('region', { name: 'Export: Whole library', exact: true })
      .first();
    await expect(whole.getByText('Completed', { exact: true })).toBeVisible({
      timeout: 30000,
    });
    const downloadPromise = page.waitForEvent('download');
    await whole
      .getByRole('link', { name: 'Download ZIP', exact: true })
      .click();
    const download = await downloadPromise,
      archive = join(directory, 'whole.zip');
    await download.saveAs(archive);
    const wholeResult = JSON.parse(
      (
        await promisify(execFile)('python3', ['-c', inspect, archive], {
          maxBuffer: 16 * 1024 * 1024,
        })
      ).stdout,
    ) as {
      manifest: unknown;
      csv: Array<Record<string, string>>;
      entries: number;
    };
    const manifest = ExportManifestSchema.parse(wholeResult.manifest);
    expect(manifest.assets).toHaveLength(205);
    expect(manifest.versions).toHaveLength(206);
    expect(
      manifest.assets.find((asset) => asset.id === trashed.id)?.deletedAt,
    ).toBeTruthy();
    expect(
      manifest.roots.find((item) => item.id === root.id)?.removedAt,
    ).toBeTruthy();
    expect(
      manifest.sources
        .filter((source) => source.rootId === root.id)
        .every((source) => !source.available),
    ).toBe(true);
    expect(
      manifest.versions.find(
        (version) => version.id === original.currentVersionId,
      ),
    ).toMatchObject({
      seed: '18446744073709551615',
      params: { raw: expect.anything() },
    });
    expect(manifest.annotations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          text: '旧版注释',
          versionId: original.currentVersionId,
        }),
      ]),
    );
    expect(manifest.boards.slots).toEqual(
      expect.arrayContaining([expect.objectContaining({ currentPin: pin })]),
    );
    expect(manifest.brands.brands).toHaveLength(1);
    expect(manifest.brands.cmfBoards).toHaveLength(1);
    expect(manifest.process.finalSelections).toHaveLength(2);
    expect(wholeResult.csv.find((row) => row.id === original.id)?.note).toBe(
      '\'=SUM(1,2)\n第二行,"quoted"',
    );
    await page
      .getByRole('button', { name: 'Export 1 selected asset', exact: true })
      .click();
    const selection = page
      .getByRole('region', { name: 'Export: Selected assets', exact: true })
      .first();
    await expect(selection.getByText('Completed', { exact: true })).toBeVisible(
      { timeout: 30000 },
    );
    const selectionPromise = page.waitForEvent('download');
    await selection
      .getByRole('link', { name: 'Download ZIP', exact: true })
      .click();
    const selectedDownload = await selectionPromise,
      selectedPath = join(directory, 'selected.zip');
    await selectedDownload.saveAs(selectedPath);
    const selectedResult = JSON.parse(
      (
        await promisify(execFile)('python3', ['-c', inspect, selectedPath], {
          maxBuffer: 8 * 1024 * 1024,
        })
      ).stdout,
    ) as { manifest: unknown };
    const selected = ExportManifestSchema.parse(selectedResult.manifest);
    expect(selected.requestedAssetIds).toEqual([original.id]);
    expect(selected.includedDependencyAssetIds).toEqual([dependency.id]);
    expect(selected.assets).toHaveLength(2);
    expect(selected.versions).toHaveLength(3);
    await page.reload();
    await page.getByRole('button', { name: 'Export', exact: true }).click();
    await expect(
      page.getByRole('link', { name: 'Download ZIP', exact: true }),
    ).toHaveCount(2);
    expect(external).toEqual([]);
    await testInfo.attach('portable-export-evidence.json', {
      contentType: 'application/json',
      body: Buffer.from(
        JSON.stringify(
          {
            whole: {
              assets: manifest.assets.length,
              versions: manifest.versions.length,
              verifiedFiles: manifest.files.length,
              zipEntries: wholeResult.entries,
            },
            selection: {
              assets: selected.assets.length,
              versions: selected.versions.length,
              dependencies: selected.includedDependencyAssetIds,
            },
            independentReaders: 'Python standard library zipfile/csv/hashlib',
            externalRequests: external,
          },
          null,
          2,
        ),
      ),
    });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
