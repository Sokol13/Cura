import { render, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { RichPreviewQueue } from './RichPreviewQueue';
import { renderPreview } from './render';

vi.mock('./render', () => ({ renderPreview: vi.fn() }));
afterEach(() => vi.unstubAllGlobals());
const candidate = {
  id: '00000000-0000-4000-8000-000000000001',
  assetId: '00000000-0000-4000-8000-000000000002',
  sourceHash: 'a'.repeat(64),
  name: 'scene.obj',
  size: 20,
  format: 'obj',
  revision: 0,
};

it('leaves a successfully rendered version pending when the upload queue is temporarily full', async () => {
  vi.mocked(renderPreview).mockResolvedValue(new Blob(['raster']));
  let savedAttempts = 0;
  const failures: unknown[] = [];
  vi.stubGlobal('fetch', async (_url: string, options?: RequestInit) => {
    if (options?.method === 'POST') {
      savedAttempts++;
      return new Response('Queue full', { status: 503 });
    }
    if (options?.method === 'PATCH') {
      failures.push(JSON.parse(String(options.body)));
      return new Response('{}');
    }
    return new Response(JSON.stringify({ items: [candidate] }));
  });
  const mounted = render(<RichPreviewQueue libraryId="library" />);
  await waitFor(() => expect(savedAttempts).toBe(1));
  mounted.unmount();
  expect(failures).toEqual([]);
});

it.each([new TypeError('Failed to fetch'), new Error('SOURCE_UNAVAILABLE')])(
  'does not persist a temporary source network error as an invalid file: %s',
  async (error) => {
    vi.mocked(renderPreview).mockRejectedValue(error);
    const failures: unknown[] = [];
    vi.stubGlobal('fetch', async (_url: string, options?: RequestInit) => {
      if (options?.method === 'PATCH')
        failures.push(JSON.parse(String(options.body)));
      return new Response(JSON.stringify({ items: [candidate] }));
    });
    vi.mocked(renderPreview).mockClear();
    const mounted = render(<RichPreviewQueue libraryId="library" />);
    await waitFor(() => expect(renderPreview).toHaveBeenCalledTimes(1));
    mounted.unmount();
    expect(failures).toEqual([]);
  },
);

it('records an actual renderer rejection as a persistent unsupported result', async () => {
  vi.mocked(renderPreview).mockRejectedValue(new Error('VIDEO_CODEC'));
  const failures: unknown[] = [];
  vi.stubGlobal('fetch', async (_url: string, options?: RequestInit) => {
    if (options?.method === 'PATCH')
      failures.push(JSON.parse(String(options.body)));
    return new Response(JSON.stringify({ items: [candidate] }));
  });
  const mounted = render(<RichPreviewQueue libraryId="library" />);
  await waitFor(() =>
    expect(failures).toEqual([
      {
        sourceHash: candidate.sourceHash,
        revision: 0,
        state: 'unsupported',
        error: 'VIDEO_CODEC',
      },
    ]),
  );
  mounted.unmount();
});
