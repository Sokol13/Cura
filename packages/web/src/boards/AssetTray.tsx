import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  AssetPageSchema,
  AssetVersionsSchema,
  type Asset,
  type AssetVersion,
  type BoardPin,
} from '@cura/shared';
import { assetUrl, request } from '../catalog/api';
import './i18n';

export function AssetTray({
  libraryId,
  onPick,
  disabled = false,
}: {
  libraryId: string;
  onPick: (pin: BoardPin) => void;
  disabled?: boolean;
}) {
  const { t } = useTranslation('boards');
  const [query, setQuery] = useState('');
  const [page, setPage] = useState<{ items: Asset[]; total: number }>({
    items: [],
    total: 0,
  });
  const [offset, setOffset] = useState(0);
  const [retry, setRetry] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  useEffect(() => {
    const abort = new AbortController();
    const timer = setTimeout(() => {
      setLoading(true);
      setError(false);
      const params = new URLSearchParams({
        limit: '50',
        offset: String(offset),
        q: query,
      });
      void request(`/api/libraries/${libraryId}/assets?${params}`, {
        signal: abort.signal,
      })
        .then((raw) => {
          const result = AssetPageSchema.parse(raw);
          if (!abort.signal.aborted)
            setPage((previous) => ({
              ...result,
              items:
                offset === 0
                  ? result.items
                  : [...previous.items, ...result.items],
            }));
        })
        .catch(() => {
          if (!abort.signal.aborted) setError(true);
        })
        .finally(() => {
          if (!abort.signal.aborted) setLoading(false);
        });
    }, 60);
    return () => {
      clearTimeout(timer);
      abort.abort();
    };
  }, [libraryId, query, offset, retry]);
  return (
    <aside className="board-asset-tray" aria-label={t('trayTitle')}>
      <div className="board-section-label">{t('trayTitle')}</div>
      <input
        type="search"
        aria-label={t('searchAssets')}
        placeholder={t('searchAssets')}
        value={query}
        onChange={(event) => {
          setQuery(event.target.value);
          setOffset(0);
        }}
      />
      <div className="board-tray-scroll" aria-busy={loading}>
        {page.items.map((asset) => (
          <TrayAsset
            key={asset.id}
            asset={asset}
            onPick={onPick}
            disabled={disabled}
          />
        ))}
        {loading && <p role="status">{t('loading')}</p>}
        {error && (
          <div role="alert">
            {t('loadError')}
            <button onClick={() => setRetry((value) => value + 1)}>
              {t('retry')}
            </button>
          </div>
        )}
        {!loading && !error && page.items.length === 0 && (
          <p className="board-muted">{t('noAssets')}</p>
        )}
        {page.items.length < page.total && !error && (
          <button
            disabled={loading}
            onClick={() => setOffset(page.items.length)}
          >
            {t('loadMore')}
          </button>
        )}
      </div>
    </aside>
  );
}

function TrayAsset({
  asset,
  onPick,
  disabled,
}: {
  asset: Asset;
  onPick: (pin: BoardPin) => void;
  disabled: boolean;
}) {
  const { t } = useTranslation('boards');
  const [versions, setVersions] = useState<AssetVersion[] | null>(null);
  const [versionId, setVersionId] = useState(asset.currentVersionId);
  const [error, setError] = useState(false);
  const pin = { assetId: asset.id, versionId };
  const loadVersions = async () => {
    setError(false);
    try {
      setVersions(
        AssetVersionsSchema.parse(
          await request(`/api/assets/${asset.id}/versions`),
        ),
      );
    } catch {
      setError(true);
    }
  };
  return (
    <article className="board-tray-asset">
      <button
        className="board-tray-image"
        aria-label={t('dragAsset', { name: asset.name })}
        draggable={!disabled}
        disabled={disabled}
        onDragStart={(event) => {
          event.dataTransfer.setData(
            'application/x-cura-asset-pin',
            JSON.stringify(pin),
          );
          event.dataTransfer.effectAllowed = 'copy';
        }}
        onClick={() => onPick(pin)}
      >
        <img
          draggable={false}
          src={assetUrl(versionId, 'thumbnail')}
          alt=""
          loading="lazy"
        />
      </button>
      <strong title={asset.name}>{asset.name}</strong>
      <div className="board-inline-actions">
        <button
          disabled={disabled}
          aria-label={t('addAsset', { name: asset.name })}
          onClick={() => onPick(pin)}
        >
          ＋
        </button>
        <button
          aria-label={t('versionHistory', { name: asset.name })}
          onClick={() => void loadVersions()}
        >
          {t('pinned')} ▾
        </button>
      </div>
      {versions && (
        <select
          aria-label={t('assetVersion', { name: asset.name })}
          value={versionId}
          onChange={(event) => setVersionId(event.target.value)}
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
      )}
      {error && (
        <p role="alert">
          {t('loadError')}{' '}
          <button onClick={() => void loadVersions()}>{t('retry')}</button>
        </p>
      )}
    </article>
  );
}
