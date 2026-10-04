import { useTranslation } from 'react-i18next';
import type { BatchAssets, Folder, Tag } from '@cura/shared';

export function BatchBar({
  count,
  folders,
  tags,
  trash,
  onBatch,
  onClear,
  onSelectAll,
  onExport,
}: {
  count: number;
  folders: Folder[];
  tags: Tag[];
  trash: boolean;
  onBatch: (patch: Omit<BatchAssets, 'assetIds'>) => void;
  onClear: () => void;
  onSelectAll: () => void;
  onExport: () => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="batch-bar">
      <strong>{t('selectedCount', { count })}</strong>
      <button
        className="icon-button"
        title={t('selectAll')}
        aria-label={t('selectAll')}
        onClick={onSelectAll}
      >
        ☑
      </button>
      <select
        aria-label={t('rating')}
        value=""
        onChange={(e) => onBatch({ patch: { rating: Number(e.target.value) } })}
      >
        <option value="" disabled>
          {t('rating')}
        </option>
        {[0, 1, 2, 3, 4, 5].map((n) => (
          <option key={n} value={n}>
            {t('stars', { count: n })}
          </option>
        ))}
      </select>
      <select
        aria-label={t('moveToFolder')}
        value=""
        onChange={(e) =>
          onBatch({ patch: { folderId: e.target.value || null } })
        }
      >
        <option value="" disabled>
          {t('moveToFolder')}
        </option>
        <option value="">{t('noFolder')}</option>
        {folders.map((folder) => (
          <option key={folder.id} value={folder.id}>
            {folder.name}
          </option>
        ))}
      </select>
      {(['addTagIds', 'removeTagIds'] as const).map((key) => (
        <select
          key={key}
          aria-label={t(key === 'addTagIds' ? 'addTag' : 'removeTag')}
          value=""
          onChange={(e) => onBatch({ [key]: [e.target.value] })}
        >
          <option value="" disabled>
            {t(key === 'addTagIds' ? 'addTag' : 'removeTag')}
          </option>
          {tags.map((tag) => (
            <option key={tag.id} value={tag.id}>
              {tag.name}
            </option>
          ))}
        </select>
      ))}
      <button onClick={onExport}>{t('exportSelection')}</button>
      <button
        className={trash ? '' : 'danger-text'}
        onClick={() => onBatch({ action: trash ? 'restore' : 'trash' })}
      >
        {t(trash ? 'restore' : 'moveToTrash')}
      </button>
      <button
        className="icon-button"
        aria-label={t('clearSelection')}
        onClick={onClear}
      >
        ×
      </button>
    </div>
  );
}
