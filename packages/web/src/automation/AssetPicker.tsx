import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  AssetPageSchema,
  AssetVersionsSchema,
  type Asset,
  type AssetVersion,
} from '@cura/shared';
import { assetUrl, request } from '../catalog/api';
import './i18n';
import { useAutomationPage } from './api';

export type AssetChoice = {
  assetId: string;
  versionId: string;
  name: string;
  ordinal?: number;
};
type Props = {
  libraryId: string;
  value: AssetChoice[];
  onChange: (value: AssetChoice[]) => void;
  history?: boolean;
  disabled?: boolean;
  maximum?: number;
};

export function AssetPicker({
  libraryId,
  value,
  onChange,
  history = false,
  disabled = false,
  maximum = 100,
}: Props) {
  const { t } = useTranslation('automation');
  const [query, setQuery] = useState('');
  const {
    data: result,
    loading,
    error,
    offset,
    setOffset,
    refresh,
  } = useAutomationPage(
    `/api/libraries/${encodeURIComponent(libraryId)}/assets?${new URLSearchParams({ q: query })}`,
    AssetPageSchema,
  );
  return (
    <section className="automation-picker" aria-label={t('chooseAssets')}>
      <div className="automation-inline">
        <input
          type="search"
          value={query}
          aria-label={t('searchAssets')}
          placeholder={t('searchAssets')}
          onChange={(event) => {
            setQuery(event.target.value);
            setOffset(0);
          }}
        />
        <span>{t('selectedCount', { count: value.length })}</span>
      </div>
      <div className="automation-selected">
        {value.map((choice) => (
          <button
            type="button"
            disabled={disabled}
            key={choice.assetId}
            aria-label={t('removeAsset', { name: choice.name })}
            onClick={() =>
              onChange(value.filter((item) => item.assetId !== choice.assetId))
            }
          >
            {choice.name}
            {choice.ordinal ? ` · V${choice.ordinal}` : ''} ×
          </button>
        ))}
      </div>
      {loading ? (
        <p role="status">{t('loading')}</p>
      ) : error ? (
        <p role="alert">
          {t('loadError')}{' '}
          <button type="button" onClick={refresh}>
            {t('retry')}
          </button>
        </p>
      ) : (
        <>
          <div className="automation-picker-grid">
            {result.items.map((asset) => (
              <PickerAsset
                key={asset.id}
                asset={asset}
                choice={value.find((item) => item.assetId === asset.id)}
                history={history}
                disabled={disabled}
                atLimit={value.length >= maximum}
                onChange={(choice) =>
                  onChange([
                    ...value.filter((item) => item.assetId !== asset.id),
                    ...(choice ? [choice] : []),
                  ])
                }
              />
            ))}
          </div>
          {result.items.length === 0 && (
            <p className="automation-muted">{t('noAssets')}</p>
          )}
        </>
      )}
      {value.length >= maximum && (
        <p>{t('maxSelection', { count: maximum })}</p>
      )}
      <div className="automation-pagination">
        <button
          type="button"
          disabled={loading || offset === 0}
          onClick={() => setOffset(Math.max(0, offset - 30))}
        >
          {t('previous')}
        </button>
        <span>
          {t('page', { number: offset / 30 + 1, total: result.total })}
        </span>
        <button
          type="button"
          disabled={loading || offset + 30 >= result.total}
          onClick={() => setOffset(offset + 30)}
        >
          {t('next')}
        </button>
      </div>
    </section>
  );
}

function PickerAsset({
  asset,
  choice,
  history,
  disabled,
  atLimit,
  onChange,
}: {
  asset: Asset;
  choice: AssetChoice | undefined;
  history: boolean;
  disabled: boolean;
  atLimit: boolean;
  onChange: (choice: AssetChoice | null) => void;
}) {
  const { t } = useTranslation('automation');
  const [versions, setVersions] = useState<AssetVersion[]>([]);
  const [error, setError] = useState(false);
  const [retry, setRetry] = useState(0);
  const selected = Boolean(choice);
  useEffect(() => {
    if (!history || !selected) return;
    const abort = new AbortController();
    void request(`/api/assets/${encodeURIComponent(asset.id)}/versions`, {
      signal: abort.signal,
    })
      .then((raw) => {
        const values = AssetVersionsSchema.parse(raw);
        if (!abort.signal.aborted) {
          setVersions(values);
          setError(false);
        }
      })
      .catch(() => {
        if (!abort.signal.aborted) setError(true);
      });
    return () => abort.abort();
  }, [asset.id, history, selected, retry]);
  return (
    <article
      className={
        choice
          ? 'automation-picker-asset is-selected'
          : 'automation-picker-asset'
      }
    >
      <label>
        <img
          src={assetUrl(
            choice?.versionId ?? asset.currentVersionId,
            'thumbnail',
          )}
          loading="lazy"
          alt=""
        />
        <span>
          <input
            type="checkbox"
            checked={selected}
            disabled={disabled || (!selected && atLimit)}
            aria-label={t('selectAsset', {
              name: asset.displayName ?? asset.name,
            })}
            onChange={(event) =>
              onChange(
                event.target.checked
                  ? {
                      assetId: asset.id,
                      versionId: asset.currentVersionId,
                      name: asset.displayName ?? asset.name,
                    }
                  : null,
              )
            }
          />
          {asset.displayName ?? asset.name}
        </span>
      </label>
      {history &&
        choice &&
        (error ? (
          <button type="button" onClick={() => setRetry((count) => count + 1)}>
            {t('retry')}
          </button>
        ) : versions.length ? (
          <select
            disabled={disabled}
            aria-label={t('assetVersion', {
              name: asset.displayName ?? asset.name,
            })}
            value={choice.versionId}
            onChange={(event) => {
              const version = versions.find(
                (item) => item.id === event.target.value,
              );
              if (version)
                onChange({
                  ...choice,
                  versionId: version.id,
                  ordinal: version.ordinal,
                });
            }}
          >
            {versions.map((version) => (
              <option key={version.id} value={version.id}>
                {t('version', { number: version.ordinal })}
                {version.id === asset.currentVersionId
                  ? ` · ${t('current')}`
                  : ''}
              </option>
            ))}
          </select>
        ) : (
          <small role="status">{t('loading')}</small>
        ))}
    </article>
  );
}
