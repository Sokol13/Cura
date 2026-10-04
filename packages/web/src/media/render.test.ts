import { afterEach, expect, it, vi } from 'vitest';
import { sourceBytes } from './render';
import type { PreviewCandidate } from '@cura/shared';
afterEach(() => vi.unstubAllGlobals());
const candidate: PreviewCandidate = {
  id: 'version',
  assetId: 'asset',
  sourceHash: 'a'.repeat(64),
  revision: 0,
  name: 'test.pdf',
  format: 'pdf',
  size: 3,
};

it('keeps unavailable or interrupted source responses distinguishable from decoder failures', async () => {
  for (const response of [
    new Response(null, { status: 503 }),
    new Response(new Uint8Array([1])),
  ]) {
    vi.stubGlobal('fetch', async () => response);
    await expect(
      sourceBytes(candidate, new AbortController().signal),
    ).rejects.toThrow('SOURCE_UNAVAILABLE');
  }
  vi.stubGlobal('fetch', async () => {
    throw new TypeError('Network disconnected');
  });
  await expect(
    sourceBytes(candidate, new AbortController().signal),
  ).rejects.toThrow('SOURCE_UNAVAILABLE');
});

it('accepts exact source bytes but stops oversized bodies before rendering', async () => {
  vi.stubGlobal('fetch', async () => new Response(new Uint8Array([1, 2, 3])));
  expect(
    new Uint8Array(await sourceBytes(candidate, new AbortController().signal)),
  ).toEqual(new Uint8Array([1, 2, 3]));
  vi.stubGlobal(
    'fetch',
    async () => new Response(new Uint8Array([1, 2, 3, 4])),
  );
  await expect(
    sourceBytes(candidate, new AbortController().signal),
  ).rejects.toThrow('SIZE_LIMIT');
});
