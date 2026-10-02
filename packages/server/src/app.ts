import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { HealthResponseJsonSchema, HealthResponseSchema } from '@cura/shared';
import fastifyStatic from '@fastify/static';
import Fastify, { type FastifyBaseLogger } from 'fastify';
import { isAllowedLocalRequest } from './security.js';

export const DEFAULT_WEB_ROOT = fileURLToPath(
  new URL('../../web/dist/', import.meta.url),
);

export interface AppOptions {
  loggerInstance?: FastifyBaseLogger;
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

  app.all('/api', (_request, reply) => reply.callNotFound());
  app.all('/api/*', (_request, reply) => reply.callNotFound());

  const staticRoot = options.staticRoot ?? DEFAULT_WEB_ROOT;
  if (staticRoot && existsSync(staticRoot)) {
    await app.register(fastifyStatic, { root: staticRoot });
  }

  return app;
}
