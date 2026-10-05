import { z } from 'zod';
import { IdSchema, TimestampSchema } from './catalog.js';

const name = z
  .string()
  .trim()
  .min(1)
  .max(255)
  .transform((value) => value.normalize('NFC'));
const coordinate = z.number().min(-10_000_000).max(10_000_000);
const dimension = z.number().min(20).max(20_000);
const entity = {
  id: IdSchema,
  libraryId: IdSchema,
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
};
const position = {
  x: coordinate,
  y: coordinate,
  width: dimension,
  height: dimension,
};
export const BoardPinSchema = z
  .object({ assetId: IdSchema, versionId: IdSchema })
  .strict();
export const BoardViewportSchema = z
  .object({ x: coordinate, y: coordinate, zoom: z.number().min(0.05).max(8) })
  .strict();
export const BoardAxisSchema = z.object({ id: IdSchema, label: name }).strict();
const axes = z
  .array(BoardAxisSchema)
  .min(1)
  .max(50)
  .refine(
    (values) => new Set(values.map((value) => value.id)).size === values.length,
    'Axis IDs must be unique',
  );
export const BoardSchema = z.object({
  ...entity,
  name: z.string(),
  kind: z.enum(['canvas', 'matrix']),
  revision: z.number().int().nonnegative(),
  viewport: BoardViewportSchema,
  rows: z.array(BoardAxisSchema),
  columns: z.array(BoardAxisSchema),
  templateId: IdSchema.nullable(),
  deletedAt: TimestampSchema.nullable(),
});
export const BoardsSchema = z.array(BoardSchema);
export const CreateBoardSchema = z
  .object({
    name,
    kind: z.enum(['canvas', 'matrix']).default('canvas'),
    templateId: IdSchema.optional(),
    rows: axes.optional(),
    columns: axes.optional(),
    matrixPreset: z.enum(['character-angle', 'scene-option']).optional(),
  })
  .strict()
  .superRefine((data, ctx) => {
    if (data.kind === 'matrix' && data.templateId)
      ctx.addIssue({
        code: 'custom',
        message: 'Matrix boards use rows and columns, not a slot template',
      });
    if (
      data.kind === 'canvas' &&
      (data.rows || data.columns || data.matrixPreset)
    )
      ctx.addIssue({
        code: 'custom',
        message: 'Canvas boards cannot have matrix axes',
      });
  });
export const BoardRevisionRequestSchema = z
  .object({ expectedRevision: z.number().int().nonnegative() })
  .strict();
export const UpdateBoardSchema = z
  .object({
    expectedRevision: z.number().int().nonnegative(),
    name: name.optional(),
    viewport: BoardViewportSchema.optional(),
    rows: axes.optional(),
    columns: axes.optional(),
  })
  .strict();
const itemFields = {
  kind: z.enum(['asset', 'text', 'group']),
  ...position,
  groupId: IdSchema.nullable(),
  label: z.string().max(10_000),
  text: z.string().max(100_000),
  assetId: IdSchema.nullable(),
  versionId: IdSchema.nullable(),
};
export const BoardItemSchema = z.object({
  ...entity,
  boardId: IdSchema,
  ...itemFields,
});
export const BoardItemInputSchema = z
  .object({ id: IdSchema, ...itemFields })
  .strict()
  .refine(
    (item) =>
      item.kind === 'asset'
        ? item.assetId !== null && item.versionId !== null
        : item.assetId === null && item.versionId === null,
    'Only asset items have an exact asset/version pin',
  );
const edgeFields = {
  sourceId: IdSchema,
  targetId: IdSchema,
  label: z.string().max(10_000),
};
export const BoardEdgeSchema = z.object({
  ...entity,
  boardId: IdSchema,
  ...edgeFields,
});
export const BoardEdgeInputSchema = z
  .object({ id: IdSchema, ...edgeFields })
  .strict();
export const BoardSlotSchema = z.object({
  ...entity,
  boardId: IdSchema,
  label: z.string(),
  ...position,
  rowId: IdSchema.nullable(),
  columnId: IdSchema.nullable(),
  templateKey: z.string().nullable(),
  revision: z.number().int().nonnegative(),
  currentPin: BoardPinSchema.nullable(),
  deletedAt: TimestampSchema.nullable(),
});
export const BoardSlotLayoutSchema = z
  .object({
    id: IdSchema,
    label: name.optional(),
    x: coordinate.optional(),
    y: coordinate.optional(),
    width: dimension.optional(),
    height: dimension.optional(),
  })
  .strict();
export const SaveBoardLayoutSchema = z
  .object({
    expectedRevision: z.number().int().nonnegative(),
    viewport: BoardViewportSchema.optional(),
    items: z.array(BoardItemInputSchema).max(5000),
    edges: z.array(BoardEdgeInputSchema).max(10000),
    slotLayouts: z.array(BoardSlotLayoutSchema).max(2500).optional(),
  })
  .strict();
export const CreateBoardSlotSchema = z
  .object({
    expectedRevision: z.number().int().nonnegative(),
    label: name,
    x: coordinate.default(0),
    y: coordinate.default(0),
    width: dimension.default(240),
    height: dimension.default(180),
  })
  .strict();
export const AssignBoardSlotSchema = z
  .object({
    expectedRevision: z.number().int().nonnegative(),
    pin: BoardPinSchema.nullable(),
  })
  .strict();
export const SlotActorSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('local') }).strict(),
  z
    .object({
      kind: z.literal('account'),
      id: IdSchema,
      email: z.string().max(320).nullable(),
    })
    .strict(),
  z
    .object({ kind: z.literal('system'), reason: z.literal('sync-resolution') })
    .strict(),
]);
export const SlotRevisionSchema = z.object({
  ...entity,
  slotId: IdSchema,
  ordinal: z.number().int().positive(),
  pin: BoardPinSchema.nullable(),
  actor: SlotActorSchema.optional(),
});
export const SlotHistorySourceSchema = z
  .object({
    assetId: IdSchema,
    versionId: IdSchema,
    name: z.string(),
    type: z.string(),
    versionOrdinal: z.number().int().positive(),
  })
  .strict();
export const SlotHistoryEntrySchema = SlotRevisionSchema.extend({
  source: SlotHistorySourceSchema.nullable(),
});
export const SlotHistorySchema = z.array(SlotHistoryEntrySchema);
export const BoardDocumentSchema = z.object({
  board: BoardSchema,
  items: z.array(BoardItemSchema),
  edges: z.array(BoardEdgeSchema),
  slots: z.array(BoardSlotSchema),
});
export const TemplateSlotSchema = z
  .object({ key: z.string().trim().min(1).max(100), label: name, ...position })
  .strict();
const templateSlots = z
  .array(TemplateSlotSchema)
  .min(1)
  .max(100)
  .refine(
    (slots) => new Set(slots.map((slot) => slot.key)).size === slots.length,
    'Template slot keys must be unique',
  );
export const SlotTemplateSchema = z.object({
  ...entity,
  name: z.string(),
  preset: z.enum(['character', 'scene', 'product', 'brand']).nullable(),
  slots: templateSlots,
  deletedAt: TimestampSchema.nullable(),
});
export const SlotTemplatesSchema = z.array(SlotTemplateSchema);
export const CreateSlotTemplateSchema = z
  .object({ name, slots: templateSlots })
  .strict();
export const UpdateSlotTemplateSchema = z
  .object({ name: name.optional(), slots: templateSlots.optional() })
  .strict();
export const BoardsExportSchema = z.object({
  boards: z.array(BoardSchema),
  items: z.array(BoardItemSchema),
  edges: z.array(BoardEdgeSchema),
  templates: z.array(SlotTemplateSchema),
  slots: z.array(BoardSlotSchema),
  revisions: z.array(SlotRevisionSchema),
});

export const BoardEventSchema = z.object({
  type: z.literal('board'),
  libraryId: IdSchema,
  boardId: IdSchema.optional(),
});
export type BoardEvent = z.infer<typeof BoardEventSchema>;

export type BoardPin = z.infer<typeof BoardPinSchema>;
export type BoardViewport = z.infer<typeof BoardViewportSchema>;
export type BoardAxis = z.infer<typeof BoardAxisSchema>;
export type Board = z.infer<typeof BoardSchema>;
export type BoardItem = z.infer<typeof BoardItemSchema>;
export type BoardEdge = z.infer<typeof BoardEdgeSchema>;
export type BoardSlot = z.infer<typeof BoardSlotSchema>;
export type BoardDocument = z.infer<typeof BoardDocumentSchema>;
export type SlotActor = z.infer<typeof SlotActorSchema>;
export type SlotHistorySource = z.infer<typeof SlotHistorySourceSchema>;
export type SlotHistoryEntry = z.infer<typeof SlotHistoryEntrySchema>;
export type SlotRevision = z.infer<typeof SlotRevisionSchema>;
export type SlotTemplate = z.infer<typeof SlotTemplateSchema>;
export type TemplateSlot = z.infer<typeof TemplateSlotSchema>;
export type BoardsExport = z.infer<typeof BoardsExportSchema>;
export type CreateBoard = z.input<typeof CreateBoardSchema>;
export type UpdateBoard = z.input<typeof UpdateBoardSchema>;
export type SaveBoardLayout = z.input<typeof SaveBoardLayoutSchema>;
export type CreateBoardSlot = z.input<typeof CreateBoardSlotSchema>;
export type AssignBoardSlot = z.input<typeof AssignBoardSlotSchema>;
export type CreateSlotTemplate = z.input<typeof CreateSlotTemplateSchema>;
export type UpdateSlotTemplate = z.input<typeof UpdateSlotTemplateSchema>;
export type BoardItemInput = z.input<typeof BoardItemInputSchema>;
export type BoardEdgeInput = z.input<typeof BoardEdgeInputSchema>;
