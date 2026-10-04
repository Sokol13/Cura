import { execFile } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { expect, test } from '@playwright/test';
import {
  AssetSchema,
  ExportManifestSchema,
  LibrarySchema,
} from '../packages/shared/src/index.js';

test('catalog selection opens an isolated export dialog and downloads only selected assets', async ({
  page,
  request,
}) => {
  const directory = await mkdtemp(join(tmpdir(), 'cura-selection-export-'));
  try {
    const created = await request.post('/api/libraries', {
      data: { name: 'Selected export' },
    });
    expect(created.status()).toBe(201);
    const library = LibrarySchema.parse(await created.json());
    const imported = [];
    for (const [name, color] of [
      ['chosen.svg', 'red'],
      ['other.svg', 'blue'],
    ]) {
      const response = await request.post(
        `/api/libraries/${library.id}/upload?name=${name}`,
        {
          headers: { 'content-type': 'application/octet-stream' },
          data: Buffer.from(
            `<svg xmlns="http://www.w3.org/2000/svg" width="40" height="30"><rect width="40" height="30" fill="${color}"/></svg>`,
          ),
        },
      );
      expect(response.status()).toBe(201);
      imported.push(AssetSchema.parse(await response.json()));
    }
    await request.patch('/api/settings', {
      data: { activeLibraryId: library.id, language: 'en' },
    });
    await page.goto('/');
    await page
      .getByRole('button', { name: 'Select chosen.svg', exact: true })
      .click();
    const launcher = page.getByRole('button', {
      name: 'Export selected assets',
      exact: true,
    });
    await launcher.click();
    const dialog = page.getByRole('dialog', {
      name: 'Neutral export',
      exact: true,
    });
    await expect(dialog).toBeVisible();
    await page.keyboard.press('Delete');
    const unchanged = AssetSchema.parse(
      await (await request.get(`/api/assets/${imported[0]!.id}`)).json(),
    );
    expect(unchanged.deletedAt).toBeNull();
    await dialog
      .getByRole('button', { name: 'Export 1 selected asset', exact: true })
      .click();
    const link = dialog.getByRole('link', {
      name: 'Download ZIP',
      exact: true,
    });
    await expect(link).toBeVisible();
    const downloadPromise = page.waitForEvent('download');
    await link.click();
    const archive = join(directory, 'selection.zip');
    await (await downloadPromise).saveAs(archive);
    const inspection = await promisify(execFile)('python3', [
      '-c',
      "import json,sys,zipfile; z=zipfile.ZipFile(sys.argv[1]); p=next(p for p in z.namelist() if p.endswith('/manifest.json')); print(z.read(p).decode('utf-8'))",
      archive,
    ]);
    const manifest = ExportManifestSchema.parse(JSON.parse(inspection.stdout));
    expect(manifest.requestedAssetIds).toEqual([imported[0]!.id]);
    expect(manifest.assets.map((asset) => asset.id)).toEqual([imported[0]!.id]);
    expect(manifest.versions).toHaveLength(1);
    await page.keyboard.press('Escape');
    await expect(dialog).not.toBeVisible();
    await expect(launcher).toBeFocused();
    await expect(
      page.getByRole('button', { name: 'Select other.svg', exact: true }),
    ).toBeVisible();
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
