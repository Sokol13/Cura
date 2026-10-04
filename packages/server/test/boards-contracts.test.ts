import { expect, it } from 'vitest';
import * as shared from '@cura/shared';

it('publishes board documents and version-pinned slot contracts', () => {
  expect(shared).toHaveProperty('BoardDocumentSchema');
  expect(shared).toHaveProperty('AssignBoardSlotSchema');
});

it('keeps board patches default-free and validates stable matrix axes', () => {
  expect(
    shared.UpdateBoardSchema.parse({ expectedRevision: 0, name: 'Renamed' }),
  ).toEqual({ expectedRevision: 0, name: 'Renamed' });
  expect(
    shared.CreateBoardSchema.safeParse({
      name: 'Matrix',
      kind: 'matrix',
      templateId: crypto.randomUUID(),
    }).success,
  ).toBe(false);
  const id = crypto.randomUUID();
  expect(
    shared.UpdateBoardSchema.safeParse({
      expectedRevision: 0,
      rows: [
        { id, label: 'one' },
        { id, label: 'duplicate' },
      ],
    }).success,
  ).toBe(false);
  expect(
    shared.AssignBoardSlotSchema.safeParse({ expectedRevision: -1, pin: null })
      .success,
  ).toBe(false);
});
