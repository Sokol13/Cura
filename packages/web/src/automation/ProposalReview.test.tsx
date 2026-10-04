import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import {
  AutomationProposalViewSchema,
  type AutomationProposalView,
} from '@cura/shared';
import { i18n } from '../i18n';
import { ProposalReview } from './ProposalReview';
const id = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const stamp = '2026-10-04T00:00:00.000Z';
const identity = { libraryId: id(1), createdAt: stamp, updatedAt: stamp };
const pin = { assetId: id(2), versionId: id(3) };
const change = {
  ...identity,
  ...pin,
  proposalId: id(4),
  beforeValue: null,
  afterValue: 'Red house.png',
  suggestedTagNames: [],
  beforeTagLabels: [],
  afterTagLabels: [],
  status: 'pending',
  appliedAt: null,
  undoneAt: null,
};
const proposal = AutomationProposalViewSchema.parse({
  ...identity,
  ...pin,
  id: id(4),
  jobId: id(5),
  sourceName: 'Hero.png',
  sourceHash: 'abc',
  caption: '',
  provenance: {
    providerId: 'metadata-rules',
    kind: 'metadata-rules',
    mode: 'rules',
    model: null,
    rawText: '',
    derivation: null,
    inputKind: 'metadata',
    sourceHash: 'abc',
  },
  changeIds: [id(6), id(7)],
  changes: [
    { ...change, id: id(6), field: 'displayName' },
    {
      ...change,
      id: id(7),
      field: 'tagIds',
      beforeValue: [],
      afterValue: null,
      suggestedTagNames: ['Red'],
    },
  ],
});
beforeEach(async () => {
  await i18n.changeLanguage('en');
});
afterEach(() => vi.unstubAllGlobals());
function Harness({ initial = proposal }: { initial?: AutomationProposalView }) {
  const [items, setItems] = useState([initial]);
  return (
    <ProposalReview
      libraryId={id(1)}
      proposals={items}
      onUpdated={setItems}
      onRefresh={vi.fn()}
    />
  );
}
it('applies only the checked field with its captured version and exact before value', async () => {
  const updated = {
    ...proposal,
    changes: proposal.changes.map((entry) =>
      entry.id === id(6)
        ? { ...entry, status: 'applied', appliedAt: stamp }
        : entry,
    ),
  };
  const fetcher = vi.fn<typeof fetch>(
    async () =>
      new Response(JSON.stringify({ proposals: [updated], conflicts: [] })),
  );
  vi.stubGlobal('fetch', fetcher);
  render(<Harness />);
  expect(
    screen.getByText(
      'Deterministic metadata rules; this is not visual inference.',
    ),
  ).toBeVisible();
  fireEvent.click(
    screen.getByRole('checkbox', { name: 'Select Display name for Hero.png' }),
  );
  fireEvent.click(
    screen.getByRole('button', { name: 'Apply selected changes' }),
  );
  await waitFor(() => expect(fetcher).toHaveBeenCalled());
  expect(JSON.parse(fetcher.mock.calls[0]?.[1]?.body as string)).toEqual({
    items: [
      {
        proposalId: id(4),
        expectedVersionId: id(3),
        changes: [{ changeId: id(6), expectedValue: null }],
      },
    ],
  });
  expect(await screen.findByText('Applied')).toBeVisible();
  expect(screen.getByText('Pending review')).toBeVisible();
});
it('undoes selected applied values and reports conflicts without changing other fields', async () => {
  const applied = AutomationProposalViewSchema.parse({
    ...proposal,
    changes: proposal.changes.map((entry) => ({
      ...entry,
      status: 'applied',
      appliedAt: stamp,
      afterValue: entry.field === 'tagIds' ? [id(8)] : entry.afterValue,
      afterTagLabels:
        entry.field === 'tagIds' ? [{ id: id(8), name: 'Red' }] : [],
    })),
  });
  const fetcher = vi.fn<typeof fetch>(
    async () =>
      new Response(
        JSON.stringify({
          proposals: [applied],
          conflicts: [
            { proposalId: id(4), changeId: id(7), code: 'FIELD_CHANGED' },
          ],
        }),
      ),
  );
  vi.stubGlobal('fetch', fetcher);
  render(<Harness initial={applied} />);
  fireEvent.click(
    screen.getByRole('checkbox', { name: 'Select Tags for Hero.png' }),
  );
  fireEvent.click(
    screen.getByRole('button', { name: 'Undo selected changes' }),
  );
  await waitFor(() => expect(fetcher).toHaveBeenCalled());
  expect(JSON.parse(fetcher.mock.calls[0]?.[1]?.body as string)).toEqual({
    items: [
      {
        proposalId: id(4),
        expectedVersionId: id(3),
        changes: [{ changeId: id(7), expectedValue: [id(8)] }],
      },
    ],
  });
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'The asset version or approved value changed',
  );
  expect(screen.getAllByText('Applied')).toHaveLength(2);
});
