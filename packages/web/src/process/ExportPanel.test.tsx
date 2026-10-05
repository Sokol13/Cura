import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import type { ExportJob, ExportPreview } from '@cura/shared';
import { i18n } from '../i18n';
import { ExportPanel } from './ExportPanel';
const libraryId = '00000000-0000-4000-8000-000000000001';
const assetA = '00000000-0000-4000-8000-000000000101';
const assetB = '00000000-0000-4000-8000-000000000102';
const dependencyA = '00000000-0000-4000-8000-000000000201';
const dependencyB = '00000000-0000-4000-8000-000000000202';
const stamp = '2026-10-04T00:00:00.000Z';
function job(id: string, status: ExportJob['status'] = 'queued'): ExportJob {
  return {
    id,
    libraryId,
    status,
    progress: status === 'completed' ? 1 : 0,
    request: { scope: 'library', assetIds: [] },
    filename: 'export.zip',
    bytes: status === 'completed' ? 100 : 0,
    exceptions: [],
    error: null,
    createdAt: stamp,
    updatedAt: stamp,
  };
}
function deferred() {
  let resolve!: (value: Response) => void;
  const promise = new Promise<Response>((complete) => {
    resolve = complete;
  });
  return { promise, resolve };
}
function preview(overrides: Partial<ExportPreview> = {}): ExportPreview {
  return {
    libraryId,
    scope: 'library',
    requestedAssetIds: [],
    includedDependencyAssetIds: [],
    requestedAssetCount: 0,
    dependencyAssetCount: 0,
    totalAssetCount: 0,
    reasons: [],
    previewToken: 'a'.repeat(64),
    ...overrides,
  };
}
function selected(
  ids = [assetA],
  dependencies: string[] = [],
  reasons: ExportPreview['reasons'] = [],
): ExportPreview {
  return preview({
    scope: 'selection',
    requestedAssetIds: ids,
    requestedAssetCount: ids.length,
    includedDependencyAssetIds: dependencies,
    dependencyAssetCount: dependencies.length,
    totalAssetCount: ids.length + dependencies.length,
    reasons,
  });
}
function network() {
  const reads: ReturnType<typeof deferred>[] = [],
    writes: ReturnType<typeof deferred>[] = [],
    previews: ReturnType<typeof deferred>[] = [];
  const fetch = vi.fn((url: string, init?: RequestInit) => {
    const pending = deferred();
    (url.endsWith('/preview')
      ? previews
      : init?.method === 'POST'
        ? writes
        : reads
    ).push(pending);
    return pending.promise;
  });
  vi.stubGlobal('fetch', fetch);
  return { reads, writes, previews, fetch };
}
async function deliver(
  pending: ReturnType<typeof deferred>,
  payload: unknown,
  status = 200,
) {
  await act(async () => {
    pending.resolve(Response.json(payload, { status }));
  });
}
beforeEach(async () => {
  await i18n.changeLanguage('en');
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

test('a deferred initial list cannot hide a newly created job or stop its completion polling', async () => {
  const { reads, writes, previews } = network();
  render(<ExportPanel libraryId={libraryId} />);
  await deliver(previews[0]!, preview());
  fireEvent.click(screen.getByRole('button', { name: 'Export whole library' }));
  const created = job('00000000-0000-4000-8000-000000000010');
  await deliver(writes[0]!, created);
  await deliver(reads[0]!, []);
  expect(
    screen.getByRole('region', { name: 'Export: Whole library' }),
  ).toBeInTheDocument();
  await act(async () => {
    await vi.advanceTimersByTimeAsync(400);
  });
  expect(reads).toHaveLength(2);
  await deliver(reads[1]!, [
    { ...created, status: 'completed', progress: 1, bytes: 100 },
  ]);
  expect(screen.getByRole('link', { name: 'Download ZIP' })).toHaveAttribute(
    'href',
    `/api/exports/${created.id}/file`,
  );
});

test('a pending refresh preserves a newer second job and continues polling both jobs to completion', async () => {
  const { reads, writes, previews } = network();
  render(<ExportPanel libraryId={libraryId} />);
  await deliver(previews[0]!, preview());
  const first = job('00000000-0000-4000-8000-000000000010'),
    second = job('00000000-0000-4000-8000-000000000011');
  await deliver(reads[0]!, [first]);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(400);
  });
  fireEvent.click(screen.getByRole('button', { name: 'Export whole library' }));
  await deliver(writes[0]!, second);
  await deliver(reads[1]!, [
    { ...first, status: 'completed', progress: 1, bytes: 100 },
  ]);
  expect(
    screen.getAllByRole('region', {
      name: 'Export: Whole library',
    }),
  ).toHaveLength(2);
  expect(screen.getByText('Queued', { exact: true })).toBeInTheDocument();
  await act(async () => {
    await vi.advanceTimersByTimeAsync(400);
  });
  await deliver(reads[2]!, [
    job(first.id, 'completed'),
    job(second.id, 'completed'),
  ]);
  expect(screen.getAllByRole('link', { name: 'Download ZIP' })).toHaveLength(2);
});

test('same-tick clicks issue one creation and a late POST cannot duplicate or regress a completed list result', async () => {
  const { reads, writes, previews } = network();
  render(<ExportPanel libraryId={libraryId} />);
  await deliver(previews[0]!, preview());
  const button = screen.getByRole('button', {
    name: 'Export whole library',
  });
  act(() => {
    button.click();
    button.click();
    button.click();
  });
  expect(writes).toHaveLength(1);
  const created = job('00000000-0000-4000-8000-000000000010');
  await deliver(reads[0]!, [job(created.id, 'completed')]);
  await deliver(writes[0]!, created);
  expect(
    screen.getAllByRole('region', {
      name: 'Export: Whole library',
    }),
  ).toHaveLength(1);
  expect(
    screen.getByRole('link', { name: 'Download ZIP' }),
  ).toBeInTheDocument();
  expect(screen.queryByText('Queued', { exact: true })).not.toBeInTheDocument();
  fireEvent.click(button);
  expect(writes).toHaveLength(2);
});

test('previews exact selection without creating jobs and explains overlapping board dependencies in both languages', async () => {
  const { previews, writes, fetch } = network();
  render(
    <ExportPanel libraryId={libraryId} assetIds={[assetB, assetA, assetA]} />,
  );
  expect(screen.getByRole('combobox', { name: 'Export scope' })).toHaveValue(
    'selection',
  );
  expect(
    screen.getByRole('button', { name: 'Export 2 selected assets' }),
  ).toBeDisabled();
  await deliver(
    previews[0]!,
    selected(
      [assetA, assetB],
      [dependencyA, dependencyB],
      [
        { reason: 'board', count: 2 },
        { reason: 'brand', count: 1 },
      ],
    ),
  );
  expect(writes).toHaveLength(0);
  expect(screen.getByText('4 assets in this export')).toBeInTheDocument();
  expect(screen.getByText('Boards: 2')).toBeInTheDocument();
  expect(screen.getByText('Brands: 1')).toBeInTheDocument();
  expect(
    screen.getByText('An asset can appear in more than one category.'),
  ).toBeInTheDocument();
  expect(
    screen.getByRole('button', {
      name: 'Export 2 selected assets + 2 assets referenced by boards',
    }),
  ).toBeEnabled();
  await act(async () => {
    await i18n.changeLanguage('zh-CN');
  });
  const button = screen.getByRole('button', {
    name: '导出 2 个选定资产 + 2 个被看板引用的资产',
  });
  expect(previews).toHaveLength(1);
  fireEvent.click(button);
  const creation = fetch.mock.calls.find(
    ([url, init]) => url.endsWith('/exports') && init?.method === 'POST',
  );
  expect(JSON.parse(creation![1]!.body as string)).toEqual({
    scope: 'selection',
    assetIds: [assetA, assetB],
    expectedPreviewToken: 'a'.repeat(64),
  });
});

test('only a dedicated stale-preview conflict refreshes counts and requires a second explicit confirmation', async () => {
  const { previews, writes, fetch } = network();
  render(<ExportPanel libraryId={libraryId} assetIds={[assetA]} />);
  await deliver(previews[0]!, selected());
  fireEvent.click(
    screen.getByRole('button', { name: 'Export 1 selected asset' }),
  );
  await deliver(
    writes[0]!,
    { error: 'Changed', code: 'EXPORT_PREVIEW_STALE' },
    409,
  );
  expect(previews).toHaveLength(2);
  expect(
    screen.getByRole('button', { name: 'Export 1 selected asset' }),
  ).toBeDisabled();
  await deliver(previews[1]!, {
    ...selected(
      [assetA],
      [dependencyA, dependencyB],
      [
        { reason: 'board', count: 1 },
        { reason: 'brand', count: 1 },
      ],
    ),
    previewToken: 'b'.repeat(64),
  });
  expect(screen.getByRole('alert')).toHaveTextContent(
    'Export contents changed. Review the updated counts and confirm again.',
  );
  expect(writes).toHaveLength(1);
  fireEvent.click(
    screen.getByRole('button', {
      name: 'Export 1 selected asset + 2 additional dependent assets',
    }),
  );
  expect(writes).toHaveLength(2);
  expect(
    JSON.parse(
      fetch.mock.calls.filter(
        ([url, init]) => url.endsWith('/exports') && init?.method === 'POST',
      )[1]![1]!.body as string,
    ).expectedPreviewToken,
  ).toBe('b'.repeat(64));
  await deliver(
    writes[1]!,
    { error: 'Another export is running', code: 'EXPORT_BUSY' },
    409,
  );
  expect(previews).toHaveLength(2);
  expect(screen.getByRole('alert')).toHaveTextContent(
    'Another export is running',
  );
});

test('A to B to A selection changes reject old success and error responses even when abort is ignored', async () => {
  const { previews, writes } = network();
  const view = render(
    <ExportPanel libraryId={libraryId} assetIds={[assetA]} />,
  );
  view.rerender(<ExportPanel libraryId={libraryId} assetIds={[assetB]} />);
  view.rerender(<ExportPanel libraryId={libraryId} assetIds={[assetA]} />);
  await deliver(previews[0]!, selected());
  expect(
    screen.getByRole('button', { name: 'Export 1 selected asset' }),
  ).toBeDisabled();
  await deliver(
    previews[1]!,
    { error: 'Old failure', code: 'INVALID_SELECTION' },
    400,
  );
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  await deliver(previews[2]!, selected());
  expect(
    screen.getByRole('button', { name: 'Export 1 selected asset' }),
  ).toBeEnabled();
  expect(writes).toHaveLength(0);
});

test.each([
  ['library identity', selected([assetA], [], []), { libraryId: assetB }],
  ['scope identity', preview(), {}],
  ['selected membership', selected([assetB]), {}],
  ['count consistency', selected(), { requestedAssetCount: 5 }],
])(
  'rejects a preview with incorrect %s and supports retry without a job',
  async (_name, payload, overrides) => {
    const { previews, writes } = network();
    render(<ExportPanel libraryId={libraryId} assetIds={[assetA]} />);
    await deliver(previews[0]!, { ...payload, ...overrides });
    expect(screen.getByRole('alert')).toHaveTextContent(
      'The export preview does not match this selection.',
    );
    expect(
      screen.getByRole('button', { name: 'Export 1 selected asset' }),
    ).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Retry preview' }));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    await deliver(previews[1]!, selected());
    expect(
      screen.getByRole('button', { name: 'Export 1 selected asset' }),
    ).toBeEnabled();
    expect(writes).toHaveLength(0);
  },
);

test('scope changes immediately invalidate ready counts and accept whole-library membership', async () => {
  const { previews, writes, fetch } = network();
  render(<ExportPanel libraryId={libraryId} assetIds={[assetA]} />);
  await deliver(
    previews[0]!,
    selected([assetA], [dependencyA], [{ reason: 'board', count: 1 }]),
  );
  fireEvent.change(screen.getByRole('combobox', { name: 'Export scope' }), {
    target: { value: 'library' },
  });
  const button = screen.getByRole('button', { name: 'Export whole library' });
  expect(button).toBeDisabled();
  expect(screen.queryByText('Boards: 1')).not.toBeInTheDocument();
  fireEvent.click(button);
  expect(writes).toHaveLength(0);
  await deliver(
    previews[1]!,
    preview({
      requestedAssetIds: [assetA, assetB, dependencyA],
      requestedAssetCount: 3,
      totalAssetCount: 3,
    }),
  );
  expect(screen.getByText('3 assets in this export')).toBeInTheDocument();
  fireEvent.click(button);
  expect(
    JSON.parse(
      fetch.mock.calls.find(
        ([url, init]) => url.endsWith('/exports') && init?.method === 'POST',
      )![1]!.body as string,
    ),
  ).toEqual({
    scope: 'library',
    assetIds: [],
    expectedPreviewToken: 'a'.repeat(64),
  });
});

test('a library round trip ignores the first visit preview, POST error and list response', async () => {
  const { previews, writes, reads } = network();
  const view = render(<ExportPanel libraryId={libraryId} />);
  await deliver(previews[0]!, preview());
  fireEvent.click(screen.getByRole('button', { name: 'Export whole library' }));
  view.rerender(<ExportPanel libraryId={assetB} />);
  view.rerender(<ExportPanel libraryId={libraryId} />);
  await deliver(
    writes[0]!,
    { error: 'Old visit failed', code: 'EXPORT_PREVIEW_STALE' },
    409,
  );
  await deliver(reads[0]!, [job(dependencyA)]);
  await deliver(previews[1]!, preview({ libraryId: assetB }));
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  expect(screen.queryByRole('region')).not.toBeInTheDocument();
  expect(
    screen.getByRole('button', { name: 'Export whole library' }),
  ).toBeDisabled();
  expect(previews).toHaveLength(3);
  await deliver(previews[2]!, preview());
  expect(
    screen.getByRole('button', { name: 'Export whole library' }),
  ).toBeEnabled();
});

test.each(['success', 'failure'] as const)(
  'old creation %s and finally cannot alter a newer submission after A to B to A',
  async (outcome) => {
    const { previews, writes, reads } = network();
    const view = render(
      <ExportPanel libraryId={libraryId} assetIds={[assetA]} />,
    );
    await deliver(previews[0]!, selected());
    fireEvent.click(
      screen.getByRole('button', { name: 'Export 1 selected asset' }),
    );
    view.rerender(<ExportPanel libraryId={libraryId} assetIds={[assetB]} />);
    view.rerender(<ExportPanel libraryId={libraryId} assetIds={[assetA]} />);
    expect(
      screen.getByRole('button', { name: 'Export 1 selected asset' }),
    ).toBeDisabled();
    await deliver(previews[2]!, selected());
    const button = screen.getByRole('button', {
      name: 'Export 1 selected asset',
    });
    fireEvent.click(button);
    if (outcome === 'failure')
      await deliver(
        writes[0]!,
        { error: 'Old creation error', code: 'EXPORT_PREVIEW_STALE' },
        409,
      );
    else await deliver(writes[0]!, job(dependencyA));
    expect(button).toBeDisabled();
    expect(previews).toHaveLength(3);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    if (outcome === 'success') {
      expect(screen.getAllByRole('region')).toHaveLength(1);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(400);
      });
      expect(reads).toHaveLength(2);
      await deliver(reads[1]!, [job(dependencyA, 'completed')]);
      expect(
        screen.getByRole('link', { name: 'Download ZIP' }),
      ).toHaveAttribute('href', `/api/exports/${dependencyA}/file`);
    } else expect(screen.queryByRole('region')).not.toBeInTheDocument();
    fireEvent.click(button);
    expect(writes).toHaveLength(2);
    await deliver(writes[1]!, job(dependencyB));
    expect(button).toBeEnabled();
    expect(screen.getAllByRole('region')).toHaveLength(
      outcome === 'success' ? 2 : 1,
    );
  },
);

test('a preview request error blocks creation and can be retried after selection changes', async () => {
  const { previews, writes } = network();
  const view = render(
    <ExportPanel libraryId={libraryId} assetIds={[assetA]} />,
  );
  await deliver(
    previews[0]!,
    { error: 'Selected asset is unavailable', code: 'INVALID_SELECTION' },
    400,
  );
  expect(screen.getByRole('alert')).toHaveTextContent(
    'Selected asset is unavailable',
  );
  expect(
    screen.getByRole('button', { name: 'Export 1 selected asset' }),
  ).toBeDisabled();
  view.rerender(<ExportPanel libraryId={libraryId} assetIds={[assetB]} />);
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  await deliver(previews[1]!, selected([assetB]));
  expect(
    screen.getByRole('button', { name: 'Export 1 selected asset' }),
  ).toBeEnabled();
  expect(writes).toHaveLength(0);
});

test('closing and reopening abandons preview responses from the previous dialog', async () => {
  const { previews } = network();
  const view = render(
    <ExportPanel libraryId={libraryId} assetIds={[assetA]} />,
  );
  view.unmount();
  render(<ExportPanel libraryId={libraryId} assetIds={[assetA]} />);
  await deliver(
    previews[0]!,
    selected([assetA], [dependencyA], [{ reason: 'board', count: 1 }]),
  );
  expect(
    screen.getByRole('button', { name: 'Export 1 selected asset' }),
  ).toBeDisabled();
  await deliver(previews[1]!, selected());
  expect(
    screen.getByRole('button', { name: 'Export 1 selected asset' }),
  ).toBeEnabled();
});
