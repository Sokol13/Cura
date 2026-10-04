import { z } from 'zod';
import { ColorSchema, IdSchema, TimestampSchema } from './catalog.js';

const name = z.string().trim().min(1).max(200);
const entity = {
  id: IdSchema,
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
};
export const BrandPinSchema = z
  .object({ assetId: IdSchema, versionId: IdSchema })
  .strict();
const colorInput = z
  .object({ id: IdSchema.optional(), name, hex: ColorSchema })
  .strict();
const fontInput = z
  .object({
    id: IdSchema.optional(),
    name,
    role: z.string().max(200),
    pin: BrandPinSchema,
  })
  .strict();
const logoInput = z
  .object({ id: IdSchema.optional(), name, pin: BrandPinSchema })
  .strict();
export const BrandColorSchema = z.object({
  ...entity,
  brandId: IdSchema,
  name: z.string(),
  hex: ColorSchema,
  rgb: z.tuple([z.number(), z.number(), z.number()]),
  cmyk: z.tuple([z.number(), z.number(), z.number(), z.number()]),
  position: z.number().int(),
});
export const BrandFontSchema = z.object({
  ...entity,
  brandId: IdSchema,
  name: z.string(),
  role: z.string(),
  pin: BrandPinSchema,
  position: z.number().int(),
});
export const BrandLogoSchema = z.object({
  ...entity,
  brandId: IdSchema,
  name: z.string(),
  pin: BrandPinSchema,
  position: z.number().int(),
});
export const CreateBrandSchema = z.object({ name }).strict();
export const SaveBrandSchema = z
  .object({
    name,
    guidelines: z.string().max(200_000),
    expectedRevision: z.number().int().nonnegative(),
    colors: z.array(colorInput).max(256),
    fonts: z.array(fontInput).max(64),
    logos: z.array(logoInput).max(128),
  })
  .strict();
export const BrandSchema = z.object({
  ...entity,
  libraryId: IdSchema,
  name: z.string(),
  guidelines: z.string(),
  revision: z.number().int().nonnegative(),
  colors: z.array(BrandColorSchema),
  fonts: z.array(BrandFontSchema),
  logos: z.array(BrandLogoSchema),
});
export const BrandsSchema = z.array(BrandSchema);
const cmfInput = z
  .object({
    id: IdSchema.optional(),
    name,
    colorName: z.string().max(200),
    hex: ColorSchema,
    process: z.string().max(20_000),
    pin: BrandPinSchema,
  })
  .strict();
export const CmfEntrySchema = z.object({
  ...entity,
  boardId: IdSchema,
  name: z.string(),
  colorName: z.string(),
  hex: ColorSchema,
  process: z.string(),
  pin: BrandPinSchema,
  position: z.number().int(),
});
export const CreateCmfBoardSchema = z.object({ name }).strict();
export const SaveCmfBoardSchema = z
  .object({
    name,
    expectedRevision: z.number().int().nonnegative(),
    entries: z.array(cmfInput).max(512),
  })
  .strict();
export const CmfBoardSchema = z.object({
  ...entity,
  libraryId: IdSchema,
  name: z.string(),
  revision: z.number().int().nonnegative(),
  entries: z.array(CmfEntrySchema),
});
export const CmfBoardsSchema = z.array(CmfBoardSchema);
export const BrandExportRecordsSchema = z.object({
  brands: BrandsSchema,
  cmfBoards: CmfBoardsSchema,
  pins: z.array(BrandPinSchema),
});
export const BrandPortableFileSchema = z.object({
  assetId: IdSchema,
  versionId: IdSchema,
  name: z.string(),
  type: z.string(),
  hash: z.string(),
  base64: z.string(),
  previewDataUrl: z.string().nullable(),
});
export const BrandPackageSchema = z.object({
  format: z.literal('cura-brand'),
  schemaVersion: z.literal(1),
  colorSpace: z.literal('sRGB; CMYK is an unprofiled approximation'),
  brand: BrandSchema,
  files: z.array(BrandPortableFileSchema),
});
export type Brand = z.infer<typeof BrandSchema>;
export type BrandPin = z.infer<typeof BrandPinSchema>;
export type BrandColor = z.infer<typeof BrandColorSchema>;
export type BrandFont = z.infer<typeof BrandFontSchema>;
export type BrandLogo = z.infer<typeof BrandLogoSchema>;
export type SaveBrand = z.infer<typeof SaveBrandSchema>;
export type CmfBoard = z.infer<typeof CmfBoardSchema>;
export type CmfEntry = z.infer<typeof CmfEntrySchema>;
export type SaveCmfBoard = z.infer<typeof SaveCmfBoardSchema>;
export type BrandExportRecords = z.infer<typeof BrandExportRecordsSchema>;
export type BrandPackage = z.infer<typeof BrandPackageSchema>;

export function colorValues(hex: string): {
  hex: string;
  rgb: [number, number, number];
  cmyk: [number, number, number, number];
} {
  const normalized = ColorSchema.parse(hex).toLowerCase();
  const rgb: [number, number, number] = [1, 3, 5].map((index) =>
    parseInt(normalized.slice(index, index + 2), 16),
  ) as [number, number, number];
  const k = 1 - Math.max(...rgb) / 255;
  const round = (value: number) => Math.round(value * 10000) / 100;
  const cmyk: [number, number, number, number] =
    k === 1
      ? [0, 0, 0, 100]
      : [
          round((1 - rgb[0] / 255 - k) / (1 - k)),
          round((1 - rgb[1] / 255 - k) / (1 - k)),
          round((1 - rgb[2] / 255 - k) / (1 - k)),
          round(k),
        ];
  return { hex: normalized, rgb, cmyk };
}
export function rgbToHex(values: number[]): string {
  const rgb = z
    .tuple([
      z.number().int().min(0).max(255),
      z.number().int().min(0).max(255),
      z.number().int().min(0).max(255),
    ])
    .parse(values);
  return `#${rgb.map((value) => value.toString(16).padStart(2, '0')).join('')}`;
}
export function cmykToHex(values: number[]): string {
  const channel = z.number().min(0).max(100);
  const [c, m, y, k] = z
    .tuple([channel, channel, channel, channel])
    .parse(values);
  return rgbToHex(
    [c, m, y].map((value) =>
      Math.round(255 * (1 - value / 100) * (1 - k / 100)),
    ),
  );
}
