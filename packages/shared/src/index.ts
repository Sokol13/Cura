import { z } from 'zod';

export const HealthResponseSchema = z.object({ status: z.literal('ok') });
export const HealthResponseJsonSchema = z.toJSONSchema(HealthResponseSchema, {
  target: 'draft-7',
});
export type HealthResponse = z.infer<typeof HealthResponseSchema>;

export * from './catalog.js';
export * from './brands.js';
