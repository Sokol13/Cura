import { createReadStream } from 'node:fs';
import type { FastifyInstance } from 'fastify';
import * as C from '@cura/shared';
import type { AppDatabase } from '../database.js';
import type { UserPaths } from '../paths.js';
import { FcpxmlService } from './service.js';
const id = (params: unknown) =>
  C.IdSchema.parse((params as { id: unknown }).id);
/** Register after database/media shutdown hooks so workers complete before SQLite closes. */
export function registerFcpxmlRoutes(
  app: FastifyInstance,
  database: AppDatabase,
  paths: UserPaths,
): void {
  const service = new FcpxmlService(database, paths);
  app.get('/api/libraries/:id/fcpxml', (request) =>
    C.FcpxmlJobsSchema.parse(service.list(id(request.params))),
  );
  app.post('/api/libraries/:id/fcpxml', (request, reply) =>
    reply
      .code(201)
      .send(
        service.start(
          id(request.params),
          C.CreateFcpxmlSchema.parse(request.body),
        ),
      ),
  );
  app.get('/api/fcpxml/:id', (request) => service.get(id(request.params)));
  app.get('/api/versions/:id/fcpxml-source', (request) =>
    service.probe(id(request.params)),
  );
  for (const kind of ['xml', 'package'] as const)
    app.get(`/api/fcpxml/:id/${kind}`, (request, reply) => {
      const file = service.file(id(request.params), kind);
      return reply
        .header(
          'content-disposition',
          `attachment; filename="timeline.${kind === 'xml' ? 'fcpxml' : 'zip'}"; filename*=UTF-8''${encodeURIComponent(file.filename)}`,
        )
        .header('cache-control', 'no-store')
        .type(kind === 'xml' ? 'application/xml' : 'application/zip')
        .send(createReadStream(file.path));
    });
  app.addHook('onClose', () => service.close());
}
