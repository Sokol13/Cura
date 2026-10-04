import { useTranslation } from 'react-i18next';
import './i18n';

export function PageControls({
  total,
  offset,
  onOffset,
  disabled = false,
  limit = 30,
}: {
  total: number;
  offset: number;
  onOffset: (offset: number) => void;
  disabled?: boolean;
  limit?: number;
}) {
  const { t } = useTranslation('automation');
  return (
    <div className="automation-pagination">
      <button
        type="button"
        disabled={disabled || offset === 0}
        onClick={() => onOffset(Math.max(0, offset - limit))}
      >
        {t('previous')}
      </button>
      <span>
        {t('page', { number: Math.floor(offset / limit) + 1, total })}
      </span>
      <button
        type="button"
        disabled={disabled || offset + limit >= total}
        onClick={() => onOffset(offset + limit)}
      >
        {t('next')}
      </button>
    </div>
  );
}
export function OperationError({
  error,
  onRetry,
}: {
  error: string | boolean;
  onRetry?: (() => void) | undefined;
}) {
  const { t } = useTranslation('automation');
  return error ? (
    <div role="alert" className="automation-error">
      {t(typeof error === 'string' ? error : 'loadError')}
      {onRetry && (
        <button type="button" onClick={onRetry}>
          {t(error === 'conflict' ? 'reload' : 'retry')}
        </button>
      )}
    </div>
  ) : null;
}
