import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  AssetPageSchema,
  AssetSchema,
  AssetVersionsSchema,
  type Asset,
  type AssetVersion,
  type BrandPin,
} from '@cura/shared';
import { request, assetUrl } from '../catalog/api';

export function PinPicker({
  libraryId,
  onChoose,
  onClose,
}: {
  libraryId: string;
  onChoose: (pin: BrandPin, name: string) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation('brands');
  const [query, setQuery] = useState(''),
    [assets, setAssets] = useState<Asset[]>([]),
    [assetId, setAssetId] = useState(''),
    [versions, setVersions] = useState<AssetVersion[]>([]),
    [versionId, setVersionId] = useState(''),
    [error, setError] = useState(''),
    [loading, setLoading] = useState(false);
  useEffect(() => {
    let active = true;
    setLoading(true);
    void request(
      `/api/libraries/${libraryId}/assets?q=${encodeURIComponent(query)}&limit=100`,
    )
      .then((value) => {
        if (active) setAssets(AssetPageSchema.parse(value).items);
      })
      .catch((error) => {
        if (active)
          setError(
            error instanceof Error && error.message === t('failed')
              ? error.message
              : t('failed'),
          );
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [libraryId, query, t]);
  useEffect(() => {
    let active = true;
    setVersions([]);
    setVersionId('');
    if (assetId)
      void request(`/api/assets/${assetId}/versions`)
        .then((value) => {
          if (active) {
            const list = AssetVersionsSchema.parse(value);
            setVersions(list);
            setVersionId(list[0]?.id ?? '');
          }
        })
        .catch((error) => {
          if (active)
            setError(
              error instanceof Error && error.message === t('failed')
                ? error.message
                : t('failed'),
            );
        });
    return () => {
      active = false;
    };
  }, [assetId, t]);
  async function upload(file: File) {
    setLoading(true);
    setError('');
    try {
      const response = await fetch(
        `/api/libraries/${libraryId}/upload?name=${encodeURIComponent(file.name)}`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/octet-stream' },
          body: file,
        },
      );
      if (!response.ok) throw new Error(t('failed'));
      const asset = AssetSchema.parse(await response.json());
      setAssets((old) => [
        asset,
        ...old.filter((item) => item.id !== asset.id),
      ]);
      setAssetId(asset.id);
    } catch (error) {
      setError(
        error instanceof Error && error.message === t('failed')
          ? error.message
          : t('failed'),
      );
    } finally {
      setLoading(false);
    }
  }
  return (
    <div className="brand-dialog-backdrop">
      <section
        className="brand-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={t('choose')}
      >
        <h2>{t('choose')}</h2>
        <label>
          {t('search')}
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>
        <label>
          {t('import')}
          <input
            type="file"
            disabled={loading}
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void upload(file);
              event.target.value = '';
            }}
          />
        </label>
        {error && <p role="alert">{error}</p>}
        {loading && <p role="status">{t('loading')}</p>}
        <label>
          {t('asset')}
          <select
            value={assetId}
            onChange={(event) => setAssetId(event.target.value)}
          >
            <option value="">—</option>
            {assets.map((asset) => (
              <option key={asset.id} value={asset.id}>
                {asset.name}
              </option>
            ))}
          </select>
        </label>
        {!assets.length && !loading && <p>{t('noAssets')}</p>}
        <label>
          {t('version')}
          <select
            value={versionId}
            onChange={(event) => setVersionId(event.target.value)}
          >
            <option value="">—</option>
            {versions.map((version) => (
              <option key={version.id} value={version.id}>
                V{version.ordinal} · {version.name}
              </option>
            ))}
          </select>
        </label>
        {versionId && (
          <img
            className="brand-picker-preview"
            src={assetUrl(versionId, 'thumbnail')}
            alt=""
          />
        )}
        <p>{t('pinHint')}</p>
        <footer>
          <button onClick={onClose}>{t('cancel')}</button>
          <button
            className="button-primary"
            disabled={!assetId || !versionId || loading}
            onClick={() =>
              onChoose(
                { assetId, versionId },
                assets.find((asset) => asset.id === assetId)?.name ?? '',
              )
            }
          >
            {t('use')}
          </button>
        </footer>
      </section>
    </div>
  );
}
