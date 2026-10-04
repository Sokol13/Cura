import { useEffect, useState } from 'react';
import {
  SlotHistorySchema,
  type BoardSlot,
  type SlotRevision,
} from '@cura/shared';
import { useTranslation } from 'react-i18next';
import { assetUrl, request } from '../catalog/api';
import { OrganizationDialog } from '../catalog/OrganizationDialog';

export function SlotHistory({
  slot,
  onClose,
}: {
  slot: BoardSlot;
  onClose: () => void;
}) {
  const { t } = useTranslation('boards');
  const [history, setHistory] = useState<SlotRevision[] | null>(null);
  const [error, setError] = useState(false);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    void request(`/api/slots/${slot.id}/history`, { signal: controller.signal })
      .then((raw) =>
        setHistory(
          SlotHistorySchema.parse(raw).sort((a, b) => b.ordinal - a.ordinal),
        ),
      )
      .catch(() => {
        if (!controller.signal.aborted) setError(true);
      });
    return () => controller.abort();
  }, [slot.id, retry]);
  return (
    <OrganizationDialog
      title={t('slotHistory', { name: slot.label })}
      onClose={onClose}
      onSubmit={async () => onClose()}
      submitLabel={t('close')}
    >
      {error ? (
        <p role="alert">
          {t('loadError')}{' '}
          <button
            type="button"
            onClick={() => {
              setError(false);
              setRetry((value) => value + 1);
            }}
          >
            {t('retry')}
          </button>
        </p>
      ) : !history ? (
        <p role="status">{t('loading')}</p>
      ) : history.length === 0 ? (
        <p>{t('emptyHistory')}</p>
      ) : (
        <ol className="board-slot-history">
          {history.map((entry) => (
            <li key={entry.id}>
              <div>
                <strong>{t('slotVersion', { number: entry.ordinal })}</strong>
                <time dateTime={entry.createdAt}>
                  {new Date(entry.createdAt).toLocaleString()}
                </time>
              </div>
              {entry.pin ? (
                <a
                  href={assetUrl(entry.pin.versionId, 'file')}
                  download
                  aria-label={`${t('original')} · ${t('version', { number: entry.ordinal })}`}
                >
                  <img
                    src={assetUrl(entry.pin.versionId, 'thumbnail')}
                    alt={t('slotVersion', { number: entry.ordinal })}
                  />
                </a>
              ) : (
                <span className="board-muted">{t('cleared')}</span>
              )}
            </li>
          ))}
        </ol>
      )}
    </OrganizationDialog>
  );
}
