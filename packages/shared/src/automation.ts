import { z } from 'zod';
import { CreateTagSchema, IdSchema, TimestampSchema } from './catalog.js';
import { FinalPinSchema } from './process.js';

const label = z.string().trim().min(1).max(200);
const catalogTagName = CreateTagSchema.shape.name;
const safeCode = z.string().regex(/^[A-Z][A-Z0-9_]{0,79}$/);
const dates = { createdAt: TimestampSchema, updatedAt: TimestampSchema };
const identity = { id: IdSchema, libraryId: IdSchema, ...dates };
export const AutomationPageQuerySchema = z
  .object({
    offset: z.coerce.number().int().min(0).default(0),
    limit: z.coerce.number().int().min(1).max(100).default(50),
  })
  .strict();
export const AutomationProviderInfoSchema = z
  .object({
    id: label,
    label,
    kind: z.enum(['metadata-rules', 'http-vision', 'http-text']),
    mode: z.enum(['rules', 'json', 'caption']),
    configured: z.boolean(),
    capabilities: z
      .array(z.enum(['vision-proposals', 'script-analysis']))
      .max(2),
  })
  .strict();
export const AutomationProvenanceSchema = z
  .object({
    providerId: label,
    kind: z.enum([
      'metadata-rules',
      'http-vision',
      'http-text',
      'structured-script',
      'metadata-document',
      'archive-rule',
    ]),
    mode: z.enum(['rules', 'json', 'caption']),
    model: z.string().max(200).nullable(),
    rawText: z.string().max(16000),
    derivation: z.string().max(100).nullable(),
    inputKind: z.enum([
      'metadata',
      'original-raster',
      'version-preview',
      'text',
    ]),
    sourceHash: z.string().max(128),
  })
  .strict();
export const VisionSuggestionsSchema = z
  .object({
    tags: z.array(label).max(20),
    name: label,
    caption: z.string().max(2000).default(''),
  })
  .strict();
export const AutomationJobStatusSchema = z.enum([
  'queued',
  'running',
  'completed',
  'failed',
  'cancelled',
]);
export const AutomationJobSchema = z
  .object({
    ...identity,
    kind: z.enum(['analysis', 'archive', 'script']),
    providerId: label,
    status: AutomationJobStatusSchema,
    pins: z.array(FinalPinSchema).max(10000),
    total: z.number().int().nonnegative(),
    processed: z.number().int().nonnegative(),
    results: z
      .array(
        z
          .object({
            ...FinalPinSchema.shape,
            proposalId: IdSchema.nullable(),
            errorCode: safeCode.nullable(),
          })
          .strict(),
      )
      .max(10000),
    errorCode: safeCode.nullable(),
    ruleId: IdSchema.nullable(),
    archiveRuleSnapshot: z
      .object({
        name: label,
        revision: z.number().int().nonnegative(),
        filters: z.lazy(() => ArchiveFiltersSchema),
      })
      .strict()
      .nullable()
      .optional(),
    scriptId: IdSchema.nullable(),
  })
  .strict();
export const AutomationAnalyzeRequestSchema = z
  .object({
    assetIds: z.array(IdSchema).min(1).max(100),
    providerId: label.default('metadata-rules'),
  })
  .strict();
export const AutomationFieldValueSchema = z.union([
  z.string().max(1000),
  z.array(IdSchema).max(1000),
  z.null(),
]);
export const AutomationChangeSchema = z
  .object({
    ...identity,
    proposalId: IdSchema,
    ...FinalPinSchema.shape,
    field: z.enum(['tagIds', 'displayName', 'archivedAt']),
    beforeValue: AutomationFieldValueSchema,
    afterValue: AutomationFieldValueSchema,
    suggestedTagNames: z.array(label).max(20),
    beforeTagLabels: z
      .array(z.object({ id: IdSchema, name: catalogTagName }).strict())
      .max(1000),
    afterTagLabels: z
      .array(z.object({ id: IdSchema, name: catalogTagName }).strict())
      .max(1000),
    status: z.enum(['pending', 'applied', 'undone']),
    appliedAt: TimestampSchema.nullable(),
    undoneAt: TimestampSchema.nullable(),
  })
  .strict();
export const AutomationProposalSchema = z
  .object({
    ...identity,
    jobId: IdSchema,
    ...FinalPinSchema.shape,
    sourceName: z.string().max(1000),
    sourceHash: z.string().max(128),
    caption: z.string().max(2000),
    provenance: AutomationProvenanceSchema,
    changeIds: z.array(IdSchema).max(3),
  })
  .strict();
export const AutomationProposalViewSchema = AutomationProposalSchema.extend({
  changes: z.array(AutomationChangeSchema).max(3),
}).strict();
export const AutomationProposalQuerySchema = AutomationPageQuerySchema.extend({
  jobId: IdSchema.optional(),
  status: z.enum(['pending', 'applied', 'undone']).optional(),
}).strict();
export const AutomationApplyRequestSchema = z
  .object({
    items: z
      .array(
        z
          .object({
            proposalId: IdSchema,
            expectedVersionId: IdSchema,
            changes: z
              .array(
                z
                  .object({
                    changeId: IdSchema,
                    expectedValue: AutomationFieldValueSchema,
                  })
                  .strict(),
              )
              .min(1)
              .max(3),
          })
          .strict(),
      )
      .min(1)
      .max(100),
  })
  .strict();
export const AutomationApplyResultSchema = z
  .object({
    proposals: z.array(AutomationProposalViewSchema),
    conflicts: z.array(
      z
        .object({ proposalId: IdSchema, changeId: IdSchema, code: safeCode })
        .strict(),
    ),
  })
  .strict();
export const ArchiveFiltersSchema = z
  .object({
    olderThanDays: z.number().min(0).max(36500).default(30),
    folderId: IdSchema.nullable().default(null),
    tagIds: z.array(IdSchema).max(100).default([]),
    maxRating: z.number().int().min(0).max(5).default(5),
  })
  .strict();
export const ArchiveRuleInputSchema = z
  .object({
    name: label,
    enabled: z.boolean().default(false),
    filters: ArchiveFiltersSchema,
  })
  .strict();
export const ArchiveRuleSchema = ArchiveRuleInputSchema.extend({
  ...identity,
  revision: z.number().int().nonnegative(),
  lastJobId: IdSchema.nullable(),
}).strict();
export const ArchiveRuleUpdateSchema = z
  .object({
    name: label.optional(),
    enabled: z.boolean().optional(),
    filters: ArchiveFiltersSchema.optional(),
    expectedRevision: z.number().int().nonnegative(),
  })
  .strict();
export const ArchiveCandidateSchema = z
  .object({
    ...FinalPinSchema.shape,
    name: z.string(),
    reason: z.enum(['eligible', 'final-selection']),
  })
  .strict();
export const ArchivePreviewSchema = z
  .object({
    eligible: z.array(ArchiveCandidateSchema),
    protected: z.array(ArchiveCandidateSchema),
    eligibleTotal: z.number().int().nonnegative(),
    protectedTotal: z.number().int().nonnegative(),
  })
  .strict();
export const ScriptRangeSchema = z
  .object({
    startLine: z.number().int().min(1),
    endLine: z.number().int().min(1),
  })
  .strict()
  .refine((r) => r.endLine >= r.startLine, 'End line precedes start line');
export const ScriptReferenceSchema = ScriptRangeSchema.safeExtend({
  excerpt: z.string().max(524288),
});
export const ScriptEntityInputSchema = z
  .object({
    id: IdSchema.optional(),
    kind: z.enum(['character', 'prop', 'scene']),
    name: label,
    notes: z.string().max(10000).default(''),
    ranges: z.array(ScriptRangeSchema).max(100),
  })
  .strict();
export const ScriptEntitySchema = z
  .object({
    id: IdSchema,
    kind: z.enum(['character', 'prop', 'scene']),
    name: label,
    notes: z.string().max(10000),
    references: z.array(ScriptReferenceSchema).max(100),
  })
  .strict();
export const ScriptBreakdownSchema = z
  .object({
    ...identity,
    title: label,
    sourcePin: FinalPinSchema,
    sourceHash: z.string().max(128),
    lineCount: z.number().int().positive(),
    revision: z.number().int().nonnegative(),
    entities: z.array(ScriptEntitySchema).max(1000),
    provenance: AutomationProvenanceSchema,
  })
  .strict();
export const ScriptUpdateSchema = z
  .object({
    expectedRevision: z.number().int().nonnegative(),
    title: label.optional(),
    entities: z.array(ScriptEntityInputSchema).max(1000),
  })
  .strict();
export const ScriptAnalyzeRequestSchema = z
  .object({ providerId: label })
  .strict();
export const SettingDocumentInputSchema = z
  .object({
    title: label,
    kind: z.enum(['character', 'scene', 'prop', 'general']).default('general'),
    language: z.enum(['en', 'zh-CN']).default('en'),
    pins: z.array(FinalPinSchema).min(1).max(100),
    scriptId: IdSchema.optional(),
    entityIds: z.array(IdSchema).max(100).default([]),
  })
  .strict();
export const SettingDocumentSourceSchema = z
  .object({
    ...FinalPinSchema.shape,
    hash: z.string().max(128),
    name: z.string().max(1000),
    note: z.string().max(100000),
    prompt: z.string().max(100000),
    negativePrompt: z.string().max(100000),
    model: z.string().max(10000),
    source: z.string().max(10000),
    seed: z.string().max(1000),
    width: z.number().nullable(),
    height: z.number().nullable(),
    tags: z.array(catalogTagName).max(1000),
  })
  .strict();
export const SettingDocumentSchema = z
  .object({
    ...identity,
    title: label,
    kind: z.enum(['character', 'scene', 'prop', 'general']),
    language: z.enum(['en', 'zh-CN']),
    revision: z.number().int().nonnegative(),
    markdown: z.string().max(1000000),
    sources: z.array(SettingDocumentSourceSchema).min(1).max(100),
    scriptId: IdSchema.nullable(),
    entities: z.array(ScriptEntitySchema).max(100),
    provenance: z.literal('metadata-document-v1'),
  })
  .strict();
export const SettingDocumentUpdateSchema = z
  .object({
    expectedRevision: z.number().int().nonnegative(),
    title: label.optional(),
    markdown: z.string().max(1000000).optional(),
  })
  .strict();
export const AutomationExportSchema = z
  .object({
    jobs: z.array(
      AutomationJobSchema.refine(
        (j) => !['queued', 'running'].includes(j.status),
        'Active jobs are not portable',
      ),
    ),
    proposals: z.array(AutomationProposalSchema),
    changes: z.array(AutomationChangeSchema),
    rules: z.array(ArchiveRuleSchema),
    scripts: z.array(ScriptBreakdownSchema),
    documents: z.array(SettingDocumentSchema),
    pins: z.array(FinalPinSchema),
  })
  .strict();
export type AutomationProviderInfo = z.infer<
  typeof AutomationProviderInfoSchema
>;
export type AutomationProvenance = z.infer<typeof AutomationProvenanceSchema>;
export type VisionSuggestions = z.infer<typeof VisionSuggestionsSchema>;
export type AutomationJob = z.infer<typeof AutomationJobSchema>;
export type AutomationAnalyzeRequest = z.input<
  typeof AutomationAnalyzeRequestSchema
>;
export type AutomationFieldValue = z.infer<typeof AutomationFieldValueSchema>;
export type AutomationChange = z.infer<typeof AutomationChangeSchema>;
export type AutomationProposal = z.infer<typeof AutomationProposalSchema>;
export type AutomationProposalView = z.infer<
  typeof AutomationProposalViewSchema
>;
export type AutomationApplyRequest = z.infer<
  typeof AutomationApplyRequestSchema
>;
export type AutomationApplyResult = z.infer<typeof AutomationApplyResultSchema>;
export type ArchiveRule = z.infer<typeof ArchiveRuleSchema>;
export type ArchiveRuleInput = z.input<typeof ArchiveRuleInputSchema>;
export type ArchivePreview = z.infer<typeof ArchivePreviewSchema>;
export type ScriptEntity = z.infer<typeof ScriptEntitySchema>;
export type ScriptEntityInput = z.input<typeof ScriptEntityInputSchema>;
export type ScriptBreakdown = z.infer<typeof ScriptBreakdownSchema>;
export type SettingDocument = z.infer<typeof SettingDocumentSchema>;
export type AutomationExport = z.infer<typeof AutomationExportSchema>;
export type AutomationReplayContribution = Omit<AutomationExport, 'pins'>;

export const AutomationProvidersSchema = z.array(AutomationProviderInfoSchema);
const pageFields = {
  total: z.number().int().nonnegative(),
  offset: z.number().int().nonnegative(),
  limit: z.number().int().positive(),
};
export const AutomationJobsPageSchema = z
  .object({ ...pageFields, items: z.array(AutomationJobSchema) })
  .strict();
export const AutomationProposalsPageSchema = z
  .object({ ...pageFields, items: z.array(AutomationProposalViewSchema) })
  .strict();
export const ArchiveRulesPageSchema = z
  .object({ ...pageFields, items: z.array(ArchiveRuleSchema) })
  .strict();
export const ScriptsPageSchema = z
  .object({ ...pageFields, items: z.array(ScriptBreakdownSchema) })
  .strict();
export const SettingDocumentsPageSchema = z
  .object({ ...pageFields, items: z.array(SettingDocumentSchema) })
  .strict();
export const AutomationRevisionRequestSchema = z
  .object({ expectedRevision: z.number().int().nonnegative() })
  .strict();

export const ChatCompletionResponseSchema = z.object({
  choices: z
    .array(
      z.object({
        finish_reason: z.string().nullable().optional(),
        message: z.object({ content: z.string().max(16000) }),
      }),
    )
    .min(1),
});
export const ScriptModelResponseSchema = z
  .object({ entities: z.array(ScriptEntityInputSchema).max(1000) })
  .strict();
