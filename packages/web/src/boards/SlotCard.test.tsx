import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import type { BoardSlot } from '@cura/shared';
import { i18n } from '../i18n';
import { SlotCard } from './SlotCard';
const id = '00000000-0000-4000-8000-000000000001';
const stamp = '2026-10-04T00:00:00.000Z';
const slot: BoardSlot = {
  id,
  libraryId: id,
  boardId: id,
  label: 'Close-up',
  x: 0,
  y: 0,
  width: 240,
  height: 180,
  rowId: null,
  columnId: null,
  templateKey: null,
  revision: 0,
  currentPin: null,
  deletedAt: null,
  createdAt: stamp,
  updatedAt: stamp,
};
beforeEach(async () => {
  await i18n.changeLanguage('en');
});
it('accepts an exact version pin through a browser drop and isolates it from canvas drops', () => {
  const assign = vi.fn();
  const outer = vi.fn();
  render(
    <div onDrop={outer}>
      <SlotCard
        slot={slot}
        selected={false}
        busy={false}
        onChoose={vi.fn()}
        onAssign={assign}
        onHistory={vi.fn()}
      />
    </div>,
  );
  fireEvent.drop(
    screen.getByRole('region', { name: 'Drop asset into Close-up' }),
    {
      dataTransfer: {
        getData: () => JSON.stringify({ assetId: id, versionId: id }),
      },
    },
  );
  expect(assign).toHaveBeenCalledWith(slot, { assetId: id, versionId: id });
  expect(outer).not.toHaveBeenCalled();
});
it('rejects malformed external drag data without changing the assignment', () => {
  const assign = vi.fn();
  render(
    <SlotCard
      slot={slot}
      selected={false}
      busy={false}
      onChoose={vi.fn()}
      onAssign={assign}
      onHistory={vi.fn()}
    />,
  );
  fireEvent.drop(
    screen.getByRole('region', { name: 'Drop asset into Close-up' }),
    { dataTransfer: { getData: () => '{broken' } },
  );
  expect(assign).not.toHaveBeenCalled();
  expect(screen.getByRole('alert')).toHaveTextContent(
    'Drag an asset version from the library tray',
  );
});
