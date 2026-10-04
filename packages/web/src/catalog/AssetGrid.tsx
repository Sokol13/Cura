import { useEffect, useRef, useState } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { useTranslation } from 'react-i18next';
import type { Asset } from '@cura/shared';
import { assetUrl } from './api';
import { formatBytes } from './format';

export function AssetGrid({
  assets,
  layout,
  selected,
  onSelect,
  onPreview,
  onLoadMore,
  hasMore,
  loading,
}: {
  assets: Asset[];
  layout: 'grid' | 'list';
  selected: Set<string>;
  onSelect: (asset: Asset, additive: boolean, range: boolean) => void;
  onPreview: (asset: Asset) => void;
  onLoadMore: () => void;
  hasMore: boolean;
  loading: boolean;
}) {
  const { t } = useTranslation();
  const scrollRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(800);
  useEffect(() => {
    const node = scrollRef.current;
    if (!node) return;
    const measure = () => setWidth(node.clientWidth || 800);
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  const columns = layout === 'list' ? 1 : Math.max(1, Math.floor(width / 180));
  const rowHeight = layout === 'list' ? 64 : 222;
  // TanStack Virtual is deliberately not passed through the React compiler.
  // eslint-disable-next-line react-hooks/incompatible-library
  const virtualizer = useVirtualizer({
    count: Math.ceil(assets.length / columns),
    getScrollElement: () => scrollRef.current,
    estimateSize: () => rowHeight,
    overscan: 3,
    initialRect: { width: 800, height: 720 },
  });
  const rows = virtualizer.getVirtualItems();
  useEffect(() => {
    virtualizer.measure();
  }, [layout, columns, virtualizer]);
  return (
    <div
      ref={scrollRef}
      className={`asset-scroll ${layout}`}
      onScroll={(e) => {
        const node = e.currentTarget;
        if (
          hasMore &&
          !loading &&
          node.scrollHeight - node.scrollTop - node.clientHeight < 500
        )
          onLoadMore();
      }}
    >
      <div
        className="virtual-canvas"
        style={{ height: virtualizer.getTotalSize() }}
      >
        {rows.map((row) => (
          <div
            key={row.key}
            className="asset-row"
            style={{
              transform: `translateY(${row.start}px)`,
              height: row.size,
              gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`,
            }}
          >
            {assets
              .slice(row.index * columns, (row.index + 1) * columns)
              .map((asset) => (
                <button
                  key={asset.id}
                  className={`asset-card ${selected.has(asset.id) ? 'selected' : ''}`}
                  aria-label={t('selectAsset', { name: asset.name })}
                  aria-pressed={selected.has(asset.id)}
                  onClick={(e) =>
                    onSelect(asset, e.metaKey || e.ctrlKey, e.shiftKey)
                  }
                  onDoubleClick={() => onPreview(asset)}
                >
                  <span className="asset-image">
                    <img
                      src={assetUrl(asset.currentVersionId, 'thumbnail')}
                      alt=""
                      loading="lazy"
                      onError={(e) => {
                        e.currentTarget.style.display = 'none';
                      }}
                    />
                    <span className="file-fallback" aria-hidden="true">
                      ▧
                    </span>
                    {asset.finalized && <span className="final-badge">✓</span>}
                  </span>
                  <span className="asset-caption">
                    <strong title={asset.name}>{asset.name}</strong>
                    <span>
                      {asset.width && asset.height
                        ? `${asset.width} × ${asset.height}`
                        : asset.type}
                      <span className="asset-stars">
                        {'★'.repeat(asset.rating)}
                      </span>
                    </span>
                  </span>
                  {layout === 'list' && (
                    <>
                      <span className="list-source">{asset.source || '—'}</span>
                      <span className="list-tags">
                        {asset.tags.map((tag) => (
                          <span key={tag.id} style={{ color: tag.color }}>
                            {tag.name}
                          </span>
                        ))}
                      </span>
                      <span className="list-size">
                        {formatBytes(asset.size)}
                      </span>
                    </>
                  )}
                </button>
              ))}
          </div>
        ))}
      </div>
      {hasMore && (
        <button className="load-more" disabled={loading} onClick={onLoadMore}>
          {t(loading ? 'loading' : 'loadMore')}
        </button>
      )}
    </div>
  );
}
