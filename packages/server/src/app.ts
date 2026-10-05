import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  DIAGNOSTIC_MESSAGES,
  HealthResponseJsonSchema,
  HealthResponseSchema,
} from '@cura/shared';
import Fastify, { type FastifyBaseLogger } from 'fastify';
import pino from 'pino';
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
import { SyncService, registerSyncRoutes } from './sync/index.js';
import { isAllowedLocalRequest } from './security.js';
import { registerStaticFiles } from './static-files.js';
import { WarningJournal } from './diagnostics/journal.js';
import { withDiagnosticJournal } from './diagnostics/logger.js';

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
  const journal = options.paths
    ? new WarningJournal(options.paths.log)
    : undefined;
  const logger = journal
    ? withDiagnosticJournal(
        options.loggerInstance ?? pino({ enabled: false }),
        journal,
      )
    : options.loggerInstance;
  const app = Fastify(logger ? { loggerInstance: logger } : {});
  if (journal) app.addHook('onClose', () => journal.close());

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
    const media = new MediaService(store, options.paths, (event) => {
      const { level, ...context } = event;
      app.log[level](context, DIAGNOSTIC_MESSAGES[event.operation]);
    });
    await registerCatalogRoutes(app, store, media, options.paths, {
      diagnosticLogs: () => journal!.snapshot(),
    });
    await registerPreviewRoutes(app, media);
    registerBrandRoutes(app, options.database, store, options.paths);
    const sync = new SyncService(options.database, options.paths, {
      notify: (event) => media.notify(event),
      rebuildVersions: (ids) => media.rebuildVersions(ids),
    });
    registerBoardRoutes(
      app,
      new BoardStore(options.database, () => {
        // status() checks expiry; a cached offline/restoring account is not verified.
        const status = sync.auth.status();
        return status.auth === 'signed-in' && status.account
          ? { kind: 'account', ...status.account }
          : { kind: 'local' };
      }),
      (event) => media.notify(event),
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
    registerSyncRoutes(app, sync);
    app.addHook('onClose', () => sync.close());
    void sync.initialize().catch(() => {
      app.log.error(
        { operation: 'sync', code: 'SYNC_INITIALIZATION' },
        'Cloud synchronization could not initialize. Local libraries remain available.',
      );
    });
  }

  app.all('/api', (_request, reply) => reply.callNotFound());
  app.all('/api/*', (_request, reply) => reply.callNotFound());

  const staticRoot = options.staticRoot ?? DEFAULT_WEB_ROOT;
  if (staticRoot && existsSync(staticRoot)) {
    registerStaticFiles(app, staticRoot);
  }

  return app;
}
