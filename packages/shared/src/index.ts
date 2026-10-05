import { z } from 'zod';

export const HealthResponseSchema = z.object({ status: z.literal('ok') });
export const HealthResponseJsonSchema = z.toJSONSchema(HealthResponseSchema, {
  target: 'draft-7',
});
export type HealthResponse = z.infer<typeof HealthResponseSchema>;

export * from './catalog.js';
export * from './brands.js';
export * from './boards.js';
export * from './board-presets.js';
export * from './process.js';
export * from './exports.js';
export * from './media-preview.js';
export * from './asset-names.js';
export * from './automation.js';
export * from './sync.js';
export * from './sync-portable.js';
export * from './fcpxml.js';
export * from './diagnostics.js';
