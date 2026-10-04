/// <reference lib="dom" />
/// <reference lib="dom.iterable" />
import { createRequire } from 'node:module';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import {
  AssetPageSchema,
  AssetSchema,
  BrandPackageSchema,
  BrandsSchema,
  CmfBoardsSchema,
  LibrarySchema,
} from '../packages/shared/src/index.js';
const requireWeb = createRequire(
  new URL('../packages/web/package.json', import.meta.url),
);
const sharp = createRequire(
  new URL('../packages/server/package.json', import.meta.url),
)('sharp') as (input: Buffer) => {
  png: () => { toBuffer: () => Promise<Buffer> };
};
// Original triangle glyph drawn for this test; generated with FontBuilder, covered by repository MIT license.
const fontBytes = Buffer.from(
  'AAEAAAAKAIAAAwAgT1MvMkUARDUAAAEoAAAAYGNtYXAAdABcAAABkAAAADxnbHlmxtUZSwAAAdQAAAAiaGVhZC88GV4AAACsAAAANmhoZWEE2gIyAAAA5AAAACRobXR4AlgAAAAAAYgAAAAIbG9jYQAAABEAAAHMAAAACG1heHAABQAIAAABCAAAACBuYW1lP0aG3wAAAfgAAAHUcG9zdAAIACQAAAPMAAAAKAABAAAAAQAAoYKYm18PPPUAAQPoAAAAAObn6tcAAAAA5ufq1wBQAAACCALQAAAAAwACAAAAAAAAAAEAAAMg/zgAAAJYAAAAoAG4AAEAAAAAAAAAAAAAAAAAAAABAAEAAAADAAYAAQAAAAAAAgAAAAAAAAAAAAAAAAAAAAAAAwJYAZAABQAEAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAPz8/PwAAACAAQQMg/zgAAAMgAMgAAAAAAAAAAAAAAAAAAAAgAAACWAAAAAAAAAAAAAIAAAADAAAAFAADAAEAAAAUAAQAKAAAAAYABAABAAIAIABB//8AAAAgAEH////h/8EAAQAAAAAAAAAAAAAAAAARAAEAUAAAAggC0AAFAAAzExMjAwNQ3Nx4ZGQC0P0wAZD+cAAAAAAADACWAAEAAAAAAAEAEgAAAAEAAAAAAAIABwASAAEAAAAAAAMAFAAZAAEAAAAAAAQAGgAtAAEAAAAAAAUACwBHAAEAAAAAAAYAGABSAAMAAQQJAAEAJABqAAMAAQQJAAIADgCOAAMAAQQJAAMAKACcAAMAAQQJAAQANADEAAMAAQQJAAUAFgD4AAMAAQQJAAYAMAEOQ3VyYSBUZXN0IFRyaWFuZ2xlUmVndWxhckN1cmEgVGVzdCBUcmlhbmdsZSAxQ3VyYSBUZXN0IFRyaWFuZ2xlIFJlZ3VsYXJWZXJzaW9uIDEuMEN1cmFUZXN0VHJpYW5nbGUtUmVndWxhcgBDAHUAcgBhACAAVABlAHMAdAAgAFQAcgBpAGEAbgBnAGwAZQBSAGUAZwB1AGwAYQByAEMAdQByAGEAIABUAGUAcwB0ACAAVAByAGkAYQBuAGcAbABlACAAMQBDAHUAcgBhACAAVABlAHMAdAAgAFQAcgBpAGEAbgBnAGwAZQAgAFIAZQBnAHUAbABhAHIAVgBlAHIAcwBpAG8AbgAgADEALgAwAEMAdQByAGEAVABlAHMAdABUAHIAaQBhAG4AZwBsAGUALQBSAGUAZwB1AGwAYQByAAIAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAwAAAAMAJA==',
  'base64',
);

test('brand and CMF workflows retain version pins and export meaningful offline HTML PDF JSON and ASE', async ({
  page,
  request,
  context,
  browser,
}, testInfo) => {
  test.setTimeout(150_000);
  page.setDefaultTimeout(12_000);
  const outside: string[] = [];
  await context.route('**/*', async (route) => {
    if (new URL(route.request().url()).hostname === '127.0.0.1')
      await route.continue();
    else {
      outside.push(route.request().url());
      await route.abort();
    }
  });
  await context.routeWebSocket('**/*', (socket) => {
    if (new URL(socket.url()).hostname === '127.0.0.1')
      socket.connectToServer();
    else {
      outside.push(socket.url());
      socket.close();
    }
  });
  const directory = await mkdtemp(join(tmpdir(), 'cura-brand-e2e-'));
  let rootId = '';
  try {
    const orange = await sharp(
      Buffer.from(
        '<svg xmlns="http://www.w3.org/2000/svg" width="300" height="140"><rect width="300" height="140" fill="#ff8000"/><circle cx="80" cy="70" r="35" fill="#1c55a1"/></svg>',
      ),
    )
      .png()
      .toBuffer();
    const blue = await sharp(
      Buffer.from(
        '<svg xmlns="http://www.w3.org/2000/svg" width="300" height="140"><rect width="300" height="140" fill="#2266cc"/><rect x="30" y="30" width="60" height="60" fill="#ffffff"/></svg>',
      ),
    )
      .png()
      .toBuffer();
    await writeFile(join(directory, 'original-logo.png'), orange);
    const library = LibrarySchema.parse(
      await (
        await request.post('/api/libraries', {
          data: { name: 'Brands acceptance' },
        })
      ).json(),
    );
    await request.patch('/api/settings', {
      data: { activeLibraryId: library.id, language: 'en' },
    });
    const root = await request.post(`/api/libraries/${library.id}/roots`, {
      data: { path: directory },
    });
    expect(root.status()).toBe(201);
    rootId = ((await root.json()) as { id: string }).id;
    await expect
      .poll(
        async () =>
          AssetPageSchema.parse(
            await (
              await request.get(`/api/libraries/${library.id}/assets`)
            ).json(),
          ).total,
      )
      .toBe(1);
    const logo = AssetPageSchema.parse(
      await (await request.get(`/api/libraries/${library.id}/assets`)).json(),
    ).items[0]!;
    const second = AssetSchema.parse(
      await (
        await request.post(
          `/api/libraries/${library.id}/upload?name=blue-logo.png`,
          {
            data: blue,
            headers: { 'content-type': 'application/octet-stream' },
          },
        )
      ).json(),
    );
    await page.goto('/');
    await page
      .getByRole('button', { name: 'Brands & CMF', exact: true })
      .click();
    await page.getByRole('button', { name: 'New brand', exact: true }).click();
    let dialog = page.getByRole('dialog', { name: 'New brand', exact: true });
    await dialog.getByLabel('Name', { exact: true }).fill('山海品牌');
    await dialog.getByRole('button', { name: 'Create', exact: true }).click();
    await expect(page.getByLabel('Name', { exact: true })).toHaveValue(
      '山海品牌',
    );
    await page.getByRole('button', { name: 'Add color', exact: true }).click();
    const colors = page
      .locator('.brand-card')
      .filter({ has: page.getByLabel('Color name', { exact: true }) });
    await colors.nth(0).getByLabel('Color name', { exact: true }).fill('暖橙');
    await colors
      .nth(0)
      .getByRole('combobox', { name: 'Color format', exact: true })
      .selectOption('RGB');
    await colors
      .nth(0)
      .getByLabel('Color value', { exact: true })
      .fill('255, 128, 0');
    await page.getByRole('button', { name: 'Add color', exact: true }).click();
    await colors.nth(1).getByLabel('Color name', { exact: true }).fill('墨黑');
    await colors
      .nth(1)
      .getByRole('combobox', { name: 'Color format', exact: true })
      .selectOption('CMYK');
    await colors
      .nth(1)
      .getByLabel('Color value', { exact: true })
      .fill('0, 0, 0, 100');
    await colors
      .nth(1)
      .getByRole('button', { name: 'Move up', exact: true })
      .click();
    await page
      .getByRole('button', { name: 'Register font', exact: true })
      .click();
    dialog = page.getByRole('dialog', { name: 'Choose asset version' });
    await dialog
      .getByLabel('Import font or sample', { exact: true })
      .setInputFiles({
        name: 'cura-test-triangle.ttf',
        mimeType: 'font/ttf',
        buffer: fontBytes,
      });
    await expect(
      dialog.getByRole('combobox', { name: 'Version', exact: true }),
    ).not.toHaveValue('');
    await dialog
      .getByRole('button', { name: 'Use this version', exact: true })
      .click();
    await page.getByLabel('Font name', { exact: true }).fill('主字体');
    await page
      .getByLabel('Font role', { exact: true })
      .fill('Headlines / 标题');
    for (const [assetId, name] of [
      [logo.id, '横版'],
      [second.id, '单色'],
    ]) {
      await page
        .getByRole('button', { name: 'Add logo variant', exact: true })
        .click();
      dialog = page.getByRole('dialog', { name: 'Choose asset version' });
      await dialog
        .getByRole('combobox', { name: 'Asset', exact: true })
        .selectOption(assetId!);
      await expect(
        dialog.getByRole('combobox', { name: 'Version', exact: true }),
      ).not.toHaveValue('');
      await dialog
        .getByRole('button', { name: 'Use this version', exact: true })
        .click();
      await page.getByLabel('Variant name', { exact: true }).last().fill(name!);
    }
    const guidelines =
      '# 品牌使用规范\n**保留留白**\n<script>window.PWNED=true</script>\n![远程](https://example.invalid/tracking.png)\n' +
      Array.from(
        { length: 120 },
        (_, index) =>
          `- 第 ${index + 1} 条：保持图形比例与中文排版，使用批准的品牌颜色。`,
      ).join('\n') +
      '\n最后一条：完整保留规范。';
    await page
      .getByRole('textbox', {
        name: 'Usage guidelines (Markdown)',
        exact: true,
      })
      .fill(guidelines);
    await page.getByText('Guidelines preview', { exact: true }).click();
    expect(await page.evaluate(() => Reflect.has(window, 'PWNED'))).toBe(false);
    await page.getByRole('button', { name: 'Save kit', exact: true }).click();
    await expect(page.getByRole('status')).toHaveText('Saved');
    const brand = BrandsSchema.parse(
      await (await request.get(`/api/libraries/${library.id}/brands`)).json(),
    )[0]!;
    expect(brand.colors.map((color) => color.hex)).toEqual([
      '#000000',
      '#ff8000',
    ]);
    const replacement = await request.post(
      `/api/assets/${logo.id}/replace?name=replaced.png`,
      { data: blue, headers: { 'content-type': 'application/octet-stream' } },
    );
    expect(replacement.status()).toBe(200);
    expect(await readFile(join(directory, 'original-logo.png'))).toEqual(
      orange,
    );
    const downloads = new Map<string, Buffer>();
    for (const format of ['HTML', 'JSON', 'ASE', 'PDF']) {
      const waiting = page.waitForEvent('download');
      await page
        .getByRole('button', { name: `Export ${format}`, exact: true })
        .click();
      const download = await waiting;
      const path = await download.path();
      expect(path).not.toBeNull();
      downloads.set(format, await readFile(path!));
    }
    const portable = BrandPackageSchema.parse(
      JSON.parse(downloads.get('JSON')!.toString('utf8')),
    );
    expect(portable.brand.logos[0]?.pin.versionId).toBe(logo.currentVersionId);
    expect(
      Buffer.from(
        portable.files.find((file) => file.versionId === logo.currentVersionId)!
          .base64,
        'base64',
      ),
    ).toEqual(orange);
    expect(
      Buffer.from(
        portable.files.find((file) => file.name === 'cura-test-triangle.ttf')!
          .base64,
        'base64',
      ),
    ).toEqual(fontBytes);
    expect(portable.brand.guidelines).toBe(guidelines);
    const ase = downloads.get('ASE')!,
      view = new DataView(ase.buffer, ase.byteOffset, ase.byteLength);
    expect(view.getUint32(8)).toBe(2);
    let offset = 12;
    for (const expected of portable.brand.colors) {
      expect(view.getUint16(offset)).toBe(1);
      const length = view.getUint32(offset + 2),
        chars = view.getUint16(offset + 6);
      let name = '';
      for (let index = 0; index < chars - 1; index++)
        name += String.fromCharCode(view.getUint16(offset + 8 + index * 2));
      expect(name).toBe(expected.name);
      const rgb = offset + 8 + chars * 2 + 4;
      expected.rgb.forEach((channel, index) =>
        expect(view.getFloat32(rgb + index * 4)).toBeCloseTo(channel / 255, 5),
      );
      offset += length + 6;
    }
    expect(offset).toBe(ase.length);
    const offline = await browser.newContext();
    const attempts: string[] = [];
    await offline.route('**/*', async (route) => {
      attempts.push(route.request().url());
      await route.abort();
    });
    const document = await offline.newPage();
    const htmlPath = testInfo.outputPath('portable-brand.html');
    await writeFile(htmlPath, downloads.get('HTML')!);
    // The managed test browser blocks file:/data: navigation; render the exact exported bytes in an isolated offline document.
    await document.setContent((await readFile(htmlPath)).toString('utf8'));
    await expect(
      document.getByRole('heading', { name: '山海品牌', exact: true }),
    ).toBeVisible();
    await expect(
      document.getByText('最后一条：完整保留规范。', { exact: true }),
    ).toBeVisible();
    expect(
      await document.locator('img').evaluateAll(async (images) => {
        await Promise.all(
          images.map((image) => (image as HTMLImageElement).decode()),
        );
        return images.length;
      }),
    ).toBe(2);
    expect(
      await document.evaluate(async () => {
        await window.document.fonts.load('20px cura-font-0', 'A');
        return (
          window.document.fonts.check('20px cura-font-0', 'A') &&
          [...window.document.fonts].some(
            (font) => font.family === 'cura-font-0' && font.status === 'loaded',
          )
        );
      }),
    ).toBe(true);
    expect(await document.evaluate(() => Reflect.has(window, 'PWNED'))).toBe(
      false,
    );
    expect(attempts).toEqual([]);
    await offline.close();
    for (const [url, module] of [
      ['/__brand-test/pdf.mjs', 'pdfjs-dist/build/pdf.mjs'],
      ['/__brand-test/pdf.worker.mjs', 'pdfjs-dist/build/pdf.worker.mjs'],
    ])
      await context.route(`**${url}`, (route) =>
        route.fulfill({
          contentType: 'text/javascript',
          path: requireWeb.resolve(module!),
        }),
      );
    const pdfResult = await page.evaluate(async (base64) => {
      const modulePath = '/__brand-test/pdf.mjs';
      const pdf = (await import(modulePath)) as {
        GlobalWorkerOptions: { workerSrc: string };
        getDocument: (input: {
          data: Uint8Array;
          isEvalSupported: boolean;
        }) => {
          promise: Promise<{
            numPages: number;
            getPage: (number: number) => Promise<{
              getViewport: (options: { scale: number }) => {
                width: number;
                height: number;
              };
              render: (options: {
                canvas: HTMLCanvasElement;
                canvasContext: CanvasRenderingContext2D;
                viewport: { width: number; height: number };
              }) => { promise: Promise<void> };
            }>;
            destroy: () => Promise<void>;
          }>;
        };
      };
      pdf.GlobalWorkerOptions.workerSrc = '/__brand-test/pdf.worker.mjs';
      const data = Uint8Array.from(atob(base64), (character) =>
        character.charCodeAt(0),
      );
      const document = await pdf.getDocument({ data, isEvalSupported: false })
        .promise;
      const counts = [];
      for (let index = 1; index <= document.numPages; index++) {
        const page = await document.getPage(index),
          viewport = page.getViewport({ scale: 1 }),
          canvas = window.document.createElement('canvas');
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        const ctx = canvas.getContext('2d')!;
        await page.render({ canvas, canvasContext: ctx, viewport }).promise;
        const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
        let dark = 0,
          orange = 0,
          blue = 0;
        for (let pixel = 0; pixel < pixels.length; pixel += 4) {
          const r = pixels[pixel]!,
            g = pixels[pixel + 1]!,
            b = pixels[pixel + 2]!;
          if (r < 150 && g < 150 && b < 150) dark++;
          if (r > 180 && g > 60 && g < 190 && b < 60) orange++;
          if (b > 130 && r < 90) blue++;
        }
        counts.push({ dark, orange, blue });
      }
      await document.destroy();
      return counts;
    }, downloads.get('PDF')!.toString('base64'));
    expect(pdfResult.length).toBeGreaterThanOrEqual(3);
    for (const result of pdfResult) expect(result.dark).toBeGreaterThan(100);
    expect(
      pdfResult.reduce((sum, result) => sum + result.orange, 0),
    ).toBeGreaterThan(1000);
    expect(
      pdfResult.reduce((sum, result) => sum + result.blue, 0),
    ).toBeGreaterThan(1000);
    await page.reload();
    await expect(page.getByLabel('Name', { exact: true })).toHaveValue(
      '山海品牌',
    );
    expect(
      BrandsSchema.parse(
        await (await request.get(`/api/libraries/${library.id}/brands`)).json(),
      )[0]?.logos[0]?.pin.versionId,
    ).toBe(logo.currentVersionId);
    await page.getByRole('tab', { name: 'CMF boards', exact: true }).click();
    await page
      .getByRole('button', { name: 'New CMF board', exact: true })
      .click();
    dialog = page.getByRole('dialog', { name: 'New CMF board', exact: true });
    await dialog.getByLabel('Name', { exact: true }).fill('材质与工艺');
    await dialog.getByRole('button', { name: 'Create', exact: true }).click();
    for (const name of ['阳极铝材', '磨砂塑料']) {
      await page
        .getByRole('button', { name: 'Add material sample', exact: true })
        .click();
      dialog = page.getByRole('dialog', { name: 'Choose asset version' });
      await dialog
        .getByRole('combobox', { name: 'Asset', exact: true })
        .selectOption(logo.id);
      await expect(
        dialog.getByRole('combobox', { name: 'Version', exact: true }),
      ).not.toHaveValue('');
      await dialog
        .getByRole('combobox', { name: 'Version', exact: true })
        .selectOption(logo.currentVersionId);
      await dialog
        .getByRole('button', { name: 'Use this version', exact: true })
        .click();
      await page.getByLabel('Material name', { exact: true }).last().fill(name);
      await page
        .getByRole('textbox', {
          name: 'Manufacturing / process notes',
          exact: true,
        })
        .last()
        .fill('喷砂后阳极氧化');
    }
    await page
      .locator('.cmf-card')
      .nth(1)
      .getByRole('button', { name: 'Move up', exact: true })
      .click();
    await page
      .getByRole('button', { name: 'Save CMF board', exact: true })
      .click();
    await expect(page.getByRole('status')).toHaveText('Saved');
    await page.reload();
    await page.getByRole('tab', { name: 'CMF boards', exact: true }).click();
    await expect(
      page.getByLabel('Material name', { exact: true }).first(),
    ).toHaveValue('磨砂塑料');
    await page
      .getByRole('textbox', {
        name: 'Manufacturing / process notes',
        exact: true,
      })
      .first()
      .fill('纹理修订');
    await page
      .locator('.cmf-card')
      .nth(1)
      .getByRole('button', { name: 'Remove', exact: true })
      .click();
    await page
      .getByRole('button', { name: 'Save CMF board', exact: true })
      .click();
    await expect(page.getByRole('status')).toHaveText('Saved');
    const cmf = CmfBoardsSchema.parse(
      await (
        await request.get(`/api/libraries/${library.id}/cmf-boards`)
      ).json(),
    )[0]!;
    expect(cmf.entries).toHaveLength(1);
    expect(cmf.entries[0]?.process).toBe('纹理修订');
    expect(cmf.entries[0]?.pin.versionId).toBe(logo.currentVersionId);
    expect(await readFile(join(directory, 'original-logo.png'))).toEqual(
      orange,
    );
    expect(outside).toEqual([]);
    await page.getByRole('button', { name: 'Delete', exact: true }).click();
    await page
      .getByRole('dialog', { name: 'Delete', exact: true })
      .getByRole('button', { name: 'Delete', exact: true })
      .click();
    await expect
      .poll(
        async () =>
          CmfBoardsSchema.parse(
            await (
              await request.get(`/api/libraries/${library.id}/cmf-boards`)
            ).json(),
          ).length,
      )
      .toBe(0);
    await page.getByRole('tab', { name: 'Brand kits', exact: true }).click();
    await page.getByLabel('Name', { exact: true }).fill('山海品牌修订');
    await page
      .locator('.brand-card')
      .filter({ has: page.getByLabel('Color name', { exact: true }) })
      .first()
      .getByRole('button', { name: 'Remove', exact: true })
      .click();
    await page
      .locator('.brand-card')
      .filter({ has: page.getByLabel('Font name', { exact: true }) })
      .getByRole('button', { name: 'Remove', exact: true })
      .click();
    await page
      .locator('.brand-card')
      .filter({ has: page.getByLabel('Variant name', { exact: true }) })
      .first()
      .getByRole('button', { name: 'Remove', exact: true })
      .click();
    await page.getByRole('button', { name: 'Save kit', exact: true }).click();
    await expect(page.getByRole('status')).toHaveText('Saved');
    const edited = BrandsSchema.parse(
      await (await request.get(`/api/libraries/${library.id}/brands`)).json(),
    )[0]!;
    expect(edited.name).toBe('山海品牌修订');
    expect([
      edited.colors.length,
      edited.fonts.length,
      edited.logos.length,
    ]).toEqual([1, 0, 1]);
    await page.getByRole('button', { name: 'Delete', exact: true }).click();
    await page
      .getByRole('dialog', { name: 'Delete', exact: true })
      .getByRole('button', { name: 'Delete', exact: true })
      .click();
    await expect
      .poll(
        async () =>
          BrandsSchema.parse(
            await (
              await request.get(`/api/libraries/${library.id}/brands`)
            ).json(),
          ).length,
      )
      .toBe(0);
    expect((await request.get(`/api/assets/${logo.id}`)).status()).toBe(200);
    expect(await readFile(join(directory, 'original-logo.png'))).toEqual(
      orange,
    );
    await request.patch('/api/settings', {
      data: { language: 'zh-CN', theme: 'light' },
    });
    await page.reload();
    await expect(
      page.getByRole('heading', { name: '品牌与CMF', exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole('button', { name: '新建品牌', exact: true }),
    ).toBeVisible();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
    await testInfo.attach('brand-export-evidence.json', {
      body: JSON.stringify(
        {
          formats: [...downloads.keys()],
          pdfPages: pdfResult,
          originalUnchanged: true,
          pinnedOldVersion: true,
          externalRequests: outside,
          independentHtmlRequests: attempts,
          htmlVerification:
            'Exact downloaded file bytes rendered with setContent in a fresh context; managed browser disallows top-level file/data navigation. All network blocked.',
        },
        null,
        2,
      ),
      contentType: 'application/json',
    });
  } finally {
    if (rootId)
      await request.delete(`/api/roots/${rootId}`).catch(() => undefined);
    await rm(directory, { recursive: true, force: true });
  }
});
