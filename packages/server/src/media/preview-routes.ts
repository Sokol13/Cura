import type { FastifyInstance } from 'fastify';
import {
  IdSchema,
  PreviewCandidatesSchema,
  PreviewFailureSchema,
  PreviewUploadQuerySchema,
  PREVIEW_UPLOAD_LIMIT,
  SuccessResponseSchema,
} from '@cura/shared';
import type { MediaService } from './service.js';
export async function registerPreviewRoutes(
  app: FastifyInstance,
  media: MediaService,
): Promise<void> {
  const id = (params: unknown, key: string) =>
    IdSchema.parse((params as Record<string, unknown>)[key]);
  app.get('/api/libraries/:libraryId/previews', (request) =>
    PreviewCandidatesSchema.parse({
      items: media.listPendingPreviews(id(request.params, 'libraryId')),
    }),
  );
  app.post(
    '/api/versions/:versionId/preview',
    { bodyLimit: PREVIEW_UPLOAD_LIMIT },
    async (request) => {
      const query = PreviewUploadQuerySchema.parse(request.query);
      if (!Buffer.isBuffer(request.body))
        throw Object.assign(new Error('Upload PNG bytes.'), {
          statusCode: 400,
          code: 'INVALID_PREVIEW',
        });
      await media.submitPreview(
        id(request.params, 'versionId'),
        query.sourceHash,
        query.revision,
        request.body,
      );
      return SuccessResponseSchema.parse({ ok: true });
    },
  );
  app.patch('/api/versions/:versionId/preview', (request) => {
    media.previewFailure(
      id(request.params, 'versionId'),
      PreviewFailureSchema.parse(request.body),
    );
    return SuccessResponseSchema.parse({ ok: true });
  });
}
