import { useTranslation } from 'react-i18next';
import type { Filters as FilterValues } from './types';

export function FilterPanel({
  filters,
  onChange,
  onClear,
}: {
  filters: FilterValues;
  onChange: (patch: FilterValues) => void;
  onClear: () => void;
}) {
  const { t } = useTranslation();
  return (
    <section className="filter-panel" aria-label={t('filters')}>
      <label>
        {t('format')}
        <select
          value={filters.type ?? ''}
          onChange={(e) => onChange({ type: e.target.value || undefined })}
        >
          <option value="">{t('anyFormat')}</option>
          {['png', 'jpeg', 'webp', 'gif', 'svg+xml', 'avif'].map((format) => (
            <option key={format} value={`image/${format}`}>
              {format.replace('+xml', '').toUpperCase()}
            </option>
          ))}
        </select>
      </label>
      <label>
        {t('rating')}
        <select
          value={filters.rating ?? ''}
          onChange={(e) =>
            onChange({
              rating:
                e.target.value === '' ? undefined : Number(e.target.value),
            })
          }
        >
          <option value="">{t('anyRating')}</option>
          {[0, 1, 2, 3, 4, 5].map((rating) => (
            <option key={rating} value={rating}>
              {t('stars', { count: rating })}
            </option>
          ))}
        </select>
      </label>
      <label>
        {t('source')}
        <input
          value={filters.source ?? ''}
          placeholder={t('sourcePlaceholder')}
          onChange={(e) => onChange({ source: e.target.value || undefined })}
        />
      </label>
      <label className="color-filter">
        {t('color')}
        <span>
          <input
            aria-label={t('color')}
            type="color"
            value={filters.color ?? '#f49245'}
            onChange={(e) => onChange({ color: e.target.value })}
          />
          <input
            aria-label={t('useColor')}
            type="checkbox"
            checked={Boolean(filters.color)}
            onChange={(e) =>
              onChange({ color: e.target.checked ? '#f49245' : undefined })
            }
          />
        </span>
      </label>
      {(['after', 'before'] as const).map((key) => (
        <label key={key}>
          {t(key)}
          <input
            type="date"
            value={filters[key]?.slice(0, 10) ?? ''}
            onChange={(e) =>
              onChange({
                [key]: e.target.value
                  ? `${e.target.value}T${key === 'before' ? '23:59:59.999' : '00:00:00.000'}Z`
                  : undefined,
              })
            }
          />
        </label>
      ))}
      {(['minWidth', 'minHeight'] as const).map((key) => (
        <label key={key}>
          {t(key)}
          <input
            type="number"
            min="0"
            value={filters[key] ?? ''}
            onChange={(e) =>
              onChange({
                [key]: e.target.value ? Number(e.target.value) : undefined,
              })
            }
          />
        </label>
      ))}
      <label className="checkbox-field">
        <input
          type="checkbox"
          checked={filters.missing ?? false}
          onChange={(event) =>
            onChange({ missing: event.target.checked ? true : undefined })
          }
        />
        {t('sourceUnavailable')}
      </label>
      <button onClick={onClear}>{t('clearFilters')}</button>
    </section>
  );
}
