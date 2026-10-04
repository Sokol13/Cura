import { z } from 'zod';
import { IdSchema } from './catalog.js';

export const PREVIEW_RENDERER = 'cura-rich-v1';
export const PREVIEW_UPLOAD_LIMIT = 4 * 1024 * 1024;
export const RichFormatSchema = z.enum([
  'glb',
  'obj',
  'psd',
  'pdf',
  'mp4',
  'mov',
]);
export type RichFormat = z.infer<typeof RichFormatSchema>;
export function richPreviewFormat(
  name: string,
  type: string,
): RichFormat | null {
  if (/^image\/(png|jpeg|webp|gif|avif|svg\+xml)$/.test(type)) return null;
  const extension = name.split('.').at(-1)?.toLowerCase();
  const parsed = RichFormatSchema.safeParse(extension);
  return parsed.success ? parsed.data : null;
}
export const PreviewCandidateSchema = z.object({
  id: IdSchema,
  assetId: IdSchema,
  sourceHash: z.string().regex(/^[a-f0-9]{64}$/),
  name: z.string(),
  size: z.number().int().nonnegative(),
  format: RichFormatSchema,
  revision: z.number().int().nonnegative(),
});
export const PreviewCandidatesSchema = z.object({
  items: z.array(PreviewCandidateSchema).max(16),
});
export const PreviewUploadQuerySchema = z
  .object({
    sourceHash: z.string().regex(/^[a-f0-9]{64}$/),
    revision: z.coerce.number().int().nonnegative(),
    renderer: z.literal(PREVIEW_RENDERER),
  })
  .strict();
export const PreviewFailureSchema = z
  .object({
    sourceHash: PreviewUploadQuerySchema.shape.sourceHash,
    revision: z.number().int().nonnegative(),
    state: z.enum(['unsupported', 'failed']),
    error: z.enum([
      'SIZE_LIMIT',
      'PIXEL_LIMIT',
      'MODEL_LIMIT',
      'EXTERNAL_RESOURCE',
      'UNSUPPORTED_FORMAT',
      'VIDEO_CODEC',
      'WEBGL_UNAVAILABLE',
      'PDF_PASSWORD',
      'INVALID_FILE',
      'TIMEOUT',
      'RENDER_FAILED',
    ]),
  })
  .strict();
export type PreviewCandidate = z.infer<typeof PreviewCandidateSchema>;
export type PreviewFailure = z.infer<typeof PreviewFailureSchema>;
