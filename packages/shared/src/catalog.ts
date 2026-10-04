import { z } from 'zod';

export const IdSchema = z.uuid();
export const TimestampSchema = z.iso.datetime();
export const ColorSchema = z.string().regex(/^#[\da-f]{6}$/i);
const NameSchema = z
  .string()
  .trim()
  .min(1)
  .max(255)
  .transform((s) => s.normalize('NFC'));
const timestamps = { createdAt: TimestampSchema, updatedAt: TimestampSchema };
const entity = { id: IdSchema, ...timestamps };
const JsonSchema = z.record(z.string(), z.unknown());
export const ErrorResponseSchema = z.object({
  error: z.string(),
  code: z.string(),
});
export const SuccessResponseSchema = z.object({ ok: z.literal(true) });

export const CreateLibrarySchema = z.object({ name: NameSchema }).strict();
export const UpdateLibrarySchema = CreateLibrarySchema;
export const LibrarySchema = z.object({ ...entity, name: z.string() });
export const LibrariesSchema = z.array(LibrarySchema);
export const RegisterRootSchema = z
  .object({ path: z.string().min(1).max(4096) })
  .strict();
export const LibraryRootSchema = z.object({
  ...entity,
  libraryId: IdSchema,
  path: z.string(),
  kind: z.enum(['reference', 'inbox']),
});
export const LibraryRootsSchema = z.array(LibraryRootSchema);
export const DirectoryQuerySchema = z
  .object({ path: z.string().max(4096).optional() })
  .strict();
export const DirectoryListSchema = z.object({
  path: z.string(),
  parent: z.string().nullable(),
  directories: z.array(z.object({ name: z.string(), path: z.string() })),
});
export const UploadQuerySchema = z
  .object({
    name: NameSchema.refine(
      (s) =>
        !/[\\/<>:|?*]/.test(s) &&
        ![...s].some((character) => character.charCodeAt(0) < 32) &&
        !/[. ]$/.test(s) &&
        !/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(s),
      'Use a portable filename without reserved names or path separators',
    ),
  })
  .strict();

export const GenerationSchema = z.object({
  prompt: z.string(),
  negativePrompt: z.string(),
  model: z.string(),
  seed: z.string(),
  source: z.string(),
  params: JsonSchema,
});
const fileFields = {
  hash: z.string(),
  type: z.string(),
  size: z.number().int().nonnegative(),
  width: z.number().int().positive().nullable(),
  height: z.number().int().positive().nullable(),
  colors: z.array(ColorSchema),
  phash: z.string(),
  exif: JsonSchema,
  ...GenerationSchema.shape,
};
export const CreateTagGroupSchema = z.object({ name: NameSchema }).strict();
export const UpdateTagGroupSchema = CreateTagGroupSchema;
export const TagGroupSchema = z.object({
  ...entity,
  libraryId: IdSchema,
  name: z.string(),
});
export const CreateTagSchema = z
  .object({
    name: NameSchema,
    color: ColorSchema.default('#ff8a3d'),
    groupId: IdSchema.nullable().default(null),
  })
  .strict();
export const UpdateTagSchema = z
  .object({
    name: NameSchema.optional(),
    color: ColorSchema.optional(),
    groupId: IdSchema.nullable().optional(),
  })
  .strict();
export const TagSchema = z.object({
  ...entity,
  libraryId: IdSchema,
  name: z.string(),
  color: ColorSchema,
  groupId: IdSchema.nullable(),
});
export const TagGroupsSchema = z.array(TagGroupSchema);
export const TagsSchema = z.array(TagSchema);
export const AssetSchema = z.object({
  ...entity,
  libraryId: IdSchema,
  rootId: IdSchema,
  relativePath: z.string(),
  name: z.string(),
  ...fileFields,
  currentVersionId: IdSchema,
  missing: z.boolean().optional(),
  rating: z.number().int().min(0).max(5),
  note: z.string(),
  folderId: IdSchema.nullable(),
  deletedAt: TimestampSchema.nullable(),
  finalized: z.boolean(),
  tags: z.array(TagSchema),
});
export const AssetVersionSchema = z.object({
  ...entity,
  assetId: IdSchema,
  ordinal: z.number().int().positive(),
  name: z.string(),
  ...fileFields,
});
export const AssetVersionsSchema = z.array(AssetVersionSchema);
const optionalInteger = (minimum: number, maximum = Number.MAX_SAFE_INTEGER) =>
  z.coerce.number().int().min(minimum).max(maximum).optional();
export const AssetQuerySchema = z
  .object({
    q: z.string().trim().max(1000).optional(),
    folderId: IdSchema.optional(),
    tagId: IdSchema.optional(),
    rating: optionalInteger(0, 5),
    type: z.string().max(100).optional(),
    color: ColorSchema.optional(),
    source: z.string().max(500).optional(),
    after: TimestampSchema.optional(),
    before: TimestampSchema.optional(),
    minWidth: optionalInteger(0),
    minHeight: optionalInteger(0),
    maxWidth: optionalInteger(0),
    maxHeight: optionalInteger(0),
    similarTo: IdSchema.optional(),
    trash: z
      .preprocess(
        (v) => (v === 'true' ? true : v === 'false' ? false : v),
        z.boolean(),
      )
      .default(false),
    offset: z.coerce.number().int().nonnegative().default(0),
    limit: z.coerce.number().int().min(1).max(200).default(100),
  })
  .strict();
export const AssetPageSchema = z.object({
  items: z.array(AssetSchema),
  total: z.number().int().nonnegative(),
});
export const UpdateAssetSchema = GenerationSchema.partial()
  .extend({
    rating: z.number().int().min(0).max(5).optional(),
    note: z.string().max(100000).optional(),
    folderId: IdSchema.nullable().optional(),
    finalized: z.boolean().optional(),
    tagIds: z.array(IdSchema).max(1000).optional(),
  })
  .strict();
export const BatchAssetsSchema = z
  .object({
    assetIds: z.array(IdSchema).min(1).max(1000),
    patch: UpdateAssetSchema.optional(),
    action: z.enum(['trash', 'restore']).optional(),
    addTagIds: z.array(IdSchema).max(1000).optional(),
    removeTagIds: z.array(IdSchema).max(1000).optional(),
  })
  .strict();
export const BatchAssetsResponseSchema = z.object({
  items: z.array(AssetSchema),
});
export const CreateFolderSchema = z
  .object({ name: NameSchema, parentId: IdSchema.nullable().default(null) })
  .strict();
export const UpdateFolderSchema = z
  .object({
    name: NameSchema.optional(),
    parentId: IdSchema.nullable().optional(),
  })
  .strict();
export const FolderSchema = z.object({
  ...entity,
  libraryId: IdSchema,
  name: z.string(),
  parentId: IdSchema.nullable(),
});
export const FoldersSchema = z.array(FolderSchema);
export const CreateCollectionSchema = z
  .object({ name: NameSchema, rules: AssetQuerySchema })
  .strict();
export const UpdateCollectionSchema = CreateCollectionSchema.partial();
export const CollectionSchema = z.object({
  ...entity,
  libraryId: IdSchema,
  name: z.string(),
  rules: AssetQuerySchema,
});
export const CollectionsSchema = z.array(CollectionSchema);
export const CreateAnnotationSchema = z
  .object({
    versionId: IdSchema,
    x: z.number().min(0).max(1),
    y: z.number().min(0).max(1),
    text: z.string().trim().min(1).max(10000),
  })
  .strict();
export const AnnotationSchema = z.object({
  ...entity,
  assetId: IdSchema,
  ...CreateAnnotationSchema.shape,
});
export const AnnotationsSchema = z.array(AnnotationSchema);
export const AnnotationQuerySchema = z
  .object({ versionId: IdSchema.optional() })
  .strict();
export const SettingsSchema = z
  .object({
    activeLibraryId: IdSchema.nullable().default(null),
    language: z.enum(['zh-CN', 'en']).default('zh-CN'),
    theme: z.enum(['dark', 'light', 'system']).default('dark'),
    layout: z.enum(['grid', 'list']).default('grid'),
    sidebarWidth: z.number().min(160).max(600).default(240),
    inspectorWidth: z.number().min(240).max(800).default(320),
  })
  .strict();
export const UpdateSettingsSchema = z
  .object({
    activeLibraryId: IdSchema.nullable().optional(),
    language: z.enum(['zh-CN', 'en']).optional(),
    theme: z.enum(['dark', 'light', 'system']).optional(),
    layout: z.enum(['grid', 'list']).optional(),
    sidebarWidth: z.number().min(160).max(600).optional(),
    inspectorWidth: z.number().min(240).max(800).optional(),
  })
  .strict();
export const CatalogEventSchema = z.object({
  type: z.enum(['scan', 'asset', 'error', 'thumbnail']),
  libraryId: IdSchema,
  rootId: IdSchema.optional(),
  assetId: IdSchema.optional(),
  completed: z.number().int().nonnegative().optional(),
  total: z.number().int().nonnegative().optional(),
  message: z.string().optional(),
});

export type Library = z.infer<typeof LibrarySchema>;
export type LibraryRoot = z.infer<typeof LibraryRootSchema>;
export type Generation = z.infer<typeof GenerationSchema>;
export type Asset = z.infer<typeof AssetSchema>;
export type AssetVersion = z.infer<typeof AssetVersionSchema>;
export type AssetQuery = z.input<typeof AssetQuerySchema>;
export type AssetPage = z.infer<typeof AssetPageSchema>;
export type UpdateAsset = z.infer<typeof UpdateAssetSchema>;
export type BatchAssets = z.infer<typeof BatchAssetsSchema>;
export type Folder = z.infer<typeof FolderSchema>;
export type Tag = z.infer<typeof TagSchema>;
export type TagGroup = z.infer<typeof TagGroupSchema>;
export type Collection = z.infer<typeof CollectionSchema>;
export type Annotation = z.infer<typeof AnnotationSchema>;
export type Settings = z.infer<typeof SettingsSchema>;
export type CatalogEvent = z.infer<typeof CatalogEventSchema>;
export type CreateLibrary = z.input<typeof CreateLibrarySchema>;
export type CreateFolder = z.input<typeof CreateFolderSchema>;
export type UpdateFolder = z.input<typeof UpdateFolderSchema>;
export type CreateTag = z.input<typeof CreateTagSchema>;
export type UpdateTag = z.input<typeof UpdateTagSchema>;
export type CreateTagGroup = z.input<typeof CreateTagGroupSchema>;
export type CreateCollection = z.input<typeof CreateCollectionSchema>;
export type UpdateCollection = z.input<typeof UpdateCollectionSchema>;
export type CreateAnnotation = z.input<typeof CreateAnnotationSchema>;
export type UpdateSettings = z.input<typeof UpdateSettingsSchema>;
