import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ScriptBreakdownSchema, type ScriptBreakdown } from '@cura/shared';
import { i18n } from '../i18n';
import { ScriptEditor } from './ScriptEditor';
const id = '00000000-0000-4000-8000-000000000001';
const script = ScriptBreakdownSchema.parse({
  id,
  libraryId: id,
  title: '雨夜',
  sourcePin: { assetId: id, versionId: id },
  sourceHash: 'abc',
  lineCount: 5,
  revision: 3,
  entities: [
    {
      id,
      kind: 'character',
      name: '林',
      notes: '',
      references: [{ startLine: 2, endLine: 3, excerpt: '林\r\n你好。' }],
    },
  ],
  provenance: {
    providerId: 'structured-script',
    kind: 'structured-script',
    mode: 'rules',
    model: null,
    rawText: '',
    derivation: null,
    inputKind: 'text',
    sourceHash: 'abc',
  },
  createdAt: '2026-10-04T00:00:00.000Z',
  updatedAt: '2026-10-04T00:00:00.000Z',
});
beforeEach(async () => {
  await i18n.changeLanguage('en');
});
afterEach(() => vi.unstubAllGlobals());
function Harness() {
  const [value, setValue] = useState<ScriptBreakdown>(script);
  return (
    <ScriptEditor
      key={`${value.id}:${value.revision}`}
      libraryId={id}
      script={value}
      onSaved={setValue}
    />
  );
}
it('saves editable entity ranges without sending client-authored excerpts or changing source pins', async () => {
  const fetcher = vi.fn<typeof fetch>(
    async () => new Response(JSON.stringify({ ...script, revision: 4 })),
  );
  vi.stubGlobal('fetch', fetcher);
  render(<Harness />);
  expect(screen.getByText(/你好/)).toHaveTextContent('你好。');
  fireEvent.change(screen.getByLabelText('Entity name'), {
    target: { value: '林舟' },
  });
  fireEvent.change(screen.getByLabelText('Notes'), {
    target: { value: '主角' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));
  await waitFor(() => expect(fetcher).toHaveBeenCalled());
  expect(JSON.parse(fetcher.mock.calls[0]?.[1]?.body as string)).toEqual({
    expectedRevision: 3,
    title: '雨夜',
    entities: [
      {
        id,
        kind: 'character',
        name: '林舟',
        notes: '主角',
        ranges: [{ startLine: 2, endLine: 3 }],
      },
    ],
  });
  expect(
    screen.getByRole('link', { name: 'Download original script' }),
  ).toHaveAttribute('href', `/api/versions/${id}/file`);
});
it('keeps an unsaved script draft on conflict until the user explicitly reloads', async () => {
  const fetcher = vi.fn<typeof fetch>(async (_input, init) =>
    init?.method === 'PATCH'
      ? new Response(
          JSON.stringify({ code: 'CONFLICT', error: 'Stale revision' }),
          { status: 409 },
        )
      : new Response(
          JSON.stringify({ ...script, revision: 4, title: '新修订' }),
        ),
  );
  vi.stubGlobal('fetch', fetcher);
  render(<Harness />);
  fireEvent.change(screen.getByLabelText('Title'), {
    target: { value: '我的修改' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'changed elsewhere',
  );
  expect(screen.getByLabelText('Title')).toHaveValue('我的修改');
  fireEvent.click(screen.getByRole('button', { name: 'Reload latest' }));
  await waitFor(() =>
    expect(screen.getByLabelText('Title')).toHaveValue('新修订'),
  );
});

it('omits server IDs for newly added entities so the server can allocate an identity', async () => {
  const fetcher = vi.fn<typeof fetch>(
    async () => new Response(JSON.stringify({ ...script, revision: 4 })),
  );
  vi.stubGlobal('fetch', fetcher);
  render(<Harness />);
  fireEvent.click(screen.getByRole('button', { name: 'Add entity' }));
  fireEvent.change(screen.getAllByLabelText('Entity name')[1]!, {
    target: { value: 'Compass' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));
  await waitFor(() => expect(fetcher).toHaveBeenCalled());
  const payload = JSON.parse(fetcher.mock.calls[0]?.[1]?.body as string);
  expect(payload.entities[1]).toEqual({
    kind: 'character',
    name: 'Compass',
    notes: '',
    ranges: [],
  });
});
