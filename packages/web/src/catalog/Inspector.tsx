import { richPreviewFormat } from '@cura/shared';
import { PreviewStatus } from '../media/PreviewStatus';
import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import type { Asset, Folder, Tag, UpdateAsset } from '@cura/shared';
import { assetUrl } from './api';
import { formatBytes } from './format';

export function Inspector({
  asset,
  tags,
  folders,
  onSave,
  onPreview,
  onSimilar,
  onColor,
}: {
  asset?: Asset | undefined;
  tags: Tag[];
  folders: Folder[];
  onSave: (patch: UpdateAsset) => Promise<void>;
  onPreview: () => void;
  onSimilar: () => void;
  onColor: (color: string) => void;
}) {
  const { t } = useTranslation();
  return (
    <aside className="inspector" aria-label={t('assetDetails')}>
      <div className="inspector-heading">
        <h2>{t('assetDetails')}</h2>
        <span aria-hidden="true">◈</span>
      </div>
      {asset ? (
        <InspectorForm
          key={`${asset.id}:${asset.currentVersionId}`}
          asset={asset}
          tags={tags}
          folders={folders}
          onSave={onSave}
          onPreview={onPreview}
          onSimilar={onSimilar}
          onColor={onColor}
        />
      ) : (
        <div className="inspector-empty">
          <span className="empty-icon">◈</span>
          <h3>{t('nothingSelected')}</h3>
          <p>{t('nothingSelectedHint')}</p>
        </div>
      )}
    </aside>
  );
}
function InspectorForm({
  asset,
  tags,
  folders,
  onSave,
  onPreview,
  onSimilar,
  onColor,
}: {
  asset: Asset;
  tags: Tag[];
  folders: Folder[];
  onSave: (patch: UpdateAsset) => Promise<void>;
  onPreview: () => void;
  onSimilar: () => void;
  onColor: (color: string) => void;
}) {
  const { t, i18n } = useTranslation();
  const [draft, setDraft] = useState<UpdateAsset>({});
  const currentTags = draft.tagIds ?? asset.tags.map((tag) => tag.id);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const change = (patch: UpdateAsset) => {
    setDraft((current) => ({ ...current, ...patch }));
    setSaved(false);
  };
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setSaving(true);
    try {
      await onSave(draft);
      setDraft({});
      setSaved(true);
    } catch {
      setSaved(false);
    } finally {
      setSaving(false);
    }
  };
  return (
    <form
      className="inspector-content"
      onSubmit={(event) => {
        void submit(event);
      }}
    >
      <button
        className="inspector-preview"
        type="button"
        onClick={onPreview}
        aria-label={t('preview')}
      >
        <img
          src={assetUrl(
            asset.currentVersionId,
            'thumbnail',
            asset.previewRevision,
          )}
          alt={asset.name}
        />
        {richPreviewFormat(asset.name, asset.type) && (
          <PreviewStatus
            state={asset.previewState}
            error={asset.previewError}
          />
        )}
        <span>⤢</span>
      </button>
      <h3 className="asset-title">{asset.name}</h3>
      <p className="asset-path">{asset.relativePath}</p>
      {'missing' in asset && asset.missing === true && (
        <p className="source-warning" role="status">
          {t('originalUnavailable')}
        </p>
      )}
      <div className="rating-stars" role="group" aria-label={t('rating')}>
        {[1, 2, 3, 4, 5].map((rating) => (
          <button
            key={rating}
            type="button"
            aria-label={t('stars', { count: rating })}
            aria-pressed={(draft.rating ?? asset.rating) >= rating}
            onClick={() =>
              change({
                rating: (draft.rating ?? asset.rating) === rating ? 0 : rating,
              })
            }
          >
            {(draft.rating ?? asset.rating) >= rating ? '★' : '☆'}
          </button>
        ))}
      </div>
      <section className="inspector-section">
        <h4>{t('palette')}</h4>
        <div className="palette">
          {asset.colors.map((color) => (
            <button
              key={color}
              type="button"
              style={{ background: color }}
              title={color}
              aria-label={`${t('useColor')} ${color}`}
              onClick={() => onColor(color)}
            />
          ))}
          {asset.colors.length === 0 && (
            <span className="muted">{t('noPalette')}</span>
          )}
        </div>
      </section>
      <section className="inspector-section">
        <h4>{t('metadata')}</h4>
        {(['prompt', 'negativePrompt', 'model', 'source', 'seed'] as const).map(
          (key) => (
            <label key={key}>
              {t(key)}
              {key === 'prompt' || key === 'negativePrompt' ? (
                <textarea
                  rows={key === 'prompt' ? 4 : 2}
                  value={draft[key] ?? asset[key]}
                  onChange={(e) => change({ [key]: e.target.value })}
                />
              ) : (
                <input
                  value={draft[key] ?? asset[key]}
                  onChange={(e) => change({ [key]: e.target.value })}
                />
              )}
            </label>
          ),
        )}
      </section>
      <section className="inspector-section">
        <label>
          {t('folders')}
          <select
            value={
              (draft.folderId === undefined
                ? asset.folderId
                : draft.folderId) ?? ''
            }
            onChange={(e) => change({ folderId: e.target.value || null })}
          >
            <option value="">{t('noFolder')}</option>
            {folders.map((folder) => (
              <option key={folder.id} value={folder.id}>
                {folder.name}
              </option>
            ))}
          </select>
        </label>
        <h4>{t('tags')}</h4>
        <div className="tag-options">
          {tags.map((tag) => (
            <label key={tag.id}>
              <input
                type="checkbox"
                checked={currentTags.includes(tag.id)}
                onChange={(e) =>
                  change({
                    tagIds: e.target.checked
                      ? [...currentTags, tag.id]
                      : currentTags.filter((id) => id !== tag.id),
                  })
                }
              />
              <span className="tag-dot" style={{ background: tag.color }} />
              {tag.name}
            </label>
          ))}
        </div>
        <label className="checkbox-field">
          <input
            type="checkbox"
            checked={draft.finalized ?? asset.finalized}
            onChange={(e) => change({ finalized: e.target.checked })}
          />
          {t('finalized')}
        </label>
        <label>
          {t('notes')}
          <textarea
            rows={3}
            value={draft.note ?? asset.note}
            onChange={(e) => change({ note: e.target.value })}
          />
        </label>
      </section>
      <div className="inspector-save">
        <button className="button-primary" disabled={saving} type="submit">
          {t(saving ? 'saving' : 'saveChanges')}
        </button>
        {saved && <span role="status">{t('saved')}</span>}
      </div>
      <section className="inspector-section">
        <h4>{t('fileInfo')}</h4>
        <dl className="file-info">
          <dt>{t('dimensions')}</dt>
          <dd>
            {asset.width ?? '—'} × {asset.height ?? '—'}
          </dd>
          <dt>{t('fileSize')}</dt>
          <dd>{formatBytes(asset.size)}</dd>
          <dt>{t('fileType')}</dt>
          <dd>{asset.type}</dd>
          <dt>{t('created')}</dt>
          <dd>{new Date(asset.createdAt).toLocaleDateString(i18n.language)}</dd>
        </dl>
        <details>
          <summary>{t('exif')}</summary>
          <pre>{JSON.stringify(asset.exif, null, 2)}</pre>
        </details>
        <details>
          <summary>{t('parameters')}</summary>
          <pre>{JSON.stringify(asset.params, null, 2)}</pre>
        </details>
      </section>
      <div className="inspector-actions">
        <button type="button" onClick={onSimilar} disabled={!asset.phash}>
          {t('similar')}
        </button>
        {!asset.phash && (
          <p className="field-hint">{t('similarUnavailable')}</p>
        )}
        <a
          href={assetUrl(asset.currentVersionId, 'file')}
          download={asset.name}
        >
          {t('openOriginal')}
        </a>
      </div>
    </form>
  );
}
