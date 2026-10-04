import { createServer } from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import {
  HTTPVisionProvider,
  MetadataRulesProvider,
} from '../src/automation/provider.js';
const closers: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const close of closers.splice(0)) await close();
});
async function endpoint(
  output: string,
  options: { delay?: number; status?: number } = {},
) {
  let body: Record<string, unknown> = {};
  const server = createServer(async (req, res) => {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    body = JSON.parse(Buffer.concat(chunks).toString()) as Record<
      string,
      unknown
    >;
    if (options.delay) await new Promise((r) => setTimeout(r, options.delay));
    res.writeHead(options.status ?? 200, {
      'content-type': 'application/json',
    });
    res.end(
      JSON.stringify({
        choices: [{ finish_reason: 'stop', message: { content: output } }],
      }),
    );
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const addr = server.address();
  if (!addr || typeof addr === 'string') throw Error('address');
  closers.push(
    () =>
      new Promise((r) => {
        server.closeAllConnections();
        server.close(() => r());
      }),
  );
  return {
    url: `http://127.0.0.1:${addr.port}/v1/chat/completions`,
    body: () => body,
  };
}
const input = {
  name: 'red house.png',
  prompt: 'forest watercolor',
  model: 'flux',
  source: 'ComfyUI',
  image: Buffer.from('png'),
  sourceHash: 'abcd',
  inputKind: 'original-raster' as const,
};
describe('real HTTP vision protocol adapter', () => {
  it('sends image bytes and validates actual structured response text', async () => {
    const ep = await endpoint(
      '{"tags":["house","red"],"name":"red-house","caption":"A red house"}',
    );
    const p = new HTTPVisionProvider({
      url: ep.url,
      model: 'test-model',
      mode: 'json',
    });
    const result = await p.analyze(input, new AbortController().signal);
    expect(result.suggestions.tags).toEqual(['house', 'red']);
    expect(JSON.stringify(ep.body())).toContain('data:image/png;base64,cG5n');
    expect(result.provenance).toMatchObject({
      kind: 'http-vision',
      mode: 'json',
      rawText:
        '{"tags":["house","red"],"name":"red-house","caption":"A red house"}',
      derivation: null,
    });
  });
  it('labels caption derivation and never silently rescues malformed JSON', async () => {
    const ep = await endpoint(' A house is red with blue roof and brown door.');
    const caption = await new HTTPVisionProvider({
      url: ep.url,
      model: 'SmolVLM',
      mode: 'caption',
    }).analyze(input, new AbortController().signal);
    expect(caption.suggestions.tags).toEqual(
      expect.arrayContaining(['house', 'red', 'blue', 'brown']),
    );
    expect(caption.provenance.rawText).toBe(
      ' A house is red with blue roof and brown door.',
    );
    expect(caption.provenance.derivation).toBe('caption-vocabulary-v1');
    await expect(
      new HTTPVisionProvider({
        url: ep.url,
        model: 'SmolVLM',
        mode: 'json',
      }).analyze(input, new AbortController().signal),
    ).rejects.toMatchObject({ code: 'PROVIDER_INVALID_OUTPUT' });
  });
  it('bounds response bytes and deadlines with public safe error codes', async () => {
    const big = await endpoint('a'.repeat(70000));
    await expect(
      new HTTPVisionProvider({
        url: big.url,
        model: 'm',
        mode: 'json',
      }).analyze(input, new AbortController().signal),
    ).rejects.toMatchObject({ code: 'PROVIDER_RESPONSE_TOO_LARGE' });
    const slow = await endpoint('{}', { delay: 100 });
    await expect(
      new HTTPVisionProvider({
        url: slow.url,
        model: 'm',
        mode: 'json',
        timeoutMs: 10,
      }).analyze(input, new AbortController().signal),
    ).rejects.toMatchObject({ code: 'PROVIDER_TIMEOUT' });
  });
  it('keeps offline metadata suggestions explicitly separate from vision inference', async () => {
    const result = await new MetadataRulesProvider().analyze(
      input,
      new AbortController().signal,
    );
    expect(result.provenance).toMatchObject({
      kind: 'metadata-rules',
      mode: 'rules',
      inputKind: 'metadata',
      model: null,
    });
    expect(result.suggestions.tags).toContain('watercolor');
  });
});
