import {
  VisionSuggestionsSchema,
  ScriptModelResponseSchema,
  ChatCompletionResponseSchema,
  type AutomationProvenance,
  type AutomationProviderInfo,
  type VisionSuggestions,
  type ScriptEntityInput,
} from '@cura/shared';
import { AutomationError } from './errors.js';

export interface VisionInput {
  name: string;
  prompt: string;
  model: string;
  source: string;
  image?: Buffer;
  sourceHash: string;
  inputKind: 'metadata' | 'original-raster' | 'version-preview';
}
export interface VisionResult {
  suggestions: VisionSuggestions;
  provenance: AutomationProvenance;
}
export interface VisionProvider {
  info: AutomationProviderInfo;
  analyze(input: VisionInput, signal: AbortSignal): Promise<VisionResult>;
}
export interface HTTPProviderConfig {
  url: string;
  model: string;
  apiKey?: string | undefined;
  mode: 'json' | 'caption';
  timeoutMs?: number;
}
const vocabulary = [
  'house',
  'roof',
  'door',
  'window',
  'forest',
  'tree',
  'flower',
  'mountain',
  'river',
  'sea',
  'sky',
  'cloud',
  'sun',
  'moon',
  'cat',
  'dog',
  'bird',
  'person',
  'woman',
  'man',
  'girl',
  'boy',
  'character',
  'car',
  'robot',
  'chair',
  'table',
  'bottle',
  'logo',
  'red',
  'blue',
  'green',
  'yellow',
  'brown',
  'black',
  'white',
  'orange',
  'purple',
  'pink',
  'gray',
  'silver',
  'gold',
  'watercolor',
  'sketch',
  'portrait',
  'landscape',
  '建筑',
  '人物',
  '角色',
  '场景',
  '道具',
  '红色',
  '蓝色',
  '绿色',
  '森林',
  '房屋',
];
function tags(text: string): string[] {
  const lower = text.normalize('NFC').toLowerCase();
  return vocabulary
    .filter((word) =>
      /[\u3400-\u9fff]/u.test(word)
        ? lower.includes(word)
        : new RegExp(`\\b${word}\\b`, 'u').test(lower),
    )
    .slice(0, 20);
}
function stem(text: string): string {
  const stop = new Set([
    'a',
    'an',
    'the',
    'is',
    'are',
    'with',
    'and',
    'of',
    'in',
    'on',
    'this',
    'image',
    'shows',
    'it',
  ]);
  return (
    text
      .normalize('NFC')
      .toLowerCase()
      .match(/[\p{L}\p{N}]+/gu)
      ?.filter((w) => !stop.has(w))
      .slice(0, 10)
      .join('-')
      .slice(0, 160) || 'asset'
  );
}
export class MetadataRulesProvider implements VisionProvider {
  readonly info: AutomationProviderInfo = {
    id: 'metadata-rules',
    label: 'Metadata rules',
    kind: 'metadata-rules',
    mode: 'rules',
    configured: true,
    capabilities: ['vision-proposals'],
  };
  async analyze(
    input: VisionInput,
    signal: AbortSignal,
  ): Promise<VisionResult> {
    signal.throwIfAborted();
    const declared = [
      input.name.replace(/\.[^.]+$/u, ''),
      input.prompt,
      input.source,
      input.model,
    ]
      .filter(Boolean)
      .join(' ');
    return {
      suggestions: {
        tags: tags(declared),
        name: stem(input.name.replace(/\.[^.]+$/u, '')),
        caption: '',
      },
      provenance: {
        providerId: this.info.id,
        kind: 'metadata-rules',
        mode: 'rules',
        model: null,
        rawText: '',
        derivation: 'metadata-vocabulary-v1',
        inputKind: 'metadata',
        sourceHash: input.sourceHash,
      },
    };
  }
}

export async function chat(
  config: HTTPProviderConfig,
  content: unknown,
  signal: AbortSignal,
): Promise<string> {
  let url: URL;
  try {
    url = new URL(config.url);
  } catch {
    throw new AutomationError('PROVIDER_CONFIGURATION');
  }
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    url.username ||
    url.password
  )
    throw new AutomationError('PROVIDER_CONFIGURATION');
  const timeout = AbortSignal.timeout(config.timeoutMs ?? 30000);
  const combined = AbortSignal.any([signal, timeout]);
  try {
    const response = await fetch(url, {
      method: 'POST',
      redirect: 'error',
      headers: {
        'content-type': 'application/json',
        ...(config.apiKey ? { authorization: `Bearer ${config.apiKey}` } : {}),
      },
      body: JSON.stringify({
        model: config.model,
        temperature: 0,
        max_tokens: config.mode === 'caption' ? 96 : 512,
        messages: [{ role: 'user', content }],
      }),
      signal: combined,
    });
    if (!response.ok) {
      await response.body?.cancel();
      throw new AutomationError(
        response.status === 429 || response.status === 503
          ? 'PROVIDER_BUSY'
          : 'PROVIDER_HTTP_ERROR',
        502,
      );
    }
    if (!response.body)
      throw new AutomationError('PROVIDER_INVALID_OUTPUT', 502);
    const chunks: Uint8Array[] = [];
    let bytes = 0;
    for await (const chunk of response.body) {
      bytes += chunk.byteLength;
      if (bytes > 65536)
        throw new AutomationError('PROVIDER_RESPONSE_TOO_LARGE', 502);
      chunks.push(chunk);
    }
    let value;
    try {
      value = ChatCompletionResponseSchema.parse(
        JSON.parse(Buffer.concat(chunks).toString('utf8')),
      );
    } catch {
      throw new AutomationError('PROVIDER_INVALID_OUTPUT', 502);
    }
    const choice = value.choices[0]!;
    if (choice.finish_reason === 'length' || !choice.message.content.trim())
      throw new AutomationError('PROVIDER_INVALID_OUTPUT', 502);
    return choice.message.content;
  } catch (error) {
    if (signal.aborted) throw new AutomationError('CANCELLED', 409);
    if (timeout.aborted) throw new AutomationError('PROVIDER_TIMEOUT', 504);
    if (error instanceof AutomationError) throw error;
    throw new AutomationError('PROVIDER_UNREACHABLE', 502);
  }
}
export class HTTPVisionProvider implements VisionProvider {
  readonly info: AutomationProviderInfo;
  constructor(private readonly config: HTTPProviderConfig) {
    this.info = {
      id: 'http-vision',
      label: 'Configured vision model',
      kind: 'http-vision',
      mode: config.mode,
      configured: true,
      capabilities: ['vision-proposals'],
    };
  }
  async analyze(
    input: VisionInput,
    signal: AbortSignal,
  ): Promise<VisionResult> {
    if (!input.image || input.image.byteLength > 1048576)
      throw new AutomationError('VISION_INPUT_UNAVAILABLE');
    const prompt =
      this.config.mode === 'caption'
        ? 'Describe the main object and its visible colors in one sentence.'
        : 'Describe this image. Return only JSON: {"tags":["short visible concept"],"name":"short-descriptive-filename-without-extension","caption":"one sentence"}. Use at most 20 tags. Do not infer identity or unseen facts.';
    const rawText = await chat(
      this.config,
      [
        { type: 'text', text: prompt },
        {
          type: 'image_url',
          image_url: {
            url: `data:image/png;base64,${input.image.toString('base64')}`,
          },
        },
      ],
      signal,
    );
    let suggestions: VisionSuggestions;
    if (this.config.mode === 'caption')
      suggestions = {
        tags: tags(rawText),
        name: stem(rawText),
        caption: rawText.trim().slice(0, 2000),
      };
    else {
      try {
        suggestions = VisionSuggestionsSchema.parse(JSON.parse(rawText));
      } catch {
        throw new AutomationError('PROVIDER_INVALID_OUTPUT', 502);
      }
    }
    return {
      suggestions,
      provenance: {
        providerId: this.info.id,
        kind: 'http-vision',
        mode: this.config.mode,
        model: this.config.model,
        rawText,
        derivation:
          this.config.mode === 'caption' ? 'caption-vocabulary-v1' : null,
        inputKind: input.inputKind,
        sourceHash: input.sourceHash,
      },
    };
  }
}
export class HTTPTextProvider {
  readonly info: AutomationProviderInfo = {
    id: 'http-text',
    label: 'Configured text model',
    kind: 'http-text',
    mode: 'json',
    configured: true,
    capabilities: ['script-analysis'],
  };
  constructor(private readonly config: HTTPProviderConfig) {}
  async analyze(
    text: string,
    hash: string,
    signal: AbortSignal,
  ): Promise<{
    entities: ScriptEntityInput[];
    provenance: AutomationProvenance;
  }> {
    const numbered = text
      .split(/\r\n|\r|\n/u)
      .map((line, i) => `${i + 1}: ${line}`)
      .join('\n');
    const rawText = await chat(
      this.config,
      `Extract only explicitly supported characters, props and scenes from the source. Return JSON {"entities":[{"kind":"character|prop|scene","name":"name","notes":"","ranges":[{"startLine":1,"endLine":1}]}]}. Every entity requires a real source range. Source:\n${numbered}`,
      signal,
    );
    let entities: ScriptEntityInput[];
    try {
      entities = ScriptModelResponseSchema.parse(JSON.parse(rawText)).entities;
    } catch {
      throw new AutomationError('PROVIDER_INVALID_OUTPUT', 502);
    }
    if (entities.some((e) => e.ranges.length === 0))
      throw new AutomationError('PROVIDER_INVALID_OUTPUT', 502);
    return {
      entities,
      provenance: {
        providerId: this.info.id,
        kind: 'http-text',
        mode: 'json',
        model: this.config.model,
        rawText,
        derivation: null,
        inputKind: 'text',
        sourceHash: hash,
      },
    };
  }
}
export function configuredProviders(env: NodeJS.ProcessEnv = process.env): {
  vision: VisionProvider[];
  text?: HTTPTextProvider | undefined;
} {
  const vision: VisionProvider[] = [new MetadataRulesProvider()];
  if (env.CURA_VISION_URL && env.CURA_VISION_MODEL)
    vision.push(
      new HTTPVisionProvider({
        url: env.CURA_VISION_URL,
        model: env.CURA_VISION_MODEL,
        apiKey: env.CURA_VISION_API_KEY,
        mode: env.CURA_VISION_MODE === 'caption' ? 'caption' : 'json',
      }),
    );
  const text =
    env.CURA_TEXT_URL && env.CURA_TEXT_MODEL
      ? new HTTPTextProvider({
          url: env.CURA_TEXT_URL,
          model: env.CURA_TEXT_MODEL,
          apiKey: env.CURA_TEXT_API_KEY,
          mode: 'json',
        })
      : undefined;
  return { vision, text };
}
