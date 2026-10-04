import type { FastifyInstance } from 'fastify';
import * as S from '@cura/shared';
import type { BoardStore } from './store.js';

const id = (params: unknown, key = 'id'): string =>
  S.IdSchema.parse((params as Record<string, unknown>)[key]);
const success = () => S.SuccessResponseSchema.parse({ ok: true });

export function registerBoardRoutes(
  app: FastifyInstance,
  store: BoardStore,
  notify?: (event: S.BoardEvent) => void,
): void {
  const changed = (document: S.BoardDocument): S.BoardDocument => {
    notify?.(
      S.BoardEventSchema.parse({
        type: 'board',
        libraryId: document.board.libraryId,
        boardId: document.board.id,
      }),
    );
    return S.BoardDocumentSchema.parse(document);
  };
  const templateChanged = (template: S.SlotTemplate): S.SlotTemplate => {
    notify?.(
      S.BoardEventSchema.parse({
        type: 'board',
        libraryId: template.libraryId,
      }),
    );
    return S.SlotTemplateSchema.parse(template);
  };
  app.get('/api/libraries/:libraryId/boards', (request) =>
    S.BoardsSchema.parse(store.listBoards(id(request.params, 'libraryId'))),
  );
  app.post('/api/libraries/:libraryId/boards', (request, reply) =>
    reply
      .code(201)
      .send(
        changed(
          store.createBoard(
            id(request.params, 'libraryId'),
            S.CreateBoardSchema.parse(request.body),
          ),
        ),
      ),
  );
  app.get('/api/boards/:id', (request) =>
    S.BoardDocumentSchema.parse(store.getBoard(id(request.params))),
  );
  app.patch('/api/boards/:id', (request) =>
    changed(
      store.updateBoard(
        id(request.params),
        S.UpdateBoardSchema.parse(request.body),
      ),
    ),
  );
  app.delete('/api/boards/:id', (request) => {
    const boardId = id(request.params);
    const document = store.getBoard(boardId);
    store.deleteBoard(
      boardId,
      S.BoardRevisionRequestSchema.parse(request.body),
    );
    changed(document);
    return success();
  });
  app.put('/api/boards/:id/layout', (request) =>
    changed(
      store.saveLayout(
        id(request.params),
        S.SaveBoardLayoutSchema.parse(request.body),
      ),
    ),
  );
  app.post('/api/boards/:id/slots', (request, reply) =>
    reply
      .code(201)
      .send(
        changed(
          store.createSlot(
            id(request.params),
            S.CreateBoardSlotSchema.parse(request.body),
          ),
        ),
      ),
  );
  app.put('/api/slots/:id/assignment', (request) =>
    changed(
      store.assignSlot(
        id(request.params),
        S.AssignBoardSlotSchema.parse(request.body),
      ),
    ),
  );
  app.delete('/api/slots/:id', (request) =>
    changed(
      store.deleteSlot(
        id(request.params),
        S.BoardRevisionRequestSchema.parse(request.body),
      ),
    ),
  );
  app.get('/api/slots/:id/history', (request) =>
    S.SlotHistorySchema.parse(store.listSlotHistory(id(request.params))),
  );
  app.get('/api/libraries/:libraryId/slot-templates', (request) =>
    S.SlotTemplatesSchema.parse(
      store.listTemplates(id(request.params, 'libraryId')),
    ),
  );
  app.post('/api/libraries/:libraryId/slot-templates', (request, reply) =>
    reply
      .code(201)
      .send(
        templateChanged(
          store.createTemplate(
            id(request.params, 'libraryId'),
            S.CreateSlotTemplateSchema.parse(request.body),
          ),
        ),
      ),
  );
  app.patch('/api/slot-templates/:id', (request) =>
    templateChanged(
      store.updateTemplate(
        id(request.params),
        S.UpdateSlotTemplateSchema.parse(request.body),
      ),
    ),
  );
  app.delete('/api/slot-templates/:id', (request) => {
    templateChanged(store.deleteTemplate(id(request.params)));
    return success();
  });
}
