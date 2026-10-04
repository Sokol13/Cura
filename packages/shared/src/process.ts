import { z } from 'zod';
import { AssetVersionSchema, IdSchema, TimestampSchema } from './catalog.js';

export const FinalPinSchema = z
  .object({ assetId: IdSchema, versionId: IdSchema })
  .strict();
export const FinalOwnerSchema = z
  .object({
    libraryId: IdSchema,
    ownerKind: z.enum(['manual', 'slot']),
    ownerId: IdSchema,
  })
  .strict();
export const FinalSelectionSchema = FinalOwnerSchema.extend({
  id: IdSchema,
  ...FinalPinSchema.shape,
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
});
export const RecordedGenerationSchema = z.object({
  id: IdSchema,
  libraryId: IdSchema,
  hash: z.string(),
  source: z.string(),
  model: z.string(),
  origin: z.enum(['recorded', 'legacy-backfill']),
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
});
export const ManualSelectionRequestSchema = z
  .object({
    versionId: IdSchema,
    expectedSelectionVersionId: IdSchema.nullable(),
    selected: z.boolean(),
  })
  .strict();
export type ManualSelectionRequest = z.infer<
  typeof ManualSelectionRequestSchema
>;
export const TimelineEntrySchema = z.object({
  version: AssetVersionSchema,
  generationId: IdSchema,
  finalSelections: z.array(FinalSelectionSchema),
});
export const ProcessTimelineSchema = z.object({
  assetId: IdSchema,
  entries: z.array(TimelineEntrySchema),
});
export const ProcessGroupSchema = z.object({
  key: z.string(),
  outputs: z.number().int().nonnegative(),
  selectedOutputs: z.number().int().nonnegative(),
  hitRate: z.number().min(0).max(1),
});
export const ProcessStatisticsSchema = z.object({
  libraryId: IdSchema,
  outputs: z.number().int().nonnegative(),
  selectedOutputs: z.number().int().nonnegative(),
  hitRate: z.number().min(0).max(1),
  models: z.array(ProcessGroupSchema),
  sources: z.array(ProcessGroupSchema),
  countingMethod: z.literal('distinct-recorded-generations'),
  legacyBackfilledOutputs: z.number().int().nonnegative(),
});
export const GenerateRequestSchema = z
  .object({
    provider: z.literal('mock').default('mock'),
    prompt: z.string().trim().min(1).max(10000),
    negativePrompt: z.string().max(10000).default(''),
    model: z.string().trim().min(1).max(200).default('cura-mock-v1'),
    seed: z
      .string()
      .regex(/^\d{1,20}$/)
      .refine(
        (value) => BigInt(value) <= 18446744073709551615n,
        'Seed must fit an unsigned 64-bit integer',
      )
      .default('42'),
    width: z.number().int().min(64).max(1024).default(512),
    height: z.number().int().min(64).max(1024).default(384),
    count: z.number().int().min(1).max(4).default(1),
    mockOutcome: z.enum(['complete', 'fail']).default('complete'),
  })
  .strict();
export const GenerationJobSchema = z.object({
  id: IdSchema,
  libraryId: IdSchema,
  provider: z.literal('mock'),
  status: z.enum(['queued', 'running', 'completed', 'failed', 'cancelled']),
  progress: z.number().min(0).max(1),
  request: GenerateRequestSchema,
  assetIds: z.array(IdSchema),
  error: z.string().nullable(),
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
});
export const GenerationJobsSchema = z.array(GenerationJobSchema);
export const ProviderInfoSchema = z.object({
  id: z.literal('mock'),
  name: z.string(),
  isMock: z.literal(true),
});
export type FinalPin = z.infer<typeof FinalPinSchema>;
export type FinalOwner = z.infer<typeof FinalOwnerSchema>;
export type FinalSelection = z.infer<typeof FinalSelectionSchema>;
export type RecordedGeneration = z.infer<typeof RecordedGenerationSchema>;
export type ProcessTimeline = z.infer<typeof ProcessTimelineSchema>;
export type ProcessStatistics = z.infer<typeof ProcessStatisticsSchema>;
export type GenerateRequest = z.input<typeof GenerateRequestSchema>;
export type GenerateInput = z.output<typeof GenerateRequestSchema>;
export type GenerationJob = z.infer<typeof GenerationJobSchema>;
