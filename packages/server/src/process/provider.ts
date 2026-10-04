import { createHash } from 'node:crypto';
import { setTimeout } from 'node:timers/promises';
import sharp from 'sharp';
import type { GenerateInput } from '@cura/shared';

export interface GeneratedOutput {
  name: string;
  bytes: Buffer;
  seed: string;
}
export interface GenerationProvider {
  readonly id: string;
  readonly isMock: boolean;
  generate(
    input: GenerateInput,
    context: { signal: AbortSignal; progress: (value: number) => void },
  ): Promise<GeneratedOutput[]>;
}
function textChunk(text: string): Buffer {
  const bytes = Buffer.from(`parameters\0${text}`);
  const chunk = Buffer.alloc(bytes.length + 12);
  chunk.writeUInt32BE(bytes.length);
  chunk.write('tEXt', 4);
  bytes.copy(chunk, 8);
  let crc = 0xffffffff;
  for (const byte of chunk.subarray(4, -4)) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++)
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  chunk.writeUInt32BE((crc ^ 0xffffffff) >>> 0, chunk.length - 4);
  return chunk;
}

/** A local deterministic illustration provider, visibly labeled mock by its UI. */
export class MockGenerationProvider implements GenerationProvider {
  readonly id = 'mock';
  readonly isMock = true;
  async generate(
    input: GenerateInput,
    context: { signal: AbortSignal; progress: (value: number) => void },
  ): Promise<GeneratedOutput[]> {
    const outputs: GeneratedOutput[] = [];
    context.signal.throwIfAborted();
    context.progress(0.05);
    // Model a short asynchronous render stage so cancellation is a usable action.
    await setTimeout(120, undefined, { signal: context.signal });
    if (input.mockOutcome === 'fail')
      throw new Error(
        'Simulated mock-provider failure. No external service was contacted.',
      );
    for (let index = 0; index < input.count; index++) {
      context.signal.throwIfAborted();
      const seed = String((BigInt(input.seed) + BigInt(index)) % (1n << 64n));
      const digest = createHash('sha256')
        .update(JSON.stringify({ ...input, seed, count: 1 }))
        .digest('hex');
      const svg = Buffer.from(
        `<svg xmlns="http://www.w3.org/2000/svg" width="${input.width}" height="${input.height}" viewBox="0 0 512 384"><rect width="512" height="384" fill="#${digest.slice(0, 6)}"/><circle cx="340" cy="130" r="86" fill="#${digest.slice(6, 12)}"/><path d="M0 315L140 170L285 310L405 220L512 320V384H0Z" fill="#${digest.slice(12, 18)}"/><path d="M0 350H512" stroke="#ffffff" stroke-width="12"/></svg>`,
      );
      const png = await sharp(svg).png().toBuffer();
      context.signal.throwIfAborted();
      const metadata = textChunk(
        `${input.prompt}\nNegative prompt: ${input.negativePrompt}\nSteps: 1, Sampler: Mock, CFG scale: 1, Seed: ${seed}, Size: ${input.width}x${input.height}, Model: ${input.model}`,
      );
      outputs.push({
        name: `mock-${digest.slice(0, 16)}.png`,
        bytes: Buffer.concat([
          png.subarray(0, -12),
          metadata,
          png.subarray(-12),
        ]),
        seed,
      });
      context.progress((index + 1) / input.count);
    }
    return outputs;
  }
}
