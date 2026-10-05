import { useEffect, useState } from 'react';
import {
  SlotHistorySchema,
  richPreviewFormat,
  type BoardSlot,
  type SlotHistoryEntry,
} from '@cura/shared';
import { useTranslation } from 'react-i18next';
import { assetUrl, request } from '../catalog/api';
import { useSlotPresentation } from './template-presentation';
import { OrganizationDialog } from '../catalog/OrganizationDialog';

export function SlotHistory({
  slot,
  onClose,
}: {
  slot: BoardSlot;
  onClose: () => void;
}) {
  const { t } = useTranslation('boards');
  const presentSlot = useSlotPresentation();
  return (
    <OrganizationDialog
      title={t('slotHistory', { name: presentSlot(slot).label })}
      onClose={onClose}
      onSubmit={async () => onClose()}
      submitLabel={t('close')}
    >
      <div className="board-history-content">
        <HistoryContent
          key={`${slot.libraryId}:${slot.id}:${slot.revision}`}
          slot={slot}
        />
      </div>
    </OrganizationDialog>
  );
}

function HistoryContent({ slot }: { slot: BoardSlot }) {
  const { t } = useTranslation('boards');
  const [history, setHistory] = useState<SlotHistoryEntry[] | null>(null);
  const [error, setError] = useState(false);
  const [retry, setRetry] = useState(0);
  const [pair, setPair] = useState<{ left: string; right: string } | null>(
    null,
  );
  useEffect(() => {
    const controller = new AbortController();
    void request(`/api/slots/${slot.id}/history`, { signal: controller.signal })
      .then((raw) => {
        const entries = SlotHistorySchema.parse(raw).sort(
          (a, b) => b.ordinal - a.ordinal,
        );
        if (
          entries.some(
            (entry) =>
              entry.slotId !== slot.id || entry.libraryId !== slot.libraryId,
          )
        )
          throw new Error('Slot history identity mismatch');
        if (controller.signal.aborted) return;
        setHistory(entries);
        if (entries[0] && entries[1])
          setPair({ left: entries[1].id, right: entries[0].id });
      })
      .catch(() => {
        if (!controller.signal.aborted) setError(true);
      });
    return () => controller.abort();
  }, [slot.id, slot.libraryId, retry]);
  if (error)
    return (
      <p role="alert">
        {t('loadError')}{' '}
        <button
          type="button"
          onClick={() => {
            setError(false);
            setHistory(null);
            setPair(null);
            setRetry((value) => value + 1);
          }}
        >
          {t('retry')}
        </button>
      </p>
    );
  if (!history) return <p role="status">{t('loading')}</p>;
  if (!history.length) return <p>{t('emptyHistory')}</p>;
  return (
    <>
      {pair ? (
        <div className="board-slot-comparison">
          {(['left', 'right'] as const).map((side) => {
            const selected = history.find((entry) => entry.id === pair[side])!;
            const other = side === 'left' ? 'right' : 'left';
            return (
              <section
                key={side}
                className="board-history-pane"
                aria-label={t(`${side}Comparison`)}
              >
                <label className="board-history-select">
                  {t(`${side}SlotVersion`)}
                  <select
                    value={selected.id}
                    onChange={(event) => {
                      const id = event.target.value;
                      if (
                        id !== pair[other] &&
                        history.some((entry) => entry.id === id)
                      )
                        setPair({ ...pair, [side]: id });
                    }}
                  >
                    {history.map((entry) => (
                      <option
                        key={entry.id}
                        value={entry.id}
                        disabled={entry.id === pair[other]}
                      >
                        {t('version', { number: entry.ordinal })} ·{' '}
                        {entry.source?.name ??
                          t(entry.pin ? 'historySourceUnavailable' : 'cleared')}
                      </option>
                    ))}
                  </select>
                </label>
                <HistoryPreview key={selected.id} entry={selected} />
                <EntryDetails entry={selected} />
              </section>
            );
          })}
        </div>
      ) : (
        <p className="board-muted">{t('historyCompareHint')}</p>
      )}
      <ol className="board-slot-history" aria-label={t('history')}>
        {history.map((entry) => (
          <li key={entry.id}>
            <div className="board-history-summary">
              <strong>{t('slotVersion', { number: entry.ordinal })}</strong>
            </div>
            <EntryDetails entry={entry} />
            <HistoryPreview
              entry={entry}
              downloadLabel={`${t('original')} · ${t('version', { number: entry.ordinal })}`}
            />
          </li>
        ))}
      </ol>
    </>
  );
}

function EntryDetails({ entry }: { entry: SlotHistoryEntry }) {
  const { t, i18n } = useTranslation('boards');
  const actor = entry.actor;
  const actorName = !actor
    ? t('historyActorUnknown')
    : actor.kind === 'local'
      ? t('historyActorLocal')
      : actor.kind === 'system'
        ? t('historyActorSync')
        : actor.email || actor.id;
  return (
    <dl className="board-history-details">
      {entry.pin && (
        <>
          <dt>{t('historySource')}</dt>
          <dd title={entry.pin.assetId}>
            {entry.source?.name ?? t('historySourceUnavailable')}
            {entry.source && (
              <small>
                {t('historyAssetVersion', {
                  number: entry.source.versionOrdinal,
                })}
              </small>
            )}
          </dd>
        </>
      )}
      <dt>{t('historyActor')}</dt>
      <dd title={actor?.kind === 'account' ? actor.id : undefined}>
        {actorName}
      </dd>
      <dt>{t('historyChangedAt')}</dt>
      <dd>
        <time dateTime={entry.createdAt}>
          {new Date(entry.createdAt).toLocaleString(
            i18n.resolvedLanguage ?? i18n.language,
          )}
        </time>
      </dd>
    </dl>
  );
}

function HistoryPreview({
  entry,
  downloadLabel,
}: {
  entry: SlotHistoryEntry;
  downloadLabel?: string;
}) {
  const { t } = useTranslation('boards');
  const [failed, setFailed] = useState(false);
  const source = entry.source;
  const canPreview =
    source &&
    (source.type.startsWith('image/') ||
      richPreviewFormat(source.name, source.type));
  return (
    <div className="board-history-preview">
      <div className="board-history-image">
        {!entry.pin ? (
          <p>{t('cleared')}</p>
        ) : canPreview && !failed ? (
          <img
            src={assetUrl(entry.pin.versionId, 'thumbnail')}
            alt={`${source.name} · ${t('historyAssetVersion', { number: source.versionOrdinal })}`}
            onError={() => setFailed(true)}
          />
        ) : (
          <p>{t('historyPreviewUnavailable')}</p>
        )}
      </div>
      {entry.pin && (
        <a
          href={assetUrl(entry.pin.versionId, 'file')}
          download
          aria-label={downloadLabel ?? t('original')}
        >
          {t('original')}
        </a>
      )}
    </div>
  );
}
