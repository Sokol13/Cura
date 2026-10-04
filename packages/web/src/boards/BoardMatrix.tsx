import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type {
  BoardAxis,
  BoardDocument,
  BoardPin,
  BoardSlot,
} from '@cura/shared';
import { NameForm, DeleteConfirm } from './BoardForms';
import { SlotCard } from './SlotCard';

type AxisAction = {
  axis: 'rows' | 'columns';
  item?: BoardAxis;
  deleting?: boolean;
};
export function BoardMatrix({
  document,
  busy,
  selectedSlot,
  onChoose,
  onAssign,
  onHistory,
  onAxes,
}: {
  document: BoardDocument;
  busy: boolean;
  selectedSlot: string | null;
  onChoose: (slot: BoardSlot) => void;
  onAssign: (slot: BoardSlot, pin: BoardPin) => void;
  onHistory: (slot: BoardSlot) => void;
  onAxes: (axis: 'rows' | 'columns', items: BoardAxis[]) => Promise<boolean>;
}) {
  const { t } = useTranslation('boards');
  const [action, setAction] = useState<AxisAction | null>(null);
  const { board, slots } = document;
  const move = async (
    axis: 'rows' | 'columns',
    from: number,
    direction: -1 | 1,
  ) => {
    const items = [...board[axis]];
    const item = items[from];
    if (!item || from + direction < 0 || from + direction >= items.length)
      return;
    items.splice(from, 1);
    items.splice(from + direction, 0, item);
    await onAxes(axis, items);
  };
  const axisHeader = (
    axis: 'rows' | 'columns',
    item: BoardAxis,
    index: number,
  ) => (
    <div className="board-axis-header">
      <strong>{item.label}</strong>
      <div className="board-axis-actions">
        <button
          disabled={busy}
          aria-label={t('editAxis', { name: item.label })}
          onClick={() => setAction({ axis, item })}
        >
          ✎
        </button>
        <button
          disabled={busy || index === 0}
          aria-label={`${t(axis === 'rows' ? 'moveUp' : 'moveLeft')} ${item.label}`}
          onClick={() => void move(axis, index, -1)}
        >
          ←
        </button>
        <button
          disabled={busy || index === board[axis].length - 1}
          aria-label={`${t(axis === 'rows' ? 'moveDown' : 'moveRight')} ${item.label}`}
          onClick={() => void move(axis, index, 1)}
        >
          →
        </button>
        <button
          disabled={busy || board[axis].length === 1}
          aria-label={t('deleteAxis', { name: item.label })}
          onClick={() => setAction({ axis, item, deleting: true })}
        >
          ×
        </button>
      </div>
    </div>
  );
  return (
    <section className="board-matrix-workspace" aria-label={t('matrix')}>
      <div className="board-toolbar">
        <p>{t('matrixHint')}</p>
        <button
          disabled={busy || board.rows.length >= 50}
          onClick={() => setAction({ axis: 'rows' })}
        >
          <span aria-hidden="true">＋</span> {t('addRow')}
        </button>
        <button
          disabled={busy || board.columns.length >= 50}
          onClick={() => setAction({ axis: 'columns' })}
        >
          <span aria-hidden="true">＋</span> {t('addColumn')}
        </button>
      </div>
      <div className="board-matrix-scroll">
        <div
          className="board-matrix"
          style={{
            gridTemplateColumns: `180px repeat(${board.columns.length}, 250px)`,
          }}
        >
          <div className="board-matrix-corner">
            {t('row')} / {t('column')}
          </div>
          {board.columns.map((column, index) => (
            <div key={column.id}>{axisHeader('columns', column, index)}</div>
          ))}
          {board.rows.flatMap((row, index) => [
            <div className="board-matrix-row-heading" key={`row-${row.id}`}>
              {axisHeader('rows', row, index)}
            </div>,
            ...board.columns.map((column) => {
              const slot = slots.find(
                (entry) =>
                  entry.rowId === row.id && entry.columnId === column.id,
              );
              return (
                <div
                  className="board-matrix-cell"
                  key={`${row.id}-${column.id}`}
                  data-row-id={row.id}
                  data-column-id={column.id}
                >
                  {slot && (
                    <SlotCard
                      slot={slot}
                      selected={selectedSlot === slot.id}
                      busy={busy}
                      onChoose={onChoose}
                      onAssign={onAssign}
                      onHistory={onHistory}
                    />
                  )}
                </div>
              );
            }),
          ])}
        </div>
      </div>
      {action &&
        (action.deleting && action.item ? (
          <DeleteConfirm
            name={action.item.label}
            hint={t('deleteAxisHint')}
            onClose={() => setAction(null)}
            onConfirm={async () => {
              if (
                await onAxes(
                  action.axis,
                  board[action.axis].filter(
                    (item) => item.id !== action.item?.id,
                  ),
                )
              )
                setAction(null);
              else throw new Error(t('changeNotSaved'));
            }}
          />
        ) : (
          <NameForm
            title={
              action.item
                ? t('editAxis', { name: action.item.label })
                : t(action.axis === 'rows' ? 'addRow' : 'addColumn')
            }
            label={t(action.axis === 'rows' ? 'rowName' : 'columnName')}
            initial={action.item?.label ?? ''}
            onClose={() => setAction(null)}
            onSave={async (label) => {
              const items = action.item
                ? board[action.axis].map((item) =>
                    item.id === action.item?.id ? { ...item, label } : item,
                  )
                : [...board[action.axis], { id: crypto.randomUUID(), label }];
              if (await onAxes(action.axis, items)) setAction(null);
              else throw new Error(t('changeNotSaved'));
            }}
          />
        ))}
    </section>
  );
}
