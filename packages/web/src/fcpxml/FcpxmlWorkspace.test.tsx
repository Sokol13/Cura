import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, afterEach, expect, test, vi } from 'vitest';
import { FcpxmlJobSchema } from '@cura/shared';
import { i18n } from '../i18n';
import { FcpxmlWorkspace } from './FcpxmlWorkspace';
const libraryId = '00000000-0000-4000-8000-000000000001',
  assetId = '00000000-0000-4000-8000-000000000002',
  v1 = '00000000-0000-4000-8000-000000000003',
  v2 = '00000000-0000-4000-8000-000000000004',
  jobId = '00000000-0000-4000-8000-000000000005';
function pending() {
  let resolve!: (response: Response) => void;
  const promise = new Promise<Response>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}
beforeEach(async () => {
  await i18n.changeLanguage('en');
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
test('historical pins, explicit order and frame units survive creation; late list cannot erase queued job or allow duplicate creation', async () => {
  const initial = pending(),
    post = pending();
  const bodies: unknown[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: RequestInit) => {
      if (url.includes('/fcpxml')) {
        if (init.method === 'POST') {
          bodies.push(JSON.parse(String(init.body)));
          return post.promise;
        }
        return initial.promise;
      }
      if (url.includes('/versions'))
        return Response.json([
          {
            id: v2,
            assetId,
            ordinal: 2,
            name: 'current.png',
            type: 'image/png',
          },
          { id: v1, assetId, ordinal: 1, name: 'old.jpg', type: 'image/jpeg' },
        ]);
      if (url.includes('/assets?'))
        return Response.json({
          items: [
            { id: assetId, name: 'current.png', displayName: 'Readable asset' },
          ],
          total: 1,
        });
      return Response.json([]);
    }),
  );
  render(<FcpxmlWorkspace libraryId={libraryId} onBack={() => undefined} />);
  await screen.findByRole('option', { name: 'Readable asset' });
  fireEvent.change(screen.getByLabelText('Asset', { exact: true }), {
    target: { value: assetId },
  });
  await screen.findByRole('option', { name: 'V1 · old.jpg' });
  fireEvent.change(screen.getByLabelText('Retained version'), {
    target: { value: v1 },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Add version' }));
  fireEvent.change(screen.getByLabelText('Retained version'), {
    target: { value: v2 },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Add version' }));
  fireEvent.change(
    within(screen.getByRole('region', { name: 'Clip 1' })).getByLabelText(
      'Duration (project frames)',
    ),
    { target: { value: '24' } },
  );
  fireEvent.click(screen.getByRole('button', { name: 'Move clip 2 up' }));
  expect(
    within(screen.getByRole('region', { name: 'Clip 1' })).getByLabelText(
      'Clip label',
    ),
  ).toHaveValue('current.png');
  const button = screen.getByRole('button', { name: 'Export FCPXML package' });
  act(() => {
    button.click();
    button.click();
  });
  expect(bodies).toHaveLength(1);
  const input = bodies[0] as {
    clips: { versionId: string; durationFrames: number }[];
  };
  expect(input.clips.map((c) => [c.versionId, c.durationFrames])).toEqual([
    [v2, 125],
    [v1, 24],
  ]);
  const job = FcpxmlJobSchema.parse({
    id: jobId,
    libraryId,
    createdAt: '2026-10-04T00:00:00.000Z',
    updatedAt: '2026-10-04T00:00:00.000Z',
    status: 'queued',
    progress: 0,
    request: input,
    filename: 'timeline.zip',
    duration: null,
    bytes: 0,
    problems: [],
    error: null,
  });
  await act(async () => {
    post.resolve(Response.json(job));
  });
  await act(async () => {
    initial.resolve(Response.json([]));
  });
  expect(
    screen.getByRole('region', { name: 'Export Timeline' }),
  ).toBeInTheDocument();
  expect(screen.getByText('Queued')).toBeInTheDocument();
});
test('board import uses creation order rather than coordinates and remains explicitly editable', async () => {
  const boardId = '00000000-0000-4000-8000-000000000006';
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      if (url === `/api/boards/${boardId}`)
        return Response.json({
          items: [
            {
              id: v2,
              assetId,
              versionId: v2,
              label: 'Later left',
              createdAt: '2026-10-04T02:00:00.000Z',
              x: -100,
              y: -100,
            },
            {
              id: v1,
              assetId,
              versionId: v1,
              label: 'Earlier right',
              createdAt: '2026-10-04T01:00:00.000Z',
              x: 100,
              y: 100,
            },
          ],
          slots: [],
        });
      if (url.endsWith('/boards'))
        return Response.json([{ id: boardId, name: 'Story references' }]);
      if (url.includes('/assets?'))
        return Response.json({ items: [], total: 0 });
      return Response.json([]);
    }),
  );
  render(<FcpxmlWorkspace libraryId={libraryId} onBack={() => undefined} />);
  await screen.findByRole('option', { name: 'Story references' });
  fireEvent.change(screen.getByLabelText('Import board pins'), {
    target: { value: boardId },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Append board pins' }));
  await screen.findByRole('region', { name: 'Clip 1' });
  expect(
    within(screen.getByRole('region', { name: 'Clip 1' })).getByLabelText(
      'Clip label',
    ),
  ).toHaveValue('Earlier right');
  fireEvent.click(screen.getByRole('button', { name: 'Move clip 1 down' }));
  expect(
    within(screen.getByRole('region', { name: 'Clip 1' })).getByLabelText(
      'Clip label',
    ),
  ).toHaveValue('Later left');
});

test.each(['search', 'page'])(
  '%s clears a selected pin before loading another asset page',
  async (action) => {
    const nextPage = pending();
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url.includes('/versions'))
          return Response.json([
            {
              id: v1,
              assetId,
              ordinal: 1,
              name: 'old.jpg',
              type: 'image/jpeg',
            },
          ]);
        if (url.includes('/assets?')) {
          const query = new URL(url, 'http://localhost').searchParams;
          if (query.get('q') || query.get('offset') !== '0')
            return nextPage.promise;
          return Response.json({
            items: [{ id: assetId, name: 'old.jpg' }],
            total: 101,
          });
        }
        return Response.json([]);
      }),
    );
    render(<FcpxmlWorkspace libraryId={libraryId} onBack={() => undefined} />);
    await screen.findByRole('option', { name: 'old.jpg' });
    fireEvent.change(screen.getByLabelText('Asset', { exact: true }), {
      target: { value: assetId },
    });
    await screen.findByRole('option', { name: 'V1 · old.jpg' });
    const add = screen.getByRole('button', { name: 'Add version' });
    expect(add).toBeEnabled();
    if (action === 'search')
      fireEvent.change(screen.getByLabelText('Find an asset'), {
        target: { value: 'unrelated' },
      });
    else fireEvent.click(screen.getByRole('button', { name: 'Next assets' }));
    expect(screen.getByLabelText('Asset', { exact: true })).toHaveValue('');
    expect(screen.getByLabelText('Retained version')).toHaveValue('');
    expect(add).toBeDisabled();
    fireEvent.click(add);
    expect(
      screen.queryByRole('region', { name: 'Clip 1' }),
    ).not.toBeInTheDocument();
    await act(async () =>
      nextPage.resolve(Response.json({ items: [], total: 0 })),
    );
    expect(add).toBeDisabled();
    expect(
      screen.queryByRole('region', { name: 'Clip 1' }),
    ).not.toBeInTheDocument();
  },
);
