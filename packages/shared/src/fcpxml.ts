import { z } from 'zod';
import { IdSchema, TimestampSchema } from './catalog.js';

const isXmlText = (value: string) =>
  Array.from(value).every((character) => {
    const point = character.codePointAt(0)!;
    return (
      point === 9 ||
      point === 10 ||
      point === 13 ||
      (point >= 0x20 && point <= 0xd7ff) ||
      (point >= 0xe000 && point <= 0xfffd) ||
      (point >= 0x10000 && point <= 0x10ffff)
    );
  });
const label = z
  .string()
  .max(300)
  .refine(isXmlText, 'Use characters supported by XML 1.0')
  .transform((value) => value.normalize('NFC'));
export const FcpxmlTimebaseSchema = z.enum(['24', '25', '30', '24000/1001']);
/** Exact frames per second, never a rounded decimal approximation. */
export const FcpxmlSourceRateSchema = z
  .string()
  .regex(/^\d{1,10}(?:\/\d{1,10})?$/)
  .refine((value) => {
    if (!/^\d{1,10}(?:\/\d{1,10})?$/.test(value)) return false;
    const [numerator, denominator = '1'] = value.split('/');
    const n = BigInt(numerator!),
      d = BigInt(denominator);
    return (
      n > 0n && d > 0n && n <= 4294967295n && d <= 4294967295n && n <= 240n * d
    );
  }, 'Source frame rate must be positive, at most 240 fps, with 32-bit components');
export const FcpxmlVideoTimingSchema = z
  .object({
    frameRate: FcpxmlSourceRateSchema,
    durationFrames: z.number().int().min(1).max(2147483647),
    width: z.number().int().min(1).max(16384),
    height: z.number().int().min(1).max(16384),
    audio: z.enum(['none', 'mono', 'stereo']),
    audioRate: z
      .union([
        z.literal(32000),
        z.literal(44100),
        z.literal(48000),
        z.literal(88200),
        z.literal(96000),
        z.literal(176400),
        z.literal(192000),
      ])
      .optional(),
  })
  .strict()
  .refine(
    (value) =>
      value.audio === 'none'
        ? value.audioRate === undefined
        : value.audioRate !== undefined,
    'Choose the actual source audio layout and sample rate',
  );
export const FcpxmlClipSchema = z
  .object({
    id: IdSchema,
    assetId: IdSchema,
    versionId: IdSchema,
    label: label.default(''),
    durationFrames: z.number().int().min(1).max(2147483647),
    inFrames: z.number().int().min(0).max(2147483647).default(0),
    videoTiming: FcpxmlVideoTimingSchema.optional(),
  })
  .strict();
export const CreateFcpxmlSchema = z
  .object({
    name: label.refine((value) => value.trim().length > 0, 'Name the timeline'),
    timebase: FcpxmlTimebaseSchema.default('25'),
    width: z.number().int().min(16).max(8192).default(1920),
    height: z.number().int().min(16).max(8192).default(1080),
    clips: z.array(FcpxmlClipSchema).min(1).max(1000),
  })
  .strict()
  .refine(
    (value) =>
      new Set(value.clips.map((clip) => clip.id)).size === value.clips.length,
    'Every timeline entry needs a distinct identity',
  );
export const FcpxmlProblemSchema = z.object({
  code: z.string(),
  message: z.string(),
  clipId: IdSchema.optional(),
  versionId: IdSchema.optional(),
});
export const FcpxmlMediaSchema = z.object({
  resourceId: z.string(),
  assetId: IdSchema,
  versionId: IdSchema,
  originalName: z.string(),
  name: z.string(),
  path: z.string(),
  hash: z.string().regex(/^[a-f\d]{64}$/i),
  size: z.number().int().nonnegative(),
  type: z.string(),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  videoTiming: FcpxmlVideoTimingSchema.optional(),
});
export const FcpxmlManifestSchema = z.object({
  format: z.literal('cura-fcpxml/1'),
  fcpxmlVersion: z.literal('1.7'),
  libraryId: IdSchema,
  exportedAt: TimestampSchema,
  timeline: CreateFcpxmlSchema,
  duration: z.string(),
  media: z.array(FcpxmlMediaSchema),
});
export const FcpxmlJobSchema = z.object({
  id: IdSchema,
  libraryId: IdSchema,
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
  status: z.enum(['queued', 'running', 'completed', 'failed']),
  progress: z.number().min(0).max(1),
  request: CreateFcpxmlSchema,
  filename: z.string().nullable(),
  duration: z.string().nullable(),
  bytes: z.number().int().nonnegative(),
  problems: z.array(FcpxmlProblemSchema),
  error: z.string().nullable(),
});
export const FcpxmlJobsSchema = z.array(FcpxmlJobSchema);
export type FcpxmlTimebase = z.infer<typeof FcpxmlTimebaseSchema>;
export type FcpxmlVideoTiming = z.infer<typeof FcpxmlVideoTimingSchema>;
export type FcpxmlClip = z.infer<typeof FcpxmlClipSchema>;
export type CreateFcpxml = z.input<typeof CreateFcpxmlSchema>;
export type FcpxmlInput = z.output<typeof CreateFcpxmlSchema>;
export type FcpxmlManifest = z.infer<typeof FcpxmlManifestSchema>;
export type FcpxmlMedia = z.infer<typeof FcpxmlMediaSchema>;
export type FcpxmlProblem = z.infer<typeof FcpxmlProblemSchema>;
export type FcpxmlJob = z.infer<typeof FcpxmlJobSchema>;
