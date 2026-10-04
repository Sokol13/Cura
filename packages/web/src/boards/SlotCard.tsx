import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { BoardPinSchema, type BoardPin, type BoardSlot } from '@cura/shared';
import { assetUrl } from '../catalog/api';
import './i18n';

export function SlotCard({
  slot,
  selected,
  busy,
  onChoose,
  onAssign,
  onHistory,
}: {
  slot: BoardSlot;
  selected: boolean;
  busy: boolean;
  onChoose: (slot: BoardSlot) => void;
  onAssign: (slot: BoardSlot, pin: BoardPin) => void;
  onHistory: (slot: BoardSlot) => void;
}) {
  const { t } = useTranslation('boards');
  const [over, setOver] = useState(false);
  const [error, setError] = useState(false);
  return (
    <section
      className={`board-slot ${selected ? 'is-selected' : ''} ${over ? 'is-over' : ''}`}
      role="region"
      aria-label={t('dropToSlot', { name: slot.label })}
      data-slot-id={slot.id}
      onDragOver={(event) => {
        event.preventDefault();
        event.stopPropagation();
        event.dataTransfer.dropEffect = 'copy';
        if (!busy) setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(event) => {
        event.preventDefault();
        event.stopPropagation();
        setOver(false);
        if (busy) return;
        try {
          const pin = BoardPinSchema.parse(
            JSON.parse(
              event.dataTransfer.getData('application/x-cura-asset-pin'),
            ),
          );
          setError(false);
          onAssign(slot, pin);
        } catch {
          setError(true);
        }
      }}
    >
      <header className="board-slot-heading">
        <strong>{slot.label}</strong>
        <span className="board-version-badge">
          {t('version', { number: slot.revision })}
        </span>
      </header>
      <button
        className="board-slot-content nodrag nopan"
        disabled={busy}
        aria-label={t('chooseForSlot', { name: slot.label })}
        aria-pressed={selected}
        onClick={() => onChoose(slot)}
      >
        {slot.currentPin ? (
          <img
            src={assetUrl(slot.currentPin.versionId, 'thumbnail')}
            alt=""
            draggable={false}
          />
        ) : (
          <span>
            <b>＋</b>
            {t('dropAsset')}
          </span>
        )}
      </button>
      <footer>
        <span className="board-muted">
          {slot.currentPin ? `● ${t('finalized')}` : t('slot')}
        </span>
        <button
          className="nodrag nopan"
          aria-label={t('slotHistory', { name: slot.label })}
          onClick={() => onHistory(slot)}
        >
          {t('history')}
        </button>
      </footer>
      {error && (
        <p className="board-drop-error" role="alert">
          {t('unsupportedDrop')}
        </p>
      )}
    </section>
  );
}
