import { createReadStream } from 'node:fs';
import type { FastifyInstance } from 'fastify';
import * as C from '@cura/shared';
import type { AppDatabase } from '../database.js';
import type { UserPaths } from '../paths.js';
import { ExportService } from './service.js';
const id = (params: unknown) =>
  C.IdSchema.parse((params as { id: unknown }).id);
/** Register after the shared media/database close hook so exports finish first. */
export function registerExportRoutes(
  app: FastifyInstance,
  database: AppDatabase,
  paths: UserPaths,
): void {
  const service = new ExportService(database, paths);
  app.get('/api/libraries/:id/exports', (request) =>
    C.ExportJobsSchema.parse(service.list(id(request.params))),
  );
  app.post('/api/libraries/:id/exports', (request, reply) =>
    reply
      .code(201)
      .send(
        service.start(
          id(request.params),
          C.ExportRequestSchema.parse(request.body),
        ),
      ),
  );
  app.get('/api/exports/:id', (request) => service.get(id(request.params)));
  app.get('/api/exports/:id/file', (request, reply) => {
    const archive = service.archive(id(request.params));
    return reply
      .header(
        'content-disposition',
        `attachment; filename="cura-export.zip"; filename*=UTF-8''${encodeURIComponent(archive.filename)}`,
      )
      .header('cache-control', 'no-store')
      .type('application/zip')
      .send(createReadStream(archive.path));
  });
  app.addHook('onClose', () => service.close());
}
