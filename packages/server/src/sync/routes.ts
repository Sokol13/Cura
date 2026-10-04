import type { FastifyInstance } from 'fastify';
import * as S from '@cura/shared';
import type { SyncService } from './service.js';
export function registerSyncRoutes(
  app: FastifyInstance,
  service: SyncService,
): void {
  const id = (value: unknown) => S.IdSchema.parse(value);
  app.get('/api/sync/status', () => S.SyncStatusSchema.parse(service.status()));
  app.post('/api/sync/auth/sign-in', async (request) =>
    S.SyncStatusSchema.parse(
      await service.signIn(S.SyncSignInSchema.parse(request.body)),
    ),
  );
  app.post('/api/sync/auth/refresh', async (request) => {
    S.SyncEmptyRequestSchema.parse(request.body ?? {});
    return S.SyncStatusSchema.parse(await service.refresh());
  });
  app.post('/api/sync/auth/sign-out', async (request) => {
    S.SyncEmptyRequestSchema.parse(request.body ?? {});
    return S.SyncStatusSchema.parse(await service.signOut());
  });
  app.get('/api/sync/libraries', async () =>
    S.CloudLibrariesSchema.parse(await service.libraries()),
  );
  app.post('/api/sync/publish', async (request, reply) =>
    reply
      .code(202)
      .send(
        S.SyncLinkSchema.parse(
          await service.publish(S.SyncLibraryRequestSchema.parse(request.body)),
        ),
      ),
  );
  app.post('/api/sync/join', async (request, reply) =>
    reply
      .code(202)
      .send(
        S.SyncLinkSchema.parse(
          await service.join(S.SyncLibraryRequestSchema.parse(request.body)),
        ),
      ),
  );
  app.post<{ Params: { id: string } }>(
    '/api/sync/links/:id/run',
    async (request, reply) => {
      S.SyncEmptyRequestSchema.parse(request.body ?? {});
      return reply
        .code(202)
        .send(S.SyncLinkSchema.parse(service.run(id(request.params.id))));
    },
  );
  app.patch<{ Params: { id: string } }>('/api/sync/links/:id', (request) =>
    S.SyncLinkSchema.parse(
      service.patch(
        id(request.params.id),
        S.SyncLinkPatchSchema.parse(request.body),
      ),
    ),
  );
  app.get<{ Params: { id: string } }>(
    '/api/sync/links/:id/conflicts',
    (request) =>
      S.SyncConflictsSchema.parse(service.conflicts(id(request.params.id))),
  );
  app.get<{ Params: { id: string; conflictId: string } }>(
    '/api/sync/links/:id/conflicts/:conflictId',
    (request) =>
      S.SyncConflictDetailSchema.parse(
        service.conflict(id(request.params.id), id(request.params.conflictId)),
      ),
  );
  app.get<{ Params: { libraryId: string } }>(
    '/api/sync/libraries/:libraryId/members',
    async (request) =>
      S.SyncMembersSchema.parse(
        await service.members(id(request.params.libraryId)),
      ),
  );
  app.put<{ Params: { libraryId: string; userId: string } }>(
    '/api/sync/libraries/:libraryId/members/:userId',
    async (request) =>
      S.SyncMemberSchema.parse(
        await service.setMember(
          id(request.params.libraryId),
          id(request.params.userId),
          S.SyncMemberUpsertSchema.parse(request.body),
        ),
      ),
  );
  app.delete<{ Params: { libraryId: string; userId: string } }>(
    '/api/sync/libraries/:libraryId/members/:userId',
    async (request) => {
      await service.removeMember(
        id(request.params.libraryId),
        id(request.params.userId),
      );
      return S.SuccessResponseSchema.parse({ ok: true });
    },
  );
}
