import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ArchiveRuleSchema } from '@cura/shared';
import { i18n } from '../i18n';
import { ArchiveRulesPanel } from './ArchiveRulesPanel';
const id = '00000000-0000-4000-8000-000000000001';
const rule = ArchiveRuleSchema.parse({
  id,
  libraryId: id,
  name: 'Old drafts',
  enabled: false,
  filters: { olderThanDays: 30, folderId: null, tagIds: [], maxRating: 3 },
  revision: 4,
  lastJobId: null,
  createdAt: '2026-10-04T00:00:00.000Z',
  updatedAt: '2026-10-04T00:00:00.000Z',
});
const json = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), { status });
beforeEach(async () => {
  await i18n.changeLanguage('en');
});
afterEach(() => vi.unstubAllGlobals());
it('previews historical final protection and runs only the displayed rule revision', async () => {
  const fetcher = vi.fn<typeof fetch>(async (input, options) => {
    const url = String(input);
    if (url.includes('/preview'))
      return json({
        eligible: [
          { assetId: id, versionId: id, name: 'Draft.png', reason: 'eligible' },
        ],
        protected: [
          {
            assetId: id,
            versionId: id,
            name: 'Final V1.png',
            reason: 'final-selection',
          },
        ],
        eligibleTotal: 1,
        protectedTotal: 1,
      });
    if (url.endsWith('/run'))
      return json({ error: 'Changed', code: 'CONFLICT' }, 409);
    if (
      url.includes('/archive-rules') &&
      (!options?.method || options.method === 'GET')
    )
      return json({ items: [rule], total: 1, offset: 0, limit: 30 });
    return json([]);
  });
  vi.stubGlobal('fetch', fetcher);
  render(<ArchiveRulesPanel libraryId={id} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Old drafts' }));
  fireEvent.click(screen.getByRole('button', { name: 'Preview rule' }));
  expect(await screen.findByText('Final V1.png')).toBeVisible();
  expect(screen.getByText('Draft.png')).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: 'Run rule' }));
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'changed elsewhere',
  );
  const request = fetcher.mock.calls.find(([url]) =>
    String(url).endsWith('/run'),
  );
  expect(JSON.parse(request?.[1]?.body as string)).toEqual({
    expectedRevision: 4,
  });
});
it('preserves all other fields when editing only a rule name', async () => {
  const fetcher = vi.fn<typeof fetch>(async (input, options) => {
    if (
      String(input).includes('/archive-rules') &&
      (!options?.method || options.method === 'GET')
    )
      return json({ items: [rule], total: 1, offset: 0, limit: 30 });
    if (options?.method === 'PATCH')
      return json({ ...rule, name: 'Reviewed drafts', revision: 5 });
    return json([]);
  });
  vi.stubGlobal('fetch', fetcher);
  render(<ArchiveRulesPanel libraryId={id} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Old drafts' }));
  fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
  const dialog = screen.getByRole('dialog');
  fireEvent.change(within(dialog).getByLabelText('Rule name'), {
    target: { value: 'Reviewed drafts' },
  });
  fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
  await waitFor(() =>
    expect(
      fetcher.mock.calls.some(([, init]) => init?.method === 'PATCH'),
    ).toBe(true),
  );
  const patch = fetcher.mock.calls.find(([, init]) => init?.method === 'PATCH');
  expect(JSON.parse(patch?.[1]?.body as string)).toEqual({
    expectedRevision: 4,
    name: 'Reviewed drafts',
    enabled: false,
    filters: rule.filters,
  });
});

it('allows reviewing archive candidates beyond the first page without changing the rule revision', async () => {
  const fetcher = vi.fn<typeof fetch>(async (input) => {
    const url = String(input);
    if (url.includes('/preview')) {
      const second =
        new URL(url, 'http://localhost').searchParams.get('offset') === '30';
      return json({
        eligible: [
          {
            assetId: id,
            versionId: id,
            name: second ? 'Draft 31' : 'Draft 1',
            reason: 'eligible',
          },
        ],
        protected: [],
        eligibleTotal: 31,
        protectedTotal: 0,
      });
    }
    return json({ items: [rule], total: 1, offset: 0, limit: 30 });
  });
  vi.stubGlobal('fetch', fetcher);
  render(<ArchiveRulesPanel libraryId={id} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Old drafts' }));
  fireEvent.click(screen.getByRole('button', { name: 'Preview rule' }));
  await screen.findByText('Draft 1');
  fireEvent.click(
    screen
      .getAllByRole('button', { name: 'Next page' })
      .find((button) => !button.hasAttribute('disabled'))!,
  );
  expect(await screen.findByText('Draft 31')).toBeVisible();
  const call = fetcher.mock.calls.find(([url]) =>
    String(url).includes('offset=30'),
  );
  expect(JSON.parse(call?.[1]?.body as string)).toEqual({
    expectedRevision: 4,
  });
});
