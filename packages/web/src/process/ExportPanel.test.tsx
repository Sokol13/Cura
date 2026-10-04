import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import type { ExportJob } from '@cura/shared';
import { i18n } from '../i18n';
import { ExportPanel } from './ExportPanel';
const libraryId = '00000000-0000-4000-8000-000000000001';
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
function network() {
  const reads: ReturnType<typeof deferred>[] = [],
    writes: ReturnType<typeof deferred>[] = [];
  const fetch = vi.fn((_url: string, init?: RequestInit) => {
    const pending = deferred();
    (init?.method === 'POST' ? writes : reads).push(pending);
    return pending.promise;
  });
  vi.stubGlobal('fetch', fetch);
  return { reads, writes };
}
async function deliver(pending: ReturnType<typeof deferred>, payload: unknown) {
  await act(async () => {
    pending.resolve(Response.json(payload));
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
  const { reads, writes } = network();
  render(<ExportPanel libraryId={libraryId} />);
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
  const { reads, writes } = network();
  render(<ExportPanel libraryId={libraryId} />);
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
  const { reads, writes } = network();
  render(<ExportPanel libraryId={libraryId} assetIds={[libraryId]} />);
  const button = screen.getByRole('button', {
    name: 'Export whole library',
  });
  act(() => {
    button.click();
    screen.getByRole('button', { name: 'Export 1 selected asset' }).click();
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
