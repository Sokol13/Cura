import { describe, expect, it } from 'vitest';
import { parsePngMetadata } from '../src/media/metadata.js';
import {
  createMetadataPng as png,
  textChunk,
  chunk,
} from './media-fixtures.js';

const sd =
  'studio photograph of a red ceramic cup\nsoft window light\nNegative prompt: watermark, blur\nSteps: 24, Sampler: Euler, CFG scale: 7, Seed: 18446744073709551615, Size: 768x512, Model hash: abc123, Model: studio-v1';

function warnings(result: ReturnType<typeof parsePngMetadata>): string {
  return (result.params.warnings as string[] | undefined)?.join(' ') ?? '';
}

describe('PNG metadata containers and SD WebUI', () => {
  it('extracts multiline prompts and exact seeds while preserving original parameters', () => {
    const result = parsePngMetadata(png(textChunk('parameters', sd)));
    expect(result).toMatchObject({
      source: 'sd-webui',
      prompt: 'studio photograph of a red ceramic cup\nsoft window light',
      negativePrompt: 'watermark, blur',
      model: 'studio-v1',
      seed: '18446744073709551615',
    });
    expect(result.params).toMatchObject({
      raw: { parameters: [sd] },
      sd: { Steps: '24', 'Model hash': 'abc123', Sampler: 'Euler' },
    });
  });

  it.each([false, true])(
    'decodes Unicode iTXt with compression=%s',
    (compressed) => {
      const raw =
        '红色陶瓷杯\n柔和光线\nNegative prompt: 水印\nSteps: 20, Seed: 42, Model: 中国模型';
      const result = parsePngMetadata(
        png(textChunk('parameters', raw, 'iTXt', compressed)),
      );
      expect(result.prompt).toBe('红色陶瓷杯\n柔和光线');
      expect(result.negativePrompt).toBe('水印');
      expect(result.model).toBe('中国模型');
    },
  );

  it('decodes compressed Latin-1 text', () => {
    expect(
      parsePngMetadata(
        png(textChunk('parameters', 'café\nSteps: 2, Seed: 9', 'zTXt')),
      ).prompt,
    ).toBe('café');
  });

  it('supports quoted multiline parameter values without splitting their commas', () => {
    const raw =
      'a sign saying Steps: 99, red: blue\nSteps: 24, Seed: 00042, Model: "portrait, v2: \\"studio\\"", Extra: "line one,\nline two: done"';
    const result = parsePngMetadata(png(textChunk('parameters', raw)));
    expect(result.prompt).toBe('a sign saying Steps: 99, red: blue');
    expect(result.model).toBe('portrait, v2: "studio"');
    expect(result.seed).toBe('42');
    expect(result.negativePrompt).toBe('');
    expect(result.params.sd).toMatchObject({
      Extra: 'line one,\nline two: done',
    });
  });

  it('bounds the search through malformed SD footer candidates', () => {
    const raw = 'a cup\n' + 'Steps: 24, broken field\n'.repeat(1000);
    const result = parsePngMetadata(png(textChunk('parameters', raw)));
    expect(result.seed).toBe('');
    expect(result.prompt).toBe(raw.trim());
    expect(warnings(result)).toMatch(/footer.*limit/i);
  });

  it('keeps prompt-only parameters partial without inventing a model from its hash', () => {
    const result = parsePngMetadata(
      png(textChunk('parameters', 'red cup\nSteps: 20, Model hash: abc123')),
    );
    expect(result.prompt).toBe('red cup');
    expect(result.model).toBe('');
    const partial = parsePngMetadata(png(textChunk('parameters', 'red cup')));
    expect(partial.prompt).toBe('red cup');
    expect(warnings(partial)).toMatch(/footer|partial/i);
  });

  it('skips metadata with bad CRC and continues parsing valid chunks', () => {
    const bad = textChunk('parameters', 'bad\nSteps: 1, Seed: 1');
    bad[bad.length - 1] = (bad[bad.length - 1] ?? 0) ^ 1;
    const result = parsePngMetadata(png(bad, textChunk('parameters', sd)));
    expect(result.seed).toBe('18446744073709551615');
    expect(warnings(result)).toMatch(/crc/i);
  });

  it('reports duplicates while preserving both raw values and selecting the first', () => {
    const result = parsePngMetadata(
      png(
        textChunk('parameters', sd),
        textChunk('parameters', 'other\nSteps: 2, Seed: 3', 'iTXt'),
      ),
    );
    expect(result.prompt).toBe(
      'studio photograph of a red ceramic cup\nsoft window light',
    );
    expect(result.params.raw).toMatchObject({
      parameters: [sd, 'other\nSteps: 2, Seed: 3'],
    });
    expect(warnings(result)).toMatch(/duplicate/i);
  });

  it('returns an honest empty record for an image with no generation metadata', () => {
    expect(parsePngMetadata(png())).toEqual({
      prompt: '',
      negativePrompt: '',
      model: '',
      seed: '',
      source: '',
      params: {},
    });
    expect(parsePngMetadata(Buffer.from('not a PNG')).source).toBe('');
  });

  it('returns warnings instead of throwing for truncation and malformed text fields', () => {
    const malformed = chunk(
      'iTXt',
      Buffer.from('parameters\0\x01\0bad', 'latin1'),
    );
    expect(warnings(parsePngMetadata(png(malformed)))).toMatch(
      /malformed|invalid/i,
    );
    const truncated = png(textChunk('parameters', sd)).subarray(0, 50);
    expect(warnings(parsePngMetadata(truncated))).toMatch(/truncat/i);
  });

  it.each(['tEXt', 'zTXt', 'iTXt'] as const)(
    'bounds oversized or inflating %s metadata and continues to later valid chunks',
    (type) => {
      const huge = textChunk(
        'parameters',
        'x'.repeat(1024 * 1024 + 1),
        type,
        true,
      );
      const result = parsePngMetadata(png(huge, textChunk('parameters', sd)));
      expect(result.seed).toBe('18446744073709551615');
      expect(warnings(result)).toMatch(/limit|large|decompress/i);
    },
  );

  it('bounds aggregate text across individually valid chunks', () => {
    const chunks = Array.from({ length: 6 }, (_, i) =>
      textChunk(`Comment${i}`, 'x'.repeat(800_000), 'zTXt'),
    );
    const result = parsePngMetadata(
      png(...chunks, textChunk('parameters', sd)),
    );
    expect(warnings(result)).toMatch(/aggregate|total|budget/i);
  });
});

type Graph = Record<
  string,
  { class_type: string; inputs: Record<string, unknown> }
>;

function comfyGraph(): Graph {
  return {
    unrelatedText: {
      class_type: 'CLIPTextEncode',
      inputs: { text: 'wrong prompt' },
    },
    unrelatedModel: {
      class_type: 'CheckpointLoaderSimple',
      inputs: { ckpt_name: 'wrong-model' },
    },
    output: { class_type: 'SaveImage', inputs: { images: ['decode', 0] } },
    decode: {
      class_type: 'VAEDecode',
      inputs: { samples: ['sampler', 0], vae: ['loader', 2] },
    },
    sampler: {
      class_type: 'KSampler',
      inputs: {
        positive: ['positive', 0],
        negative: ['negative', 0],
        model: ['lora', 0],
        seed: 'MAX_UINT64',
        steps: 24,
        cfg: 7,
      },
    },
    positive: {
      class_type: 'CLIPTextEncode',
      inputs: { text: '红色杯子 18446744073709551615', clip: ['loader', 1] },
    },
    negative: {
      class_type: 'CLIPTextEncode',
      inputs: { text: 'watermark', clip: ['loader', 1] },
    },
    lora: {
      class_type: 'LoraLoader',
      inputs: {
        model: ['loader', 0],
        clip: ['loader', 1],
        lora_name: 'style.safetensors',
        strength_model: 0.7,
      },
    },
    loader: {
      class_type: 'CheckpointLoaderSimple',
      inputs: { ckpt_name: 'cup-v1.safetensors' },
    },
  };
}

function graphJson(graph: Graph): string {
  return JSON.stringify(graph).replace('"MAX_UINT64"', '18446744073709551615');
}

describe('ComfyUI PNG metadata', () => {
  it('follows saved-image conditioning and model chains with lossless unquoted uint64 seeds', () => {
    const raw = graphJson(comfyGraph());
    const result = parsePngMetadata(png(textChunk('prompt', raw, 'iTXt')));
    expect(result).toMatchObject({
      source: 'comfyui',
      prompt: '红色杯子 18446744073709551615',
      negativePrompt: 'watermark',
      model: 'cup-v1.safetensors',
      seed: '18446744073709551615',
    });
    expect(result.params.raw).toMatchObject({ prompt: [raw] });
    expect(result.params.comfy).toMatchObject({
      candidates: [
        {
          samplerNode: 'sampler',
          modelChain: [
            {
              classType: 'LoraLoader',
              inputs: { lora_name: 'style.safetensors' },
            },
            { classType: 'CheckpointLoaderSimple' },
          ],
        },
      ],
    });
  });

  it('extracts the supported PreviewImage output branch', () => {
    const graph = comfyGraph();
    if (graph.output) graph.output.class_type = 'PreviewImage';
    const result = parsePngMetadata(
      png(textChunk('prompt', graphJson(graph), 'iTXt')),
    );
    expect(result.seed).toBe('18446744073709551615');
    expect(result.model).toBe('cup-v1.safetensors');
  });

  it('extracts advanced sampler noise seeds and combined positive conditioning', () => {
    const graph = comfyGraph();
    graph.sampler = {
      class_type: 'KSamplerAdvanced',
      inputs: {
        ...graph.sampler?.inputs,
        seed: undefined,
        noise_seed: '000123',
      },
    };
    graph.positive = {
      class_type: 'ConditioningCombine',
      inputs: { conditioning_1: ['textA', 0], conditioning_2: ['textB', 0] },
    };
    graph.textA = { class_type: 'CLIPTextEncode', inputs: { text: 'red cup' } };
    graph.textB = {
      class_type: 'CLIPTextEncode',
      inputs: { text: 'soft light' },
    };
    const result = parsePngMetadata(png(textChunk('prompt', graphJson(graph))));
    expect(result.prompt).toBe('red cup\nsoft light');
    expect(result.seed).toBe('123');
  });

  it('resolves ControlNet positive and negative output slots independently', () => {
    const graph = comfyGraph();
    graph.control = {
      class_type: 'ControlNetApplyAdvanced',
      inputs: { positive: ['positive', 0], negative: ['negative', 0] },
    };
    if (graph.sampler) {
      graph.sampler.inputs.positive = ['control', 0];
      graph.sampler.inputs.negative = ['control', 1];
    }
    const result = parsePngMetadata(
      png(textChunk('prompt', graphJson(graph), 'iTXt')),
    );
    expect(result.prompt).toBe('红色杯子 18446744073709551615');
    expect(result.negativePrompt).toBe('watermark');
  });

  it('preserves multiple branch candidates instead of presenting an arbitrary branch as definitive', () => {
    const graph = comfyGraph();
    graph.otherSampler = {
      class_type: 'KSampler',
      inputs: {
        ...graph.sampler?.inputs,
        seed: 42,
        positive: ['unrelatedText', 0],
      },
    };
    graph.otherDecode = {
      class_type: 'VAEDecode',
      inputs: { samples: ['otherSampler', 0] },
    };
    graph.otherOutput = {
      class_type: 'SaveImage',
      inputs: { images: ['otherDecode', 0] },
    };
    const result = parsePngMetadata(
      png(textChunk('prompt', graphJson(graph), 'iTXt')),
    );
    expect(result.source).toBe('comfyui');
    expect(result.seed).toBe('');
    expect(result.prompt).toBe('');
    expect(result.params.comfy).toMatchObject({
      candidates: [
        expect.objectContaining({ seed: '18446744073709551615' }),
        expect.objectContaining({ seed: '42' }),
      ],
    });
    expect(warnings(result)).toMatch(/ambig|multiple/i);
  });

  it('does not identify one output as definitive when another output uses an unknown image path', () => {
    const graph = comfyGraph();
    graph.custom = { class_type: 'CustomImageGenerator', inputs: {} };
    graph.otherOutput = {
      class_type: 'SaveImage',
      inputs: { images: ['custom', 0] },
    };
    const result = parsePngMetadata(
      png(textChunk('prompt', graphJson(graph), 'iTXt')),
    );
    expect(result.source).toBe('comfyui');
    expect(result.seed).toBe('');
    expect(warnings(result)).toMatch(/ambig|multiple/i);
    expect(result.params.comfy).toMatchObject({
      candidates: [expect.objectContaining({ seed: '18446744073709551615' })],
    });
  });

  it('returns supported partial fields around an unknown custom conditioning node', () => {
    const graph = comfyGraph();
    graph.positive = {
      class_type: 'UnknownMagicPrompt',
      inputs: { text: 'do not guess this schema' },
    };
    const result = parsePngMetadata(png(textChunk('prompt', graphJson(graph))));
    expect(result.prompt).toBe('');
    expect(result.model).toBe('cup-v1.safetensors');
    expect(result.seed).toBe('18446744073709551615');
    expect(warnings(result)).toMatch(/unsupported.*UnknownMagicPrompt/i);
  });

  it('preserves workflow-only provenance without guessing widget positions', () => {
    const raw = JSON.stringify({
      nodes: [
        { id: 1, type: 'CLIPTextEncode', widgets_values: ['maybe prompt'] },
      ],
    });
    const result = parsePngMetadata(png(textChunk('workflow', raw)));
    expect(result.source).toBe('comfyui');
    expect(result.prompt).toBe('');
    expect(result.params.raw).toMatchObject({ workflow: [raw] });
    expect(warnings(result)).toMatch(
      /workflow.*partial|workflow.*unsupported/i,
    );
  });

  it('warns on invalid JSON but still extracts a separate valid execution graph', () => {
    const result = parsePngMetadata(
      png(
        textChunk('workflow', '{'),
        textChunk('prompt', graphJson(comfyGraph()), 'iTXt'),
      ),
    );
    expect(result.seed).toBe('18446744073709551615');
    expect(warnings(result)).toMatch(/workflow.*json/i);
    const invalid = parsePngMetadata(png(textChunk('prompt', '{')));
    expect(invalid.source).toBe('comfyui');
    expect(warnings(invalid)).toMatch(/prompt.*json/i);
  });

  it('bounds cyclic conditioning while resolving independent valid paths', () => {
    const graph = comfyGraph();
    graph.positive = {
      class_type: 'ConditioningCombine',
      inputs: {
        conditioning_1: ['positive', 0],
        conditioning_2: ['unrelatedText', 0],
      },
    };
    const result = parsePngMetadata(png(textChunk('prompt', graphJson(graph))));
    expect(result.prompt).toBe('wrong prompt');
    expect(result.negativePrompt).toBe('watermark');
    expect(warnings(result)).toMatch(/cycl/i);
  });

  it('bounds graph depth and node count with controlled warnings', () => {
    const graph = comfyGraph();
    graph.positive = {
      class_type: 'ConditioningZeroOut',
      inputs: { conditioning: ['chain0', 0] },
    };
    for (let i = 0; i < 80; i++)
      graph[`chain${i}`] = {
        class_type: 'ConditioningZeroOut',
        inputs: { conditioning: [`chain${i + 1}`, 0] },
      };
    const deep = parsePngMetadata(png(textChunk('prompt', graphJson(graph))));
    expect(warnings(deep)).toMatch(/depth|limit/i);
    for (let i = 0; i < 5000; i++)
      graph[`extra${i}`] = { class_type: 'Unrelated', inputs: {} };
    const large = parsePngMetadata(png(textChunk('prompt', graphJson(graph))));
    expect(warnings(large)).toMatch(/graph.*limit|too many.*nodes/i);
  });
});

describe('explicit Midjourney PNG metadata', () => {
  it('extracts explicitly named Midjourney fields', () => {
    const result = parsePngMetadata(
      png(
        textChunk('Midjourney Prompt', 'a brass lamp'),
        textChunk('Midjourney Seed', '4242'),
        textChunk('Midjourney Model', '6.1'),
      ),
    );
    expect(result).toMatchObject({
      source: 'midjourney',
      prompt: 'a brass lamp',
      seed: '4242',
      model: '6.1',
    });
  });

  it('does not infer Midjourney generation fields from filenames or arbitrary descriptions', () => {
    const result = parsePngMetadata(
      png(
        textChunk('filename', 'red_cup_midjourney_123.png'),
        textChunk('Description', 'a pretty cup'),
      ),
    );
    expect(result.source).toBe('');
    expect(result.prompt).toBe('');
  });
});
