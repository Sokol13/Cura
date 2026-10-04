import { mkdir, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';

const require = createRequire(
  new URL('../packages/server/package.json', import.meta.url),
);
const sharp = require('sharp');

export const fixtureSeed = '18446744073709551615';
const palettes = [
  ['#dc503c', '#f5b45a', '#58273d'],
  ['#2477c4', '#73c7d7', '#16375b'],
  ['#38824f', '#b0cd6d', '#193e3b'],
  ['#9255b7', '#e1a0cf', '#402655'],
  ['#df9730', '#eedca0', '#765231'],
  ['#687486', '#d8dce1', '#263341'],
];
const crcTable = Array.from({ length: 256 }, (_, byte) => {
  let crc = byte;
  for (let bit = 0; bit < 8; bit++)
    crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  return crc >>> 0;
});

function textChunk(keyword, value) {
  const data = Buffer.from(`${keyword}\0${value}`, 'utf8');
  const kind = Buffer.from('tEXt');
  let crc = 0xffffffff;
  for (const byte of Buffer.concat([kind, data]))
    crc = (crc >>> 8) ^ crcTable[(crc ^ byte) & 255];
  const chunk = Buffer.alloc(data.length + 12);
  chunk.writeUInt32BE(data.length, 0);
  kind.copy(chunk, 4);
  data.copy(chunk, 8);
  chunk.writeUInt32BE((crc ^ 0xffffffff) >>> 0, data.length + 8);
  return chunk;
}

export function fixtureName(index) {
  return `cura-${String(index).padStart(5, '0')}-${index % 2 === 0 ? 'sd' : 'comfy'}.png`;
}

/** Every file has different decoded pixels, not just different ancillary text. */
export async function createFixture(index) {
  if (!Number.isSafeInteger(index) || index < 0 || index > 99_999)
    throw new Error('Fixture index must be an integer from 0 to 99999.');
  const width = 128 + (index % 4) * 16;
  const height = 96 + (Math.floor(index / 4) % 4) * 16;
  const colors = palettes[index % palettes.length].map((hex) =>
    [1, 3, 5].map((offset) =>
      Number.parseInt(hex.slice(offset, offset + 2), 16),
    ),
  );
  const pixels = Buffer.alloc(width * height * 3);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const circle =
        (x - width * 0.68) ** 2 + (y - height * 0.38) ** 2 <
        (height * 0.23) ** 2;
      const stripe = y > height * 0.65 + Math.sin(x / 17 + index / 13) * 9;
      let color = colors[circle ? 1 : stripe ? 2 : 0];
      // Seventeen binary tiles ensure unique raster content through index 99999.
      if (y < 8 && x < 17 * 7)
        color =
          ((index >>> Math.floor(x / 7)) & 1) === 1
            ? [250, 250, 250]
            : [8, 8, 8];
      const offset = (y * width + x) * 3;
      pixels[offset] = color[0];
      pixels[offset + 1] = color[1];
      pixels[offset + 2] = color[2];
    }
  }
  const png = await sharp(pixels, { raw: { width, height, channels: 3 } })
    .png()
    .toBuffer();
  const prompt = `Cura fixture ${index}, geometric landscape, studio color study`;
  const negative = 'blur, watermark, malformed shapes';
  let chunks;
  if (index % 2 === 0) {
    chunks = [
      textChunk(
        'parameters',
        `${prompt}\nNegative prompt: ${negative}\nSteps: 24, Sampler: Euler, CFG scale: 7, Seed: ${fixtureSeed}, Size: ${width}x${height}, Model: cura-fixture-sd-v1`,
      ),
    ];
  } else {
    const graph = {
      1: {
        class_type: 'CheckpointLoaderSimple',
        inputs: { ckpt_name: 'cura-fixture-comfy-v1.safetensors' },
      },
      2: {
        class_type: 'CLIPTextEncode',
        inputs: { text: prompt, clip: ['1', 1] },
      },
      3: {
        class_type: 'CLIPTextEncode',
        inputs: { text: negative, clip: ['1', 1] },
      },
      4: {
        class_type: 'EmptyLatentImage',
        inputs: { width, height, batch_size: 1 },
      },
      5: {
        class_type: 'KSampler',
        inputs: {
          seed: '__uint64_seed__',
          steps: 24,
          cfg: 7,
          sampler_name: 'euler',
          scheduler: 'normal',
          denoise: 1,
          model: ['1', 0],
          positive: ['2', 0],
          negative: ['3', 0],
          latent_image: ['4', 0],
        },
      },
      6: {
        class_type: 'VAEDecode',
        inputs: { samples: ['5', 0], vae: ['1', 2] },
      },
      7: {
        class_type: 'SaveImage',
        inputs: { images: ['6', 0], filename_prefix: 'Cura' },
      },
    };
    // Real ComfyUI graphs use JSON numbers. Never round this uint64 through Number.
    const graphJson = JSON.stringify(graph).replace(
      '"__uint64_seed__"',
      fixtureSeed,
    );
    const workflow = {
      last_node_id: 7,
      nodes: [
        {
          id: 1,
          type: 'CheckpointLoaderSimple',
          widgets_values: ['cura-fixture-comfy-v1.safetensors'],
        },
        {
          id: 5,
          type: 'KSampler',
          widgets_values: [fixtureSeed, 'fixed', 24, 7, 'euler', 'normal', 1],
        },
      ],
      extra: { fixtureIndex: index },
    };
    chunks = [
      textChunk('prompt', graphJson),
      textChunk('workflow', JSON.stringify(workflow)),
    ];
  }
  return Buffer.concat([png.subarray(0, -12), ...chunks, png.subarray(-12)]);
}

export async function generateFixtures(directory, count = 1000) {
  if (typeof directory !== 'string' || !directory.trim())
    throw new Error('A destination directory is required.');
  if (!Number.isSafeInteger(count) || count < 1 || count > 100_000)
    throw new Error('Count must be an integer from 1 to 100000.');
  const target = resolve(directory);
  await mkdir(target, { recursive: true });
  // Exclusive creation prevents accidentally overwriting a user's existing files.
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(8, count) }, async () => {
      while (next < count) {
        const index = next++;
        await writeFile(
          join(target, fixtureName(index)),
          await createFixture(index),
          { flag: 'wx' },
        );
      }
    }),
  );
  return { directory: target, count, seed: fixtureSeed };
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  const [directory, rawCount, ...extra] = process.argv.slice(2);
  try {
    if (
      !directory ||
      extra.length ||
      (rawCount !== undefined && !/^[1-9]\d*$/.test(rawCount))
    )
      throw new Error(
        'Usage: node scripts/generate-fixtures.mjs <directory> [count]',
      );
    console.log(
      JSON.stringify(
        await generateFixtures(
          directory,
          rawCount === undefined ? 1000 : Number(rawCount),
        ),
      ),
    );
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
