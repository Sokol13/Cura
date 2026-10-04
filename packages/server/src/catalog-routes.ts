import { createReadStream, readFileSync } from 'node:fs';
import { open, readdir, realpath } from 'node:fs/promises';
import { homedir, platform, release, arch } from 'node:os';
import { dirname, join, relative } from 'node:path';
import websocket from '@fastify/websocket';
import { strToU8, zipSync } from 'fflate';
import type { FastifyInstance } from 'fastify';
import * as s from '@cura/shared';
import type { CatalogStore } from './catalog-store.js';
import type { MediaService } from './media/service.js';
import { fileOperationMessage } from './media/service.js';
import { resolveContained } from './media/path-utils.js';
import type { UserPaths } from './paths.js';

const assetLimit = 100 * 1024 * 1024;
const packageVersion = (
  JSON.parse(
    readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
  ) as { version: string }
).version;
const id = (params: unknown, key: string): string =>
  s.IdSchema.parse((params as Record<string, unknown>)[key]);
const success = () => s.SuccessResponseSchema.parse({ ok: true });
const safeRaster = new Set([
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif',
  'image/avif',
]);

export async function registerCatalogRoutes(
  app: FastifyInstance,
  store: CatalogStore,
  media: MediaService,
  paths: UserPaths,
): Promise<void> {
  app.addContentTypeParser(
    'application/octet-stream',
    { parseAs: 'buffer', bodyLimit: assetLimit },
    (_request, body, done) => done(null, body),
  );
  app.setErrorHandler((error, _request, reply) => {
    const e = error as Error & { code?: string; statusCode?: number };
    const invalid = e.name === 'ZodError';
    const status = invalid
      ? 400
      : (e.statusCode ??
        (e.code === 'ENOENT'
          ? 404
          : ['EACCES', 'EPERM', 'EBUSY'].includes(e.code ?? '')
            ? 403
            : 500));
    const message = invalid
      ? 'Invalid request. Check the supplied values.'
      : status === 500
        ? 'The operation could not be completed. Check diagnostics and retry.'
        : fileOperationMessage(e);
    if (
      status >= 500 ||
      ['EACCES', 'EPERM', 'EBUSY', 'ENOENT'].includes(e.code ?? '')
    )
      app.log.error(
        {
          operation: 'http',
          code: e.code ?? 'INTERNAL_ERROR',
          errorName: e.name,
        },
        'Catalog operation failed; use the error code to identify the failed operation.',
      );
    return reply.code(status).send(
      s.ErrorResponseSchema.parse({
        error: message,
        code: invalid ? 'VALIDATION' : (e.code ?? 'OPERATION_FAILED'),
      }),
    );
  });
  app.get('/api/libraries', () =>
    s.LibrariesSchema.parse(store.listLibraries()),
  );
  app.post('/api/libraries', (request, reply) =>
    reply
      .code(201)
      .send(
        s.LibrarySchema.parse(
          store.createLibrary(s.CreateLibrarySchema.parse(request.body)),
        ),
      ),
  );
  app.patch('/api/libraries/:libraryId', (request) =>
    s.LibrarySchema.parse(
      store.updateLibrary(
        id(request.params, 'libraryId'),
        s.UpdateLibrarySchema.parse(request.body),
      ),
    ),
  );
  app.get('/api/directories', async (request) => {
    const query = s.DirectoryQuerySchema.parse(request.query);
    const directory = await realpath(query.path || homedir());
    const entries = await readdir(directory, { withFileTypes: true });
    return s.DirectoryListSchema.parse({
      path: directory,
      parent: dirname(directory) === directory ? null : dirname(directory),
      directories: entries
        .filter((entry) => entry.isDirectory() && !entry.isSymbolicLink())
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((entry) => ({
          name: entry.name,
          path: join(directory, entry.name),
        })),
    });
  });
  app.get('/api/libraries/:libraryId/roots', (request) =>
    s.LibraryRootsSchema.parse(
      store.listRoots(id(request.params, 'libraryId')),
    ),
  );
  app.post('/api/libraries/:libraryId/roots', async (request, reply) => {
    const input = s.RegisterRootSchema.parse(request.body);
    const root = await media.registerRoot(
      id(request.params, 'libraryId'),
      input.path,
    );
    return reply.code(201).send(s.LibraryRootSchema.parse(root));
  });
  app.delete('/api/roots/:id', async (request) => {
    await media.unregisterRoot(id(request.params, 'id'));
    return success();
  });
  app.post('/api/libraries/:libraryId/rescan', async (request) => {
    await media.rescan(id(request.params, 'libraryId'));
    return success();
  });
  app.post(
    '/api/libraries/:libraryId/upload',
    { bodyLimit: assetLimit },
    async (request, reply) => {
      const { name } = s.UploadQuerySchema.parse(request.query);
      if (!Buffer.isBuffer(request.body))
        return reply
          .code(400)
          .send({ error: 'Upload binary file bytes.', code: 'VALIDATION' });
      return reply
        .code(201)
        .send(
          s.AssetSchema.parse(
            await media.upload(
              id(request.params, 'libraryId'),
              name,
              request.body,
            ),
          ),
        );
    },
  );
  app.get('/api/libraries/:libraryId/assets', (request) =>
    s.AssetPageSchema.parse(
      store.listAssets(
        id(request.params, 'libraryId'),
        s.AssetQuerySchema.parse(request.query),
      ),
    ),
  );
  app.get('/api/assets/:assetId', (request) =>
    s.AssetSchema.parse(store.getAsset(id(request.params, 'assetId'))),
  );
  app.patch('/api/assets/:assetId', (request) =>
    s.AssetSchema.parse(
      store.updateAsset(
        id(request.params, 'assetId'),
        s.UpdateAssetSchema.parse(request.body),
      ),
    ),
  );
  app.post('/api/libraries/:libraryId/assets/batch', (request) =>
    s.BatchAssetsResponseSchema.parse({
      items: store.batchAssets(
        id(request.params, 'libraryId'),
        s.BatchAssetsSchema.parse(request.body),
      ),
    }),
  );
  app.get('/api/assets/:assetId/versions', (request) =>
    s.AssetVersionsSchema.parse(
      store.listVersions(id(request.params, 'assetId')),
    ),
  );
  app.post(
    '/api/assets/:assetId/replace',
    { bodyLimit: assetLimit },
    async (request, reply) => {
      const { name } = s.UploadQuerySchema.parse(request.query);
      if (!Buffer.isBuffer(request.body))
        return reply
          .code(400)
          .send({ error: 'Upload binary file bytes.', code: 'VALIDATION' });
      return s.AssetSchema.parse(
        await media.replace(id(request.params, 'assetId'), name, request.body),
      );
    },
  );
  app.get('/api/versions/:versionId/file', async (request, reply) => {
    const file = store.getVersionFile(id(request.params, 'versionId'));
    const safe = await resolveContained(
      paths.data,
      relative(paths.data, file.snapshotPath),
    );
    if (safe !== (await realpath(file.snapshotPath)))
      throw new Error('Invalid content path.');
    const headers = {
      'x-content-type-options': 'nosniff',
      'content-security-policy': "sandbox; default-src 'none'",
    };
    reply.headers(headers).type(file.type);
    if (!safeRaster.has(file.type))
      reply.header(
        'content-disposition',
        `attachment; filename*=UTF-8''${encodeURIComponent(file.name)}`,
      );
    return reply.send(createReadStream(safe));
  });
  app.get('/api/versions/:versionId/thumbnail', async (request, reply) => {
    const file = store.getVersionFile(id(request.params, 'versionId'));
    reply
      .header('x-content-type-options', 'nosniff')
      .header('cache-control', 'private, max-age=31536000, immutable');
    if (file.thumbnailPath) {
      const safe = await resolveContained(
        paths.cache,
        relative(paths.cache, file.thumbnailPath),
      );
      if (safe !== (await realpath(file.thumbnailPath)))
        throw new Error('Invalid thumbnail path.');
      return reply.type('image/webp').send(createReadStream(safe));
    }
    return reply
      .type('image/svg+xml')
      .header('content-security-policy', "sandbox; default-src 'none'")
      .send(
        '<svg xmlns="http://www.w3.org/2000/svg" width="320" height="240" viewBox="0 0 320 240"><rect width="320" height="240" fill="#252830"/><path d="M120 60h55l25 25v95h-80z" fill="none" stroke="#8c93a3" stroke-width="6"/><path d="M175 60v25h25" fill="none" stroke="#8c93a3" stroke-width="6"/></svg>',
      );
  });
  app.get('/api/assets/:assetId/annotations', (request) =>
    s.AnnotationsSchema.parse(
      store.listAnnotations(
        id(request.params, 'assetId'),
        s.AnnotationQuerySchema.parse(request.query).versionId,
      ),
    ),
  );
  app.post('/api/assets/:assetId/annotations', (request, reply) =>
    reply
      .code(201)
      .send(
        s.AnnotationSchema.parse(
          store.createAnnotation(
            id(request.params, 'assetId'),
            s.CreateAnnotationSchema.parse(request.body),
          ),
        ),
      ),
  );
  app.patch('/api/annotations/:id', (request) =>
    s.AnnotationSchema.parse(
      store.updateAnnotation(
        id(request.params, 'id'),
        s.UpdateAnnotationSchema.parse(request.body),
      ),
    ),
  );
  app.delete('/api/annotations/:id', (request) => {
    store.deleteAnnotation(id(request.params, 'id'));
    return success();
  });
  app.get('/api/libraries/:libraryId/folders', (request) =>
    s.FoldersSchema.parse(store.listFolders(id(request.params, 'libraryId'))),
  );
  app.post('/api/libraries/:libraryId/folders', (request, reply) =>
    reply
      .code(201)
      .send(
        s.FolderSchema.parse(
          store.createFolder(
            id(request.params, 'libraryId'),
            s.CreateFolderSchema.parse(request.body),
          ),
        ),
      ),
  );
  app.patch('/api/folders/:id', (request) =>
    s.FolderSchema.parse(
      store.updateFolder(
        id(request.params, 'id'),
        s.UpdateFolderSchema.parse(request.body),
      ),
    ),
  );
  app.delete('/api/folders/:id', (request) => {
    store.deleteFolder(id(request.params, 'id'));
    return success();
  });
  app.get('/api/libraries/:libraryId/tags', (request) =>
    s.TagsSchema.parse(store.listTags(id(request.params, 'libraryId'))),
  );
  app.post('/api/libraries/:libraryId/tags', (request, reply) =>
    reply
      .code(201)
      .send(
        s.TagSchema.parse(
          store.createTag(
            id(request.params, 'libraryId'),
            s.CreateTagSchema.parse(request.body),
          ),
        ),
      ),
  );
  app.patch('/api/tags/:id', (request) =>
    s.TagSchema.parse(
      store.updateTag(
        id(request.params, 'id'),
        s.UpdateTagSchema.parse(request.body),
      ),
    ),
  );
  app.delete('/api/tags/:id', (request) => {
    store.deleteTag(id(request.params, 'id'));
    return success();
  });
  app.get('/api/libraries/:libraryId/tag-groups', (request) =>
    s.TagGroupsSchema.parse(
      store.listTagGroups(id(request.params, 'libraryId')),
    ),
  );
  app.post('/api/libraries/:libraryId/tag-groups', (request, reply) =>
    reply
      .code(201)
      .send(
        s.TagGroupSchema.parse(
          store.createTagGroup(
            id(request.params, 'libraryId'),
            s.CreateTagGroupSchema.parse(request.body),
          ),
        ),
      ),
  );
  app.patch('/api/tag-groups/:id', (request) =>
    s.TagGroupSchema.parse(
      store.updateTagGroup(
        id(request.params, 'id'),
        s.UpdateTagGroupSchema.parse(request.body),
      ),
    ),
  );
  app.delete('/api/tag-groups/:id', (request) => {
    store.deleteTagGroup(id(request.params, 'id'));
    return success();
  });
  app.get('/api/libraries/:libraryId/collections', (request) =>
    s.CollectionsSchema.parse(
      store.listCollections(id(request.params, 'libraryId')),
    ),
  );
  app.post('/api/libraries/:libraryId/collections', (request, reply) =>
    reply
      .code(201)
      .send(
        s.CollectionSchema.parse(
          store.createCollection(
            id(request.params, 'libraryId'),
            s.CreateCollectionSchema.parse(request.body),
          ),
        ),
      ),
  );
  app.patch('/api/collections/:id', (request) =>
    s.CollectionSchema.parse(
      store.updateCollection(
        id(request.params, 'id'),
        s.UpdateCollectionSchema.parse(request.body),
      ),
    ),
  );
  app.delete('/api/collections/:id', (request) => {
    store.deleteCollection(id(request.params, 'id'));
    return success();
  });
  app.get('/api/settings', () => s.SettingsSchema.parse(store.getSettings()));
  app.patch('/api/settings', (request) =>
    s.SettingsSchema.parse(
      store.updateSettings(s.UpdateSettingsSchema.parse(request.body)),
    ),
  );
  app.get('/api/cache', async () =>
    s.CacheUsageSchema.parse(await media.cacheInfo()),
  );
  app.post('/api/cache/clear', async () => {
    await media.clearCache();
    return success();
  });
  app.post('/api/cache/rebuild', async () => {
    await media.rebuildCache();
    return success();
  });
  app.get('/api/diagnostics', async (_request, reply) => {
    let log = 'No log file.';
    try {
      const handle = await open(join(paths.log, 'cura.log'), 'r');
      try {
        const { size } = await handle.stat();
        const bytes = Buffer.alloc(Math.min(size, 128 * 1024));
        await handle.read(
          bytes,
          0,
          bytes.length,
          Math.max(0, size - bytes.length),
        );
        log = bytes.toString('utf8');
      } finally {
        await handle.close();
      }
    } catch {
      /* Empty logs are normal on first start. */
    }
    // Diagnostics intentionally omit arbitrary log fields: metadata and filenames can be private.
    const entries = log.split('\n').flatMap((line) => {
      try {
        const row = JSON.parse(line) as Record<string, unknown>;
        return [
          {
            level: row.level,
            time: row.time,
            msg:
              typeof row.msg === 'string'
                ? row.msg.replace(/(?:[A-Z]:\\|\/)[^\s"']+/gi, '[path]')
                : '',
            code: typeof row.code === 'string' ? row.code : undefined,
            operation:
              typeof row.operation === 'string' ? row.operation : undefined,
            errorName:
              typeof row.errorName === 'string' ? row.errorName : undefined,
            rootId: typeof row.rootId === 'string' ? row.rootId : undefined,
            assetId: typeof row.assetId === 'string' ? row.assetId : undefined,
          },
        ];
      } catch {
        return [];
      }
    });
    const stats = store.stats();
    const payload = zipSync({
      'diagnostics.json': strToU8(
        JSON.stringify(
          {
            version: packageVersion,
            platform: platform(),
            release: release(),
            arch: arch(),
            node: process.versions.node,
            createdAt: new Date().toISOString(),
            stats,
          },
          null,
          2,
        ),
      ),
      'logs.json': strToU8(JSON.stringify(entries, null, 2)),
    });
    return reply
      .type('application/zip')
      .header(
        'content-disposition',
        'attachment; filename="cura-diagnostics.zip"',
      )
      .send(Buffer.from(payload));
  });
  await app.register(websocket);
  app.get('/api/events', { websocket: true }, (socket) => {
    const unsubscribe = media.subscribe((event) => {
      if (socket.readyState === 1)
        socket.send(JSON.stringify(s.CatalogEventSchema.parse(event)));
    });
    socket.on('close', unsubscribe);
    socket.on('error', unsubscribe);
  });
}
