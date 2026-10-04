import type { FastifyInstance } from 'fastify';
import * as C from '@cura/shared';
import type { AppDatabase } from '../database.js';
import type { CatalogStore } from '../catalog-store.js';
import type { MediaService } from '../media/service.js';
import { ProcessStore } from './store.js';
import { GenerationService } from './service.js';

const id = (params: unknown) =>
  C.IdSchema.parse((params as { id: unknown }).id);
export function registerProcessRoutes(
  app: FastifyInstance,
  database: AppDatabase,
  catalog: CatalogStore,
  media: MediaService,
): void {
  const store = new ProcessStore(database);
  const service = new GenerationService(store, catalog, media);
  app.get('/api/libraries/:id/process', (request) =>
    store.statistics(id(request.params)),
  );
  app.get('/api/assets/:id/process', (request) =>
    store.timeline(id(request.params)),
  );
  app.get('/api/libraries/:id/generations', (request) =>
    C.GenerationJobsSchema.parse(store.jobs(id(request.params))),
  );
  app.post('/api/libraries/:id/generations', (request, reply) =>
    reply
      .code(201)
      .send(
        C.GenerationJobSchema.parse(
          service.start(
            id(request.params),
            C.GenerateRequestSchema.parse(request.body),
          ),
        ),
      ),
  );
  app.get('/api/generations/:id', (request) =>
    C.GenerationJobSchema.parse(store.job(id(request.params))),
  );
  app.post('/api/generations/:id/cancel', (request) =>
    C.GenerationJobSchema.parse(service.cancel(id(request.params))),
  );
  app.addHook('onClose', () => service.close());
}
