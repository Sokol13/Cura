import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { SettingDocumentSchema, type SettingDocument } from '@cura/shared';
import { i18n } from '../i18n';
import { DocumentEditor } from './DocumentEditor';
const id = '00000000-0000-4000-8000-000000000001';
const document = SettingDocumentSchema.parse({
  id,
  libraryId: id,
  title: 'Character brief',
  kind: 'character',
  language: 'en',
  revision: 2,
  markdown: '# Hero\nRetained prompt.',
  sources: [
    {
      assetId: id,
      versionId: id,
      hash: 'abc',
      name: 'Hero V1.png',
      note: 'Old note',
      prompt: 'Retained prompt.',
      negativePrompt: '',
      model: 'Model A',
      source: 'Local',
      seed: '18446744073709551615',
      width: 400,
      height: 400,
      tags: ['Hero'],
    },
  ],
  scriptId: null,
  entities: [],
  provenance: 'metadata-document-v1',
  createdAt: '2026-10-04T00:00:00.000Z',
  updatedAt: '2026-10-04T00:00:00.000Z',
});
beforeEach(async () => {
  await i18n.changeLanguage('en');
});
afterEach(() => vi.unstubAllGlobals());
function Harness() {
  const [value, setValue] = useState<SettingDocument>(document);
  return (
    <DocumentEditor
      key={`${value.id}:${value.revision}`}
      libraryId={id}
      document={value}
      onSaved={setValue}
    />
  );
}
it('edits Markdown with the displayed revision while preserving exact historical provenance', async () => {
  const fetcher = vi.fn<typeof fetch>(
    async () =>
      new Response(
        JSON.stringify({ ...document, revision: 3, markdown: '# Edited' }),
      ),
  );
  vi.stubGlobal('fetch', fetcher);
  render(<Harness />);
  fireEvent.change(screen.getByLabelText('Markdown content'), {
    target: { value: '# Edited' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));
  await waitFor(() => expect(fetcher).toHaveBeenCalled());
  expect(JSON.parse(fetcher.mock.calls[0]?.[1]?.body as string)).toEqual({
    expectedRevision: 2,
    title: 'Character brief',
    markdown: '# Edited',
  });
  expect(screen.getByText('18446744073709551615')).toBeVisible();
  expect(screen.getByRole('link', { name: 'Export Markdown' })).toHaveAttribute(
    'href',
    `/api/libraries/${id}/automation/documents/${id}/export?format=markdown`,
  );
});
it('retains conflicting local text and only replaces it after explicit reload', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn<typeof fetch>(async (_url, init) =>
      init?.method === 'PATCH'
        ? new Response(JSON.stringify({ error: 'Changed', code: 'CONFLICT' }), {
            status: 409,
          })
        : new Response(
            JSON.stringify({
              ...document,
              revision: 3,
              markdown: '# Remote edit',
            }),
          ),
    ),
  );
  render(<Harness />);
  fireEvent.change(screen.getByLabelText('Markdown content'), {
    target: { value: '# My draft' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'changed elsewhere',
  );
  expect(screen.getByLabelText('Markdown content')).toHaveValue('# My draft');
  fireEvent.click(screen.getByRole('button', { name: 'Reload latest' }));
  await waitFor(() =>
    expect(screen.getByLabelText('Markdown content')).toHaveValue(
      '# Remote edit',
    ),
  );
});
