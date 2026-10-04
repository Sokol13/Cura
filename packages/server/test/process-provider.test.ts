import { expect, test } from 'vitest';
import sharp from 'sharp';
import { GenerateRequestSchema } from '@cura/shared';
import { parsePngMetadata } from '../src/media/metadata.js';
import { MockGenerationProvider } from '../src/process/provider.js';

test('mock provider generates deterministic decodable distinct outputs with exact PNG generation metadata', async () => {
  const provider = new MockGenerationProvider();
  const input = GenerateRequestSchema.parse({
    prompt: 'A copper scene',
    seed: '18446744073709551615',
    count: 2,
    width: 128,
    height: 96,
  });
  const progress: number[] = [];
  const outputs = await provider.generate(input, {
    signal: new AbortController().signal,
    progress: (value) => progress.push(value),
  });
  expect(outputs).toHaveLength(2);
  expect(outputs[0]!.bytes.equals(outputs[1]!.bytes)).toBe(false);
  expect(await sharp(outputs[0]!.bytes).metadata()).toMatchObject({
    width: 128,
    height: 96,
    format: 'png',
  });
  expect(parsePngMetadata(outputs[0]!.bytes)).toMatchObject({
    prompt: input.prompt,
    seed: input.seed,
    model: 'cura-mock-v1',
  });
  const again = await provider.generate(input, {
    signal: new AbortController().signal,
    progress: () => undefined,
  });
  expect(again[0]!.bytes).toEqual(outputs[0]!.bytes);
  expect(progress[0]).toBeGreaterThan(0);
  expect(progress.at(-1)).toBe(1);
});

test('mock failures and cancellation are explicit and never return fabricated successful bytes', async () => {
  const provider = new MockGenerationProvider();
  const input = GenerateRequestSchema.parse({ prompt: 'A scene' });
  await expect(
    provider.generate(
      { ...input, mockOutcome: 'fail' },
      { signal: new AbortController().signal, progress: () => undefined },
    ),
  ).rejects.toThrow(/simulated/i);
  const controller = new AbortController();
  await expect(
    provider.generate(input, {
      signal: controller.signal,
      progress: () => controller.abort(),
    }),
  ).rejects.toThrow();
});
