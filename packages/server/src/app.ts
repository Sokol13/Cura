import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { HealthResponseJsonSchema, HealthResponseSchema } from '@cura/shared';
import Fastify, { type FastifyBaseLogger } from 'fastify';
import type { AppDatabase } from './database.js';
import type { UserPaths } from './paths.js';
import { CatalogStore } from './catalog-store.js';
import { MediaService } from './media/service.js';
import { registerCatalogRoutes } from './catalog-routes.js';
import { registerPreviewRoutes } from './media/preview-routes.js';
import { registerProcessRoutes } from './process/routes.js';
import { BoardStore } from './boards/store.js';
import { registerBoardRoutes } from './boards/routes.js';
import { registerBrandRoutes } from './brands/routes.js';
import { registerExportRoutes } from './exports/routes.js';
import { registerAutomationRoutes } from './automation/routes.js';
import { registerFcpxmlRoutes } from './fcpxml/routes.js';
import { isAllowedLocalRequest } from './security.js';
import { registerStaticFiles } from './static-files.js';

export const DEFAULT_WEB_ROOT = fileURLToPath(
  new URL('../../web/dist/', import.meta.url),
);

export interface AppOptions {
  loggerInstance?: FastifyBaseLogger;
  database?: AppDatabase;
  paths?: UserPaths;
  onClose?: () => void | Promise<void>;
  staticRoot?: string | false;
}

export async function createApp(options: AppOptions = {}) {
  const app = Fastify(
    options.loggerInstance ? { loggerInstance: options.loggerInstance } : {},
  );

  app.addHook('onRequest', async (request, reply) => {
    if (
      !isAllowedLocalRequest(
        request.headers.host,
        request.headers.origin,
        request.raw.socket.localPort,
      )
    ) {
      return reply.code(403).send({
        statusCode: 403,
        error: 'Forbidden',
        message:
          'This server only accepts requests from the local Cura application.',
      });
    }
  });

  app.get(
    '/api/health',
    { schema: { response: { 200: HealthResponseJsonSchema } } },
    async () => HealthResponseSchema.parse({ status: 'ok' }),
  );

  if (options.database && options.paths) {
    const store = new CatalogStore(options.database);
    const media = new MediaService(store, options.paths);
    media.subscribe((event) => {
      if (event.type === 'error')
        app.log.error(
          {
            operation: 'media',
            code: event.code ?? 'MEDIA_FAILURE',
            libraryId: event.libraryId,
            rootId: event.rootId,
            assetId: event.assetId,
          },
          'Media operation failed; inspect the affected registered root.',
        );
    });
    await registerCatalogRoutes(app, store, media, options.paths);
    await registerPreviewRoutes(app, store, media);
    registerBrandRoutes(app, options.database, store, options.paths);
    registerBoardRoutes(app, new BoardStore(options.database), (event) =>
      media.notify(event),
    );
    app.addHook('onReady', () => media.resume());
    app.addHook('onClose', async () => {
      await media.close();
      await options.onClose?.();
    });
    // Fastify closes hooks in reverse order: stop generation before media/database.
    registerProcessRoutes(app, options.database, store, media);
    registerExportRoutes(app, options.database, options.paths);
    const automation = registerAutomationRoutes(app, {
      database: options.database,
      store,
      media,
      paths: options.paths,
    });
    app.addHook('onClose', () => automation.close());
    registerFcpxmlRoutes(app, options.database, options.paths);
  }

  app.all('/api', (_request, reply) => reply.callNotFound());
  app.all('/api/*', (_request, reply) => reply.callNotFound());

  const staticRoot = options.staticRoot ?? DEFAULT_WEB_ROOT;
  if (staticRoot && existsSync(staticRoot)) {
    registerStaticFiles(app, staticRoot);
  }

  return app;
}
