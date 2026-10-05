import { inflateSync } from 'node:zlib';
import type { GenerationMetadata } from './types.js';

const PNG_SIGNATURE = Buffer.from('89504e470d0a1a0a', 'hex');
const MAX_TEXT_BYTES = 1024 * 1024;
const MAX_TOTAL_TEXT_BYTES = 4 * MAX_TEXT_BYTES;
const MAX_CHUNKS = 16_384;
const crcTable = Uint32Array.from({ length: 256 }, (_, value) => {
  for (let bit = 0; bit < 8; bit++) {
    value = (value >>> 1) ^ (value & 1 ? 0xedb88320 : 0);
  }
  return value >>> 0;
});

type RawText = Record<string, string[]>;
type Warn = (message: string) => void;

function crc32(bytes: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of bytes)
    crc = (crc >>> 8) ^ (crcTable[(crc ^ byte) & 255] ?? 0);
  return (crc ^ 0xffffffff) >>> 0;
}

function readText(
  type: string,
  data: Buffer,
  budget: number,
): [string, string, number] {
  const separator = data.indexOf(0);
  if (separator < 1 || separator > 79)
    throw new Error('Invalid PNG text keyword');
  const key = data.subarray(0, separator).toString('latin1');
  let offset = separator + 1;
  let compressed = false;
  let encoding: BufferEncoding = 'latin1';
  if (type === 'zTXt') {
    if (data[offset++] !== 0)
      throw new Error('Invalid zTXt compression method');
    compressed = true;
  } else if (type === 'iTXt') {
    const flag = data[offset++];
    if ((flag !== 0 && flag !== 1) || data[offset++] !== 0) {
      throw new Error('Invalid iTXt compression header');
    }
    compressed = flag === 1;
    encoding = 'utf8';
    for (let field = 0; field < 2; field++) {
      const end = data.indexOf(0, offset);
      if (end < 0)
        throw new Error('Malformed iTXt language or translated keyword');
      offset = end + 1;
    }
  }
  let bytes = data.subarray(offset);
  if (compressed)
    bytes = inflateSync(bytes, {
      maxOutputLength: Math.min(MAX_TEXT_BYTES, budget),
    });
  if (bytes.length > MAX_TEXT_BYTES)
    throw new Error('PNG text exceeds individual size limit');
  if (bytes.length > budget)
    throw new Error('PNG text exceeds aggregate budget');
  // Some generators write UTF-8 values in legacy tEXt; keywords stay Latin-1.
  if (type === 'tEXt') {
    try {
      const value = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
      return [key, value, bytes.length];
    } catch {
      // Fall back to PNG's Latin-1 only when the complete value is invalid UTF-8.
    }
  }
  // Fatal UTF-8 decoding prevents silently changing malformed international text.
  const value =
    encoding === 'utf8'
      ? new TextDecoder('utf-8', { fatal: true }).decode(bytes)
      : bytes.toString(encoding);
  return [key, value, bytes.length];
}

function collectText(input: Buffer, warn: Warn): RawText {
  const raw: RawText = Object.create(null) as RawText;
  let offset = PNG_SIGNATURE.length;
  let total = 0;
  let encodedTotal = 0;
  for (let count = 0; count < MAX_CHUNKS; count++) {
    if (offset + 12 > input.length) {
      warn('Truncated PNG chunk stream');
      return raw;
    }
    const length = input.readUInt32BE(offset);
    const end = offset + 12 + length;
    if (end > input.length) {
      warn('Truncated PNG chunk payload');
      return raw;
    }
    const type = input.toString('ascii', offset + 4, offset + 8);
    if (type === 'IEND') return raw;
    if (type === 'tEXt' || type === 'zTXt' || type === 'iTXt') {
      if (
        total >= MAX_TOTAL_TEXT_BYTES ||
        encodedTotal >= MAX_TOTAL_TEXT_BYTES * 2
      ) {
        warn('PNG aggregate text budget exceeded');
        return raw;
      }
      if (length > MAX_TEXT_BYTES + 1024) {
        warn(`${type} chunk exceeds individual size limit`);
      } else {
        encodedTotal += length;
        const data = input.subarray(offset + 8, end - 4);
        if (
          crc32(input.subarray(offset + 4, end - 4)) !==
          input.readUInt32BE(end - 4)
        ) {
          warn(`${type} metadata CRC mismatch; skipped chunk`);
        } else {
          try {
            const [key, value, size] = readText(
              type,
              data,
              MAX_TOTAL_TEXT_BYTES - total,
            );
            total += size;
            if (Object.hasOwn(raw, key)) {
              warn(`Duplicate PNG metadata key: ${key}; first value selected`);
              raw[key]?.push(value);
            } else raw[key] = [value];
          } catch (error) {
            // Charge failed decodes too, so repeated compressed bombs have bounded work.
            total += Math.min(MAX_TEXT_BYTES, MAX_TOTAL_TEXT_BYTES - total);
            const reason =
              error instanceof Error ? error.message : 'Invalid metadata';
            warn(
              `${type} metadata invalid or decompression limit exceeded: ${reason}`,
            );
            if (total >= MAX_TOTAL_TEXT_BYTES)
              warn('PNG aggregate text budget exhausted');
          }
        }
      }
    }
    offset = end;
  }
  warn('PNG chunk count limit exceeded');
  return raw;
}

function normalizeSeed(value: unknown): string {
  const text =
    typeof value === 'string'
      ? value
      : typeof value === 'number' && Number.isSafeInteger(value)
        ? String(value)
        : '';
  return /^[+-]?\d{1,32}$/.test(text) ? BigInt(text).toString() : '';
}

function splitParameters(text: string): string[] | undefined {
  const parts: string[] = [];
  let start = 0;
  let quoted = false;
  let escaped = false;
  for (let index = 0; index < text.length; index++) {
    const character = text[index];
    if (escaped) escaped = false;
    else if (quoted && character === '\\') escaped = true;
    else if (character === '"') quoted = !quoted;
    else if (character === ',' && !quoted) {
      parts.push(text.slice(start, index).trim());
      start = index + 1;
    }
  }
  if (quoted) return undefined;
  parts.push(text.slice(start).trim());
  return parts;
}

function footerParameters(text: string): Record<string, string> | undefined {
  const parts = splitParameters(text);
  if (!parts) return undefined;
  const parameters: Record<string, string> = Object.create(null) as Record<
    string,
    string
  >;
  for (const part of parts) {
    const colon = part.indexOf(':');
    if (colon < 1) return undefined;
    const key = part.slice(0, colon).trim();
    let value = part.slice(colon + 1).trim();
    if (value.startsWith('"') && value.endsWith('"')) {
      try {
        value = JSON.parse(
          value.replace(/\r/g, '\\r').replace(/\n/g, '\\n'),
        ) as string;
      } catch {
        return undefined;
      }
    }
    parameters[key] = value;
  }
  return parameters;
}

function parseSd(text: string, result: GenerationMetadata, warn: Warn): void {
  result.source = 'sd-webui';
  let prompt = text;
  let parameters: Record<string, string> | undefined;
  // Keep only the last 32 candidates and parse backwards. Repeated Steps lines
  // in untrusted prompt text must not cause quadratic suffix reparsing.
  const footerOffsets: number[] = [];
  let discardedFooters = false;
  for (const match of text.matchAll(/^Steps:\s*\d+\b/gm)) {
    if (footerOffsets.length === 32) {
      footerOffsets.shift();
      discardedFooters = true;
    }
    footerOffsets.push(match.index);
  }
  for (const offset of footerOffsets.reverse()) {
    const candidate = footerParameters(text.slice(offset));
    if (candidate && Object.keys(candidate).length >= 2) {
      parameters = candidate;
      prompt = text.slice(0, offset).trimEnd();
      break;
    }
  }
  if (!parameters && discardedFooters)
    warn('SD WebUI footer candidate limit exceeded');
  if (!parameters)
    warn('SD WebUI metadata is partial: no credible parameter footer');
  else {
    result.params.sd = parameters;
    result.model = parameters.Model ?? '';
    result.seed = normalizeSeed(parameters.Seed);
    if (parameters.Seed && !result.seed) warn('Invalid SD WebUI seed');
  }
  const negative = /(?:^|\r?\n)Negative prompt:\s*/.exec(prompt);
  if (negative) {
    result.negativePrompt = prompt
      .slice(negative.index + negative[0].length)
      .trim();
    prompt = prompt.slice(0, negative.index);
  }
  result.prompt = prompt.trim();
}

interface ComfyNode {
  class_type: string;
  inputs: Record<string, unknown>;
}
interface ModelStep {
  node: string;
  classType: string;
  inputs: Record<string, unknown>;
}
interface Candidate {
  outputNode: string;
  samplerNode: string;
  prompt: string;
  negativePrompt: string;
  model: string;
  seed: string;
  modelChain: ModelStep[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

// Tokenize before JSON.parse: a reviver would receive already rounded numbers.
function losslessJson(text: string): unknown {
  const parts: string[] = [];
  let copied = 0;
  let quoted = false;
  let escaped = false;
  let depth = 0;
  for (let index = 0; index < text.length; index++) {
    const char = text[index] ?? '';
    if (quoted) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '"') quoted = false;
      continue;
    }
    if (char === '"') quoted = true;
    else if (char === '{' || char === '[') {
      if (++depth > 128) throw new Error('JSON nesting depth limit exceeded');
    } else if (char === '}' || char === ']') depth--;
    else if (char === '-' || /[0-9]/.test(char)) {
      let end = index + 1;
      while (end < text.length && /[0-9.eE+-]/.test(text[end] ?? '')) end++;
      const token = text.slice(index, end);
      if (
        /^-?(?:0|[1-9]\d*)$/.test(token) &&
        !Number.isSafeInteger(Number(token))
      ) {
        parts.push(text.slice(copied, index), JSON.stringify(token));
        copied = end;
      }
      index = end - 1;
    }
  }
  parts.push(text.slice(copied));
  return JSON.parse(parts.join('')) as unknown;
}

function parseJsonField(raw: string, key: string, warn: Warn): unknown {
  try {
    return losslessJson(raw);
  } catch (error) {
    warn(
      `ComfyUI ${key} JSON invalid: ${error instanceof Error ? error.message : 'parse failure'}`,
    );
    return undefined;
  }
}

function linkId(value: unknown): string | undefined {
  if (
    !Array.isArray(value) ||
    value.length !== 2 ||
    !Number.isInteger(value[1]) ||
    Number(value[1]) < 0
  )
    return undefined;
  return typeof value[0] === 'string' ||
    (typeof value[0] === 'number' && Number.isSafeInteger(value[0]))
    ? String(value[0])
    : undefined;
}

const imageInputs: Record<string, string[]> = {
  SaveImage: ['images'],
  PreviewImage: ['images'],
  VAEDecode: ['samples'],
  VAEDecodeTiled: ['samples'],
  ImageScale: ['image'],
  ImageScaleBy: ['image'],
  ImageUpscaleWithModel: ['image'],
  ImageBatch: ['image1', 'image2'],
  Reroute: ['input'],
};
const conditioningInputs: Record<string, string[]> = {
  ConditioningCombine: ['conditioning_1', 'conditioning_2'],
  ConditioningConcat: ['conditioning_to', 'conditioning_from'],
  ConditioningAverage: ['conditioning_to', 'conditioning_from'],
  ConditioningZeroOut: ['conditioning'],
  ConditioningSetArea: ['conditioning'],
  ConditioningSetAreaPercentage: ['conditioning'],
  ConditioningSetMask: ['conditioning'],
  ConditioningSetTimestepRange: ['conditioning'],
  ControlNetApply: ['conditioning'],
  ControlNetApplyAdvanced: ['positive', 'negative'],
  Reroute: ['input'],
};
const modelInputs: Record<string, string[]> = {
  LoraLoader: ['model'],
  LoraLoaderModelOnly: ['model'],
  ModelSamplingDiscrete: ['model'],
  ModelSamplingContinuousEDM: ['model'],
  FreeU: ['model'],
  FreeU_V2: ['model'],
  Reroute: ['input'],
};

function parseComfy(
  raw: RawText,
  result: GenerationMetadata,
  warn: Warn,
): void {
  result.source = 'comfyui';
  const workflow = raw.workflow?.[0];
  if (workflow !== undefined) parseJsonField(workflow, 'workflow', warn);
  const prompt = raw.prompt?.[0];
  if (prompt === undefined) {
    warn(
      'ComfyUI workflow-only metadata is partial; widget schemas are unsupported',
    );
    return;
  }
  const decoded = parseJsonField(prompt, 'prompt', warn);
  if (!isRecord(decoded)) {
    warn('ComfyUI execution graph is missing or invalid');
    return;
  }
  if (Object.keys(decoded).length > 4096) {
    warn('ComfyUI graph node count limit exceeded');
    return;
  }
  const graph = new Map<string, ComfyNode>();
  for (const [id, node] of Object.entries(decoded)) {
    if (
      isRecord(node) &&
      typeof node.class_type === 'string' &&
      isRecord(node.inputs)
    ) {
      graph.set(id, { class_type: node.class_type, inputs: node.inputs });
    } else warn('ComfyUI graph contains invalid node records');
  }
  let visits = 0;
  let incompleteImagePath = false;
  type Mode = 'image' | 'conditioning' | 'model';
  function walk(
    id: string,
    mode: Mode,
    leaf: (id: string, node: ComfyNode) => void,
    ancestors = new Set<string>(),
    outputSlot = 0,
  ): void {
    if (++visits > 8192 || ancestors.size >= 64) {
      if (mode === 'image') incompleteImagePath = true;
      warn('ComfyUI graph traversal or depth limit exceeded');
      return;
    }
    if (ancestors.has(id)) {
      if (mode === 'image') incompleteImagePath = true;
      warn(`ComfyUI cyclic graph link at node ${id}`);
      return;
    }
    const node = graph.get(id);
    if (!node) {
      if (mode === 'image') incompleteImagePath = true;
      warn(`ComfyUI graph refers to missing node ${id}`);
      return;
    }
    const type = node.class_type;
    if (
      (mode === 'image' &&
        (type === 'KSampler' || type === 'KSamplerAdvanced')) ||
      (mode === 'conditioning' &&
        [
          'CLIPTextEncode',
          'CLIPTextEncodeSDXL',
          'CLIPTextEncodeSDXLRefiner',
        ].includes(type)) ||
      (mode === 'model' &&
        [
          'CheckpointLoaderSimple',
          'CheckpointLoader',
          'UNETLoader',
          'UNETLoaderGGUF',
        ].includes(type))
    ) {
      leaf(id, node);
      return;
    }
    const mappings =
      mode === 'image'
        ? imageInputs
        : mode === 'conditioning'
          ? conditioningInputs
          : modelInputs;
    const keys =
      mode === 'conditioning' && type === 'ControlNetApplyAdvanced'
        ? outputSlot === 0
          ? ['positive']
          : outputSlot === 1
            ? ['negative']
            : undefined
        : Object.hasOwn(mappings, type)
          ? mappings[type]
          : undefined;
    if (!keys) {
      if (mode === 'image') incompleteImagePath = true;
      warn(`Unsupported ComfyUI ${mode} node: ${type}`);
      return;
    }
    if (mode === 'model') leaf(id, node);
    const nextAncestors = new Set(ancestors).add(id);
    for (const key of keys) {
      const upstream = linkId(node.inputs[key]);
      const value = node.inputs[key];
      if (upstream !== undefined)
        walk(
          upstream,
          mode,
          leaf,
          nextAncestors,
          Array.isArray(value) ? Number(value[1]) : 0,
        );
      else {
        if (mode === 'image') incompleteImagePath = true;
        warn(`ComfyUI ${type}.${key} has a missing or unsupported link`);
      }
    }
  }
  function conditioning(value: unknown): string {
    const id = linkId(value);
    if (id === undefined) {
      warn('ComfyUI conditioning link is missing or unsupported');
      return '';
    }
    const texts = new Set<string>();
    walk(
      id,
      'conditioning',
      (_id, node) => {
        const fields =
          node.class_type === 'CLIPTextEncodeSDXL'
            ? ['text_g', 'text_l']
            : ['text'];
        for (const field of fields) {
          const text = node.inputs[field];
          if (typeof text === 'string') texts.add(text);
          else
            warn(
              `Unsupported linked ComfyUI text field: ${node.class_type}.${field}`,
            );
        }
      },
      new Set(),
      Array.isArray(value) ? Number(value[1]) : 0,
    );
    return [...texts].join('\n');
  }
  const candidates: Candidate[] = [];
  const outputs = [...graph].filter(
    ([, node]) =>
      node.class_type === 'SaveImage' || node.class_type === 'PreviewImage',
  );
  if (!outputs.length)
    warn(
      'ComfyUI graph has no supported saved-image output; extraction is partial',
    );
  for (const [output] of outputs) {
    walk(output, 'image', (samplerId, sampler) => {
      if (
        candidates.some(
          (candidate) =>
            candidate.outputNode === output &&
            candidate.samplerNode === samplerId,
        )
      )
        return;
      if (candidates.length >= 32) {
        incompleteImagePath = true;
        warn('ComfyUI branch candidate limit exceeded');
        return;
      }
      const modelChain: ModelStep[] = [];
      const models = new Set<string>();
      const modelId = linkId(sampler.inputs.model);
      if (modelId !== undefined)
        walk(modelId, 'model', (nodeId, node) => {
          if (!modelChain.some((step) => step.node === nodeId))
            modelChain.push({
              node: nodeId,
              classType: node.class_type,
              inputs: node.inputs,
            });
          const name = node.inputs.ckpt_name ?? node.inputs.unet_name;
          if (typeof name === 'string') models.add(name);
        });
      else warn('ComfyUI sampler model link is missing or unsupported');
      const seed = normalizeSeed(
        sampler.inputs[
          sampler.class_type === 'KSamplerAdvanced' ? 'noise_seed' : 'seed'
        ],
      );
      if (!seed) warn('ComfyUI sampler seed is missing or invalid');
      if (models.size > 1)
        warn('ComfyUI model chain has multiple checkpoint candidates');
      candidates.push({
        outputNode: output,
        samplerNode: samplerId,
        prompt: conditioning(sampler.inputs.positive),
        negativePrompt: conditioning(sampler.inputs.negative),
        model: models.size === 1 ? ([...models][0] ?? '') : '',
        seed,
        modelChain,
      });
    });
  }
  result.params.comfy = { candidates };
  const selected = candidates[0];
  if (
    incompleteImagePath ||
    new Set(candidates.map((candidate) => candidate.samplerNode)).size > 1
  ) {
    warn(
      'Multiple ComfyUI saved-image sampler branches are ambiguous; review candidates',
    );
  } else if (selected) {
    result.prompt = selected.prompt;
    result.negativePrompt = selected.negativePrompt;
    result.model = selected.model;
    result.seed = selected.seed;
  } else
    warn(
      'ComfyUI graph has no reachable supported sampler; extraction is partial',
    );
}

function parseMidjourney(raw: RawText, result: GenerationMetadata): void {
  // Explicitly named fields only: there is no universal Midjourney PNG schema.
  const prompt = raw['Midjourney Prompt']?.[0];
  const model = raw['Midjourney Model']?.[0];
  const seed = raw['Midjourney Seed']?.[0];
  if (prompt === undefined && model === undefined && seed === undefined) return;
  result.source = 'midjourney';
  result.prompt = prompt ?? '';
  result.model = model ?? '';
  result.seed = normalizeSeed(seed);
}

/** Reads only bounded PNG ancillary metadata; image decoding remains independent. */
export function parsePngMetadata(input: Buffer): GenerationMetadata {
  const result: GenerationMetadata = {
    prompt: '',
    negativePrompt: '',
    model: '',
    seed: '',
    source: '',
    params: {},
  };
  if (
    input.length < PNG_SIGNATURE.length ||
    !input.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE)
  )
    return result;
  const warnings: string[] = [];
  const warn: Warn = (message) => {
    if (warnings.length < 64 && !warnings.includes(message))
      warnings.push(message);
  };
  const raw = collectText(input, warn);
  if (Object.keys(raw).length) result.params.raw = raw;
  const parameters = raw.parameters?.[0];
  if (parameters !== undefined) {
    parseSd(parameters, result, warn);
    if (raw.prompt || raw.workflow)
      warn('Multiple generator metadata formats found; SD WebUI selected');
  } else if (raw.prompt || raw.workflow) parseComfy(raw, result, warn);
  else parseMidjourney(raw, result);
  if (warnings.length) result.params.warnings = warnings;
  return result;
}
