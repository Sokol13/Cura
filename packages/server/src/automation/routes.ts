import type { FastifyInstance, FastifyRequest } from 'fastify';
import * as C from '@cura/shared';
import { AutomationService, type AutomationOptions } from './service.js';
import { AutomationError } from './errors.js';
export function registerAutomationRoutes(
  app: FastifyInstance,
  options: AutomationOptions,
): AutomationService {
  const service = new AutomationService(options),
    base = '/api/libraries/:libraryId/automation';
  const library = (req: FastifyRequest) => {
    const id = C.IdSchema.parse(
      (req.params as { libraryId: unknown }).libraryId,
    );
    options.store.getLibrary(id);
    return id;
  };
  const id = (req: FastifyRequest) =>
    C.IdSchema.parse((req.params as { id: unknown }).id);
  app.get(`${base}/providers`, (req) => {
    library(req);
    return C.AutomationProvidersSchema.parse(service.providersInfo());
  });
  app.get(`${base}/jobs`, (req) =>
    C.AutomationJobsPageSchema.parse(service.jobs(library(req), req.query)),
  );
  app.post(`${base}/jobs`, (req, reply) =>
    reply
      .code(201)
      .send(
        C.AutomationJobSchema.parse(
          service.analyze(
            library(req),
            C.AutomationAnalyzeRequestSchema.parse(req.body),
          ),
        ),
      ),
  );
  app.get(`${base}/jobs/:id`, (req) =>
    C.AutomationJobSchema.parse(service.job(library(req), id(req))),
  );
  app.post(`${base}/jobs/:id/cancel`, (req) =>
    C.AutomationJobSchema.parse(service.cancel(library(req), id(req))),
  );
  app.get(`${base}/proposals`, (req) =>
    C.AutomationProposalsPageSchema.parse(
      service.proposals(library(req), req.query),
    ),
  );
  app.post(`${base}/proposals/apply`, (req) =>
    C.AutomationApplyResultSchema.parse(
      service.apply(
        library(req),
        C.AutomationApplyRequestSchema.parse(req.body),
      ),
    ),
  );
  app.post(`${base}/proposals/undo`, (req) =>
    C.AutomationApplyResultSchema.parse(
      service.undo(
        library(req),
        C.AutomationApplyRequestSchema.parse(req.body),
      ),
    ),
  );
  app.get(`${base}/archive-rules`, (req) =>
    C.ArchiveRulesPageSchema.parse(service.rules(library(req), req.query)),
  );
  app.post(`${base}/archive-rules`, (req, reply) =>
    reply
      .code(201)
      .send(
        C.ArchiveRuleSchema.parse(service.createRule(library(req), req.body)),
      ),
  );
  app.patch(`${base}/archive-rules/:id`, (req) =>
    C.ArchiveRuleSchema.parse(
      service.updateRule(library(req), id(req), req.body),
    ),
  );
  app.delete(`${base}/archive-rules/:id`, (req) =>
    service.deleteRule(library(req), id(req), req.body),
  );
  app.post(`${base}/archive-rules/:id/preview`, (req) =>
    C.ArchivePreviewSchema.parse(
      service.previewRule(library(req), id(req), req.body, req.query),
    ),
  );
  app.post(`${base}/archive-rules/:id/run`, (req, reply) =>
    reply
      .code(201)
      .send(
        C.AutomationJobSchema.parse(
          service.runRule(library(req), id(req), req.body),
        ),
      ),
  );
  app.get(`${base}/scripts`, (req) =>
    C.ScriptsPageSchema.parse(service.content.scripts(library(req), req.query)),
  );
  app.post(`${base}/scripts`, { bodyLimit: 524288 }, async (req, reply) => {
    const lib = library(req);
    const { name } = C.UploadQuerySchema.parse(req.query);
    if (!Buffer.isBuffer(req.body))
      throw new AutomationError('SCRIPT_INVALID_BODY');
    return reply
      .code(201)
      .send(
        C.ScriptBreakdownSchema.parse(
          await service.content.importScript(lib, name, req.body),
        ),
      );
  });
  app.get(`${base}/scripts/:id`, (req) =>
    C.ScriptBreakdownSchema.parse(
      service.content.script(library(req), id(req)),
    ),
  );
  app.patch(`${base}/scripts/:id`, async (req) =>
    C.ScriptBreakdownSchema.parse(
      await service.content.updateScript(library(req), id(req), req.body),
    ),
  );
  app.post(`${base}/scripts/:id/analyze`, (req, reply) =>
    reply
      .code(201)
      .send(
        C.AutomationJobSchema.parse(
          service.content.analyzeScript(library(req), id(req), req.body),
        ),
      ),
  );
  app.get(`${base}/documents`, (req) =>
    C.SettingDocumentsPageSchema.parse(
      service.content.documents(library(req), req.query),
    ),
  );
  app.post(`${base}/documents`, (req, reply) =>
    reply
      .code(201)
      .send(
        C.SettingDocumentSchema.parse(
          service.content.createDocument(library(req), req.body),
        ),
      ),
  );
  app.get(`${base}/documents/:id`, (req) =>
    C.SettingDocumentSchema.parse(
      service.content.document(library(req), id(req)),
    ),
  );
  app.patch(`${base}/documents/:id`, (req) =>
    C.SettingDocumentSchema.parse(
      service.content.updateDocument(library(req), id(req), req.body),
    ),
  );
  app.get(`${base}/documents/:id/export`, (req, reply) => {
    const format = (req.query as { format?: unknown }).format ?? 'markdown';
    if (typeof format !== 'string')
      throw new AutomationError('INVALID_EXPORT_FORMAT');
    const result = service.content.exportDocument(
      library(req),
      id(req),
      format,
    );
    return reply
      .type(result.type)
      .header('content-disposition', `attachment; filename="${result.name}"`)
      .send(result.body);
  });
  return service;
}
