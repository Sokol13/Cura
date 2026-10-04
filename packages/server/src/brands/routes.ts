import { createHash } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import { relative } from 'node:path';
import type { FastifyInstance } from 'fastify';
import * as S from '@cura/shared';
import type { AppDatabase } from '../database.js';
import { CatalogError, type CatalogStore } from '../catalog-store.js';
import type { UserPaths } from '../paths.js';
import { resolveContained } from '../media/path-utils.js';
import { BrandStore } from './store.js';

const param = (params: unknown, key: string) =>
  S.IdSchema.parse((params as Record<string, unknown>)[key]);
export function registerBrandRoutes(
  app: FastifyInstance,
  database: AppDatabase,
  catalog: CatalogStore,
  paths: UserPaths,
): void {
  const store = new BrandStore(database);
  app.get('/api/libraries/:libraryId/brands', (request) =>
    S.BrandsSchema.parse(store.listBrands(param(request.params, 'libraryId'))),
  );
  app.post('/api/libraries/:libraryId/brands', (request, reply) =>
    reply
      .code(201)
      .send(
        store.createBrand(param(request.params, 'libraryId'), request.body),
      ),
  );
  app.get('/api/brands/:id', (request) =>
    store.getBrand(param(request.params, 'id')),
  );
  app.put('/api/brands/:id', (request) =>
    store.saveBrand(param(request.params, 'id'), request.body),
  );
  app.delete('/api/brands/:id', (request) => {
    store.deleteBrand(param(request.params, 'id'));
    return { ok: true };
  });
  app.get('/api/libraries/:libraryId/cmf-boards', (request) =>
    S.CmfBoardsSchema.parse(
      store.listCmfBoards(param(request.params, 'libraryId')),
    ),
  );
  app.post('/api/libraries/:libraryId/cmf-boards', (request, reply) =>
    reply
      .code(201)
      .send(
        store.createCmfBoard(param(request.params, 'libraryId'), request.body),
      ),
  );
  app.get('/api/cmf-boards/:id', (request) =>
    store.getCmfBoard(param(request.params, 'id')),
  );
  app.put('/api/cmf-boards/:id', (request) =>
    store.saveCmfBoard(param(request.params, 'id'), request.body),
  );
  app.delete('/api/cmf-boards/:id', (request) => {
    store.deleteCmfBoard(param(request.params, 'id'));
    return { ok: true };
  });
  app.get('/api/brands/:id/package', async (request) => {
    const brand = store.getBrand(param(request.params, 'id'));
    const pins = [
      ...new Map(
        [...brand.fonts, ...brand.logos].map((item) => [
          item.pin.versionId,
          item.pin,
        ]),
      ).values(),
    ];
    const files: S.BrandPackage['files'] = [];
    let total = 0;
    for (const pin of pins) {
      const version = catalog
        .listVersions(pin.assetId)
        .find((version) => version.id === pin.versionId);
      const file = catalog.getVersionFile(pin.versionId);
      if (
        !version ||
        file.libraryId !== brand.libraryId ||
        file.assetId !== pin.assetId
      )
        throw new CatalogError(
          'Invalid brand version reference',
          'INVALID_RELATION',
          400,
        );
      const safe = await resolveContained(
        paths.data,
        relative(paths.data, file.snapshotPath),
      );
      total += (await stat(safe)).size;
      if (total > 64 * 1024 * 1024)
        throw new CatalogError(
          'This brand exceeds the 64 MiB embedded export limit. Export the library for original files.',
          'EXPORT_TOO_LARGE',
          413,
        );
      const bytes = await readFile(safe);
      if (createHash('sha256').update(bytes).digest('hex') !== version.hash)
        throw new CatalogError(
          'A retained brand file failed its integrity check. Restore the data backup.',
          'SNAPSHOT_INTEGRITY',
          409,
        );
      let previewDataUrl: string | null = null;
      if (file.thumbnailPath) {
        try {
          const preview = await resolveContained(
            paths.cache,
            relative(paths.cache, file.thumbnailPath),
          );
          const buffer = await readFile(preview);
          if (buffer.length <= 4 * 1024 * 1024)
            previewDataUrl = `data:image/webp;base64,${buffer.toString('base64')}`;
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
        }
      }
      files.push({
        ...pin,
        name: file.name,
        type: file.type,
        hash: version.hash,
        base64: bytes.toString('base64'),
        previewDataUrl,
      });
    }
    return S.BrandPackageSchema.parse({
      format: 'cura-brand',
      schemaVersion: 1,
      colorSpace: 'sRGB; CMYK is an unprofiled approximation',
      brand,
      files,
    });
  });
}
