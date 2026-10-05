import { randomUUID } from 'node:crypto';
import { expect, it } from 'vitest';
import * as S from '@cura/shared';
const revision = () => ({
  id: randomUUID(),
  libraryId: randomUUID(),
  slotId: randomUUID(),
  ordinal: 1,
  pin: null,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
});
it('keeps legacy attribution absent and accepts only explicit bounded actor shapes', () => {
  const old = revision();
  expect(S.SlotRevisionSchema.parse(old)).toEqual(old);
  expect(Object.hasOwn(S.SlotRevisionSchema.parse(old), 'actor')).toBe(false);
  for (const actor of [
    { kind: 'local' },
    { kind: 'account', id: randomUUID(), email: 'maker@example.test' },
    { kind: 'system', reason: 'sync-resolution' },
  ]) {
    expect(S.SlotRevisionSchema.parse({ ...old, actor })).toEqual({
      ...old,
      actor,
    });
  }
  expect(
    S.SlotActorSchema.safeParse({ kind: 'local', token: 'private' }).success,
  ).toBe(false);
  expect(
    S.SlotActorSchema.safeParse({
      kind: 'account',
      id: randomUUID(),
      email: 'x'.repeat(321),
    }).success,
  ).toBe(false);
  expect(
    S.AssignBoardSlotSchema.safeParse({
      expectedRevision: 0,
      pin: null,
      actor: { kind: 'local' },
    }).success,
  ).toBe(false);
});
it('requires a history view source without introducing it into portable revisions', () => {
  const old = revision();
  expect(S.SlotHistorySchema.parse([{ ...old, source: null }])).toEqual([
    { ...old, source: null },
  ]);
  expect(S.SlotHistorySchema.safeParse([old]).success).toBe(false);
  expect(S.SlotRevisionSchema.parse({ ...old, source: null })).toEqual(old);
});
