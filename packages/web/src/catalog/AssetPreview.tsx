import {
  ErrorResponseSchema,
  type Annotation,
  type Asset,
  type AssetVersion,
} from '@cura/shared';
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEvent,
} from 'react';
import { useTranslation } from 'react-i18next';

import { i18n } from '../i18n';
import { assetUrl, request } from './api';
import './preview.css';

const translations = {
  en: {
    title: 'Asset preview',
    close: 'Close preview',
    previousAsset: 'Previous asset',
    nextAsset: 'Next asset',
    edit: 'Edit annotation {{number}}',
    current: 'Current',
    versions: 'Version history',
    viewVersion: 'View V{{version}}: {{name}}',
    compare: 'Compare versions',
    single: 'Single preview',
    leftVersion: 'Left version',
    rightVersion: 'Right version',
    zoom: 'Zoom',
    zoomIn: 'Zoom in',
    zoomOut: 'Zoom out',
    fit: 'Fit image',
    download: 'Download original',
    replace: 'Replace file',
    replacing: 'Replacing…',
    replaceHint: 'Replacing preserves every previous version.',
    annotations: 'Annotations',
    add: 'Add annotation',
    place: 'Click the image to place a note.',
    center: 'Place at center',
    text: 'Annotation text',
    save: 'Save annotation',
    cancel: 'Cancel',
    emptyNotes: 'No annotations on this version.',
    delete: 'Delete annotation {{number}}',
    marker: 'Annotation {{number}}: {{text}}',
    loading: 'Loading versions…',
    retry: 'Retry',
    unavailable: 'Preview is not available for this file type.',
    imageError:
      'This image could not be loaded. You can still download the original.',
    requestError: 'Something went wrong. Please try again.',
    uploadError: 'The replacement could not be uploaded.',
    tooLarge: 'Choose a file smaller than 100 MiB.',
    emptyVersions: 'No versions are available.',
    saved: 'Annotation saved.',
    removed: 'Annotation deleted.',
    replaced: 'New version saved.',
    noteAt: 'Position: {{x}}%, {{y}}%',
    saving: 'Saving…',
    svg: 'Rasterized SVG preview',
  },
  'zh-CN': {
    title: '资产预览',
    close: '关闭预览',
    previousAsset: '上一个资产',
    nextAsset: '下一个资产',
    edit: '编辑标注 {{number}}',
    current: '当前版本',
    versions: '版本历史',
    viewVersion: '查看 V{{version}}：{{name}}',
    compare: '对比版本',
    single: '单图预览',
    leftVersion: '左侧版本',
    rightVersion: '右侧版本',
    zoom: '缩放',
    zoomIn: '放大',
    zoomOut: '缩小',
    fit: '适应窗口',
    download: '下载原文件',
    replace: '替换文件',
    replacing: '正在替换…',
    replaceHint: '替换文件会保留所有历史版本。',
    annotations: '图上标注',
    add: '添加标注',
    place: '点击图片选择标注位置。',
    center: '放置于中心',
    text: '标注内容',
    save: '保存标注',
    cancel: '取消',
    emptyNotes: '此版本还没有标注。',
    delete: '删除标注 {{number}}',
    marker: '标注 {{number}}：{{text}}',
    loading: '正在加载版本…',
    retry: '重试',
    unavailable: '此文件类型暂不支持预览。',
    imageError: '图片加载失败，你仍然可以下载原文件。',
    requestError: '操作失败，请重试。',
    uploadError: '替换文件上传失败。',
    tooLarge: '请选择小于 100 MiB 的文件。',
    emptyVersions: '暂无可用版本。',
    saved: '标注已保存。',
    removed: '标注已删除。',
    replaced: '新版本已保存。',
    noteAt: '位置：{{x}}%，{{y}}%',
    saving: '正在保存…',
    svg: 'SVG 栅格预览',
  },
};
for (const [language, resources] of Object.entries(translations)) {
  i18n.addResourceBundle(language, 'preview', resources, true, true);
}

const imageTypes = new Set([
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif',
  'image/avif',
  'image/svg+xml',
]);
type Point = { x: number; y: number };

function ImageCanvas({
  version,
  zoom,
  notes = [],
  placing = false,
  draft,
  onPoint,
  onFitZoom,
  onMarker,
}: {
  version: AssetVersion;
  zoom: number | null;
  notes?: Annotation[];
  placing?: boolean;
  draft?: Point | null;
  onPoint?: (point: Point) => void;
  onFitZoom?: (zoom: number) => void;
  onMarker?: (id: string) => void;
}) {
  const { t } = useTranslation('preview');
  const viewport = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 900, height: 620 });
  const [failed, setFailed] = useState(false);
  const width = version.width ?? 800;
  const height = version.height ?? 600;
  const fitScale = Math.min(
    1,
    Math.max(1, size.width - 48) / width,
    Math.max(1, size.height - 48) / height,
  );
  const scale = zoom === null ? fitScale : zoom / 100;

  useEffect(() => {
    const element = viewport.current;
    if (!element || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry)
        setSize({
          width: entry.contentRect.width,
          height: entry.contentRect.height,
        });
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    onFitZoom?.(Math.round(fitScale * 100));
  }, [fitScale, onFitZoom]);

  function place(event: MouseEvent<HTMLImageElement>) {
    if (!placing || !onPoint) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    if (!bounds.width || !bounds.height) return;
    onPoint({
      x: Math.max(0, Math.min(1, (event.clientX - bounds.left) / bounds.width)),
      y: Math.max(0, Math.min(1, (event.clientY - bounds.top) / bounds.height)),
    });
  }

  return (
    <div className="preview-viewport" ref={viewport}>
      {!imageTypes.has(version.type) || failed ? (
        <div className="preview-unavailable">
          <span aria-hidden="true" className="preview-file-icon">
            ▧
          </span>
          <p>{t(failed ? 'imageError' : 'unavailable')}</p>
          <span>{version.name}</span>
        </div>
      ) : (
        <div
          className={`preview-image-wrap${placing ? ' is-placing' : ''}`}
          style={{ width: width * scale, height: height * scale }}
        >
          <img
            src={assetUrl(
              version.id,
              version.type === 'image/svg+xml' ? 'thumbnail' : 'file',
            )}
            alt={`${version.name} — V${version.ordinal}`}
            draggable={false}
            onError={() => setFailed(true)}
            onClick={place}
          />
          {notes.map((note, index) => (
            <button
              type="button"
              className="preview-marker"
              key={note.id}
              style={{ left: `${note.x * 100}%`, top: `${note.y * 100}%` }}
              aria-label={t('marker', { number: index + 1, text: note.text })}
              onClick={() => onMarker?.(note.id)}
            >
              {index + 1}
            </button>
          ))}
          {draft && (
            <span
              className="preview-marker is-draft"
              aria-hidden="true"
              style={{ left: `${draft.x * 100}%`, top: `${draft.y * 100}%` }}
            >
              +
            </span>
          )}
        </div>
      )}
    </div>
  );
}

type AssetPreviewProps = {
  asset: Asset;
  onClose: () => void;
  onChanged: () => void;
  onNavigate?: (direction: -1 | 1) => void;
  hasPrevious?: boolean;
  hasNext?: boolean;
};

function AssetPreviewDialog({
  asset,
  onClose,
  onChanged,
  onNavigate,
  hasPrevious = false,
  hasNext = false,
}: AssetPreviewProps) {
  const { t, i18n: language } = useTranslation('preview');
  const dialog = useRef<HTMLElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const textInput = useRef<HTMLTextAreaElement>(null);
  const addNoteButton = useRef<HTMLButtonElement>(null);
  const previousCurrentId = useRef(asset.currentVersionId);
  const selectedVersionId = useRef(asset.currentVersionId);
  const [versions, setVersions] = useState<AssetVersion[]>([]);
  const [annotations, setAnnotations] = useState<Annotation[]>([]);
  const [selectedId, setSelectedId] = useState(asset.currentVersionId);
  const [currentId, setCurrentId] = useState(asset.currentVersionId);
  const [leftId, setLeftId] = useState('');
  const [rightId, setRightId] = useState('');
  const [compare, setCompare] = useState(false);
  const [zoom, setZoom] = useState<number | null>(null);
  const [fitZoom, setFitZoom] = useState(100);
  const [placing, setPlacing] = useState(false);
  const [draft, setDraft] = useState<Point | null>(null);
  const [text, setText] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');
  const [reload, setReload] = useState(0);
  const selected = versions.find((version) => version.id === selectedId);
  const left = versions.find((version) => version.id === leftId);
  const right = versions.find((version) => version.id === rightId);
  const notes = annotations.filter((note) => note.versionId === selectedId);
  const percentage = zoom ?? fitZoom;
  const endpoint = `/api/assets/${encodeURIComponent(asset.id)}`;

  const load = useCallback(
    async (signal?: AbortSignal) => {
      const options = signal ? { signal } : {};
      const [history, allNotes] = await Promise.all([
        request<AssetVersion[]>(`${endpoint}/versions`, options),
        request<Annotation[]>(`${endpoint}/annotations`, options),
      ]);
      if (signal?.aborted) return;
      setVersions([...history].sort((a, b) => b.ordinal - a.ordinal));
      setAnnotations(allNotes);
    },
    [endpoint],
  );

  useEffect(() => {
    const previous = document.activeElement;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    closeButton.current?.focus();
    return () => {
      document.body.style.overflow = previousOverflow;
      if (previous instanceof HTMLElement && previous.isConnected)
        previous.focus();
    };
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError('');
    const followsCurrent =
      selectedVersionId.current === previousCurrentId.current;
    if (followsCurrent) {
      selectedVersionId.current = asset.currentVersionId;
      setSelectedId(asset.currentVersionId);
    }
    setCurrentId(asset.currentVersionId);
    if (
      followsCurrent &&
      previousCurrentId.current !== asset.currentVersionId
    ) {
      setDraft(null);
      setEditingId(null);
      setText('');
      setPlacing(false);
      setCompare(false);
      setZoom(null);
      closeButton.current?.focus();
    }
    previousCurrentId.current = asset.currentVersionId;
    void load(controller.signal)
      .catch((cause: unknown) => {
        if (!controller.signal.aborted)
          setError(
            cause instanceof Error
              ? cause.message
              : i18n.t('preview:requestError'),
          );
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [asset.id, asset.currentVersionId, load, reload]);

  useEffect(() => {
    if (draft) textInput.current?.focus();
  }, [draft]);

  function keyDown(event: KeyboardEvent<HTMLElement>) {
    event.stopPropagation();
    if (event.key === 'Tab') {
      const controls = [
        ...(dialog.current?.querySelectorAll<HTMLElement>(
          'button:not(:disabled), a[href], input:not(:disabled):not([type="hidden"]), select:not(:disabled), textarea:not(:disabled), [tabindex="0"]',
        ) ?? []),
      ].filter(
        (element) =>
          !element.hidden && element.getAttribute('aria-hidden') !== 'true',
      );
      const first = controls[0];
      const last = controls.at(-1);
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
      return;
    }
    if (
      event.target instanceof HTMLElement &&
      event.target.closest('input, textarea, select, [contenteditable="true"]')
    )
      return;
    if (event.key === 'ArrowLeft' && hasPrevious && onNavigate) {
      event.preventDefault();
      onNavigate(-1);
    } else if (event.key === 'ArrowRight' && hasNext && onNavigate) {
      event.preventDefault();
      onNavigate(1);
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      onClose();
    }
  }

  function selectVersion(id: string) {
    selectedVersionId.current = id;
    setSelectedId(id);
    setCompare(false);
    setZoom(null);
    setPlacing(false);
    setDraft(null);
    setEditingId(null);
    setText('');
  }

  function toggleCompare() {
    if (!compare) {
      setRightId(selectedId);
      setLeftId(
        versions.find((version) => version.id !== selectedId)?.id ?? '',
      );
      setPlacing(false);
      setDraft(null);
      setEditingId(null);
    }
    setCompare(!compare);
  }

  async function saveNote() {
    if (!draft || !text.trim() || !selected) return;
    setBusy(true);
    setError('');
    try {
      const note = editingId
        ? await request<Annotation>(
            `/api/annotations/${encodeURIComponent(editingId)}`,
            {
              method: 'PATCH',
              body: { text: text.trim() },
            },
          )
        : await request<Annotation>(`${endpoint}/annotations`, {
            method: 'POST',
            body: { versionId: selected.id, ...draft, text: text.trim() },
          });
      setAnnotations((existing) =>
        editingId
          ? existing.map((item) => (item.id === note.id ? note : item))
          : [...existing, note],
      );
      setDraft(null);
      setEditingId(null);
      setText('');
      setPlacing(false);
      setStatus(t('saved'));
      addNoteButton.current?.focus();
      onChanged();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('requestError'));
    } finally {
      setBusy(false);
    }
  }

  async function deleteNote(id: string) {
    setBusy(true);
    setError('');
    try {
      await request(`/api/annotations/${encodeURIComponent(id)}`, {
        method: 'DELETE',
      });
      setAnnotations((existing) => existing.filter((note) => note.id !== id));
      if (editingId === id) {
        setEditingId(null);
        setDraft(null);
        setText('');
      }
      setStatus(t('removed'));
      addNoteButton.current?.focus();
      onChanged();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('requestError'));
    } finally {
      setBusy(false);
    }
  }

  async function replaceFile(file: File) {
    if (file.size > 100 * 1024 * 1024) {
      setError(t('tooLarge'));
      return;
    }
    setUploading(true);
    setError('');
    try {
      const response = await fetch(
        `${endpoint}/replace?name=${encodeURIComponent(file.name)}`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/octet-stream' },
          body: file,
        },
      );
      if (!response.ok) {
        const parsed = ErrorResponseSchema.safeParse(
          await response.json().catch(() => null),
        );
        throw new Error(parsed.success ? parsed.data.error : t('uploadError'));
      }
      const updated = await request<Asset>(endpoint);
      await load();
      setCurrentId(updated.currentVersionId);
      selectVersion(updated.currentVersionId);
      setStatus(t('replaced'));
      onChanged();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('uploadError'));
    } finally {
      setUploading(false);
    }
  }

  function versionSelector(side: 'left' | 'right') {
    const id = side === 'left' ? leftId : rightId;
    const other = side === 'left' ? rightId : leftId;
    return (
      <label className="preview-version-select">
        {t(side === 'left' ? 'leftVersion' : 'rightVersion')}
        <select
          value={id}
          onChange={(event) =>
            side === 'left'
              ? setLeftId(event.target.value)
              : setRightId(event.target.value)
          }
        >
          {versions.map((version) => (
            <option
              key={version.id}
              value={version.id}
              disabled={version.id === other}
            >
              V{version.ordinal} · {version.name}
            </option>
          ))}
        </select>
      </label>
    );
  }

  return (
    <div className="preview-overlay">
      <section
        className="preview-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={t('title')}
        ref={dialog}
        onKeyDown={keyDown}
      >
        <header className="preview-header">
          <div className="preview-heading">
            <span className="preview-eyebrow">{t('title')}</span>
            <h2>{asset.name}</h2>
          </div>
          <div className="preview-actions">
            {onNavigate && (
              <>
                <button
                  type="button"
                  aria-label={t('previousAsset')}
                  disabled={!hasPrevious}
                  onClick={() => onNavigate(-1)}
                >
                  ←
                </button>
                <button
                  type="button"
                  aria-label={t('nextAsset')}
                  disabled={!hasNext}
                  onClick={() => onNavigate(1)}
                >
                  →
                </button>
              </>
            )}
            <button
              type="button"
              ref={closeButton}
              className="preview-close"
              aria-label={t('close')}
              onClick={onClose}
            >
              ×
            </button>
          </div>
        </header>
        <div className="preview-toolbar">
          <div className="preview-zoom">
            <button
              type="button"
              aria-label={t('zoomOut')}
              disabled={!selected || percentage <= 10}
              onClick={() => setZoom(Math.max(10, percentage - 25))}
            >
              −
            </button>
            <input
              type="range"
              min="1"
              max="400"
              step="1"
              aria-label={t('zoom')}
              value={percentage}
              disabled={!selected}
              onChange={(event) => setZoom(Number(event.target.value))}
            />
            <button
              type="button"
              aria-label={t('zoomIn')}
              disabled={!selected || percentage >= 400}
              onClick={() => setZoom(Math.min(400, percentage + 25))}
            >
              +
            </button>
            <output>{percentage}%</output>
            <button type="button" onClick={() => setZoom(null)}>
              {t('fit')}
            </button>
          </div>
          <div className="preview-actions">
            <button
              type="button"
              aria-pressed={compare}
              disabled={versions.length < 2}
              onClick={toggleCompare}
            >
              {t(compare ? 'single' : 'compare')}
            </button>
            {selected && (
              <a href={assetUrl(selected.id, 'file')} download={selected.name}>
                {t('download')}
              </a>
            )}
            <button
              type="button"
              disabled={uploading}
              onClick={() => fileInput.current?.click()}
              title={t('replaceHint')}
            >
              {t(uploading ? 'replacing' : 'replace')}
            </button>
            <input
              type="file"
              ref={fileInput}
              aria-label={t('replace')}
              hidden
              onChange={(event) => {
                const file = event.currentTarget.files?.[0];
                event.currentTarget.value = '';
                if (file) void replaceFile(file);
              }}
            />
          </div>
        </div>
        {error && (
          <div className="preview-error" role="alert">
            <span>{error}</span>
            <button
              type="button"
              onClick={() => setReload((value) => value + 1)}
            >
              {t('retry')}
            </button>
          </div>
        )}
        <div className="preview-layout">
          <div className="preview-main">
            {loading ? (
              <div className="preview-empty" role="status">
                {t('loading')}
              </div>
            ) : compare ? (
              <div className="preview-comparison">
                <div className="preview-compare-pane">
                  {versionSelector('left')}
                  {left && (
                    <ImageCanvas key={left.id} version={left} zoom={zoom} />
                  )}
                </div>
                <div className="preview-compare-pane">
                  {versionSelector('right')}
                  {right && (
                    <ImageCanvas
                      key={right.id}
                      version={right}
                      zoom={zoom}
                      onFitZoom={setFitZoom}
                    />
                  )}
                </div>
              </div>
            ) : selected ? (
              <>
                <div className="preview-image-label">
                  <span>V{selected.ordinal}</span>
                  <span>{selected.name}</span>
                  {selected.type === 'image/svg+xml' && <span>{t('svg')}</span>}
                </div>
                <ImageCanvas
                  key={selected.id}
                  version={selected}
                  zoom={zoom}
                  notes={notes}
                  draft={editingId ? null : draft}
                  placing={placing}
                  onPoint={setDraft}
                  onFitZoom={setFitZoom}
                  onMarker={(id) =>
                    document.getElementById(`preview-note-${id}`)?.focus()
                  }
                />
              </>
            ) : (
              <div className="preview-empty">{t('emptyVersions')}</div>
            )}
          </div>
          <aside className="preview-sidebar">
            <section className="preview-history">
              <h3>
                {t('versions')} <span>{versions.length}</span>
              </h3>
              <ol>
                {versions.map((version) => (
                  <li key={version.id}>
                    <button
                      type="button"
                      className={version.id === selectedId ? 'is-selected' : ''}
                      aria-pressed={version.id === selectedId}
                      aria-label={t('viewVersion', {
                        version: version.ordinal,
                        name: version.name,
                      })}
                      onClick={() => selectVersion(version.id)}
                    >
                      <span className="preview-version-badge">
                        V{version.ordinal}
                      </span>
                      <span className="preview-version-details">
                        <strong>{version.name}</strong>
                        <time dateTime={version.createdAt}>
                          {new Date(version.createdAt).toLocaleString(
                            language.language,
                            { dateStyle: 'short', timeStyle: 'short' },
                          )}
                        </time>
                      </span>
                      {version.id === currentId && (
                        <span className="preview-current">{t('current')}</span>
                      )}
                    </button>
                  </li>
                ))}
              </ol>
              <p className="preview-hint">{t('replaceHint')}</p>
            </section>
            {!compare && selected && (
              <section className="preview-notes">
                <h3>
                  {t('annotations')} <span>{notes.length}</span>
                </h3>
                {imageTypes.has(selected.type) && (
                  <button
                    type="button"
                    className="preview-add"
                    ref={addNoteButton}
                    aria-pressed={placing}
                    onClick={() => {
                      setPlacing(!placing);
                      setDraft(null);
                      setEditingId(null);
                      setText('');
                    }}
                  >
                    {t('add')}
                  </button>
                )}
                {placing && !draft && (
                  <div className="preview-placement">
                    <p>{t('place')}</p>
                    <button
                      type="button"
                      onClick={() => setDraft({ x: 0.5, y: 0.5 })}
                    >
                      {t('center')}
                    </button>
                  </div>
                )}
                {draft && (
                  <form
                    className="preview-note-form"
                    onSubmit={(event) => {
                      event.preventDefault();
                      void saveNote();
                    }}
                  >
                    <label>
                      {t('text')}
                      <textarea
                        ref={textInput}
                        value={text}
                        onChange={(event) => setText(event.target.value)}
                        maxLength={10000}
                        required
                      />
                    </label>
                    <p className="preview-hint">
                      {t('noteAt', {
                        x: Math.round(draft.x * 100),
                        y: Math.round(draft.y * 100),
                      })}
                    </p>
                    <div>
                      <button type="submit" disabled={busy || !text.trim()}>
                        {t(busy ? 'saving' : 'save')}
                      </button>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => {
                          setDraft(null);
                          setEditingId(null);
                          setPlacing(false);
                          setText('');
                          addNoteButton.current?.focus();
                        }}
                      >
                        {t('cancel')}
                      </button>
                    </div>
                  </form>
                )}
                {notes.length ? (
                  <ol className="preview-note-list">
                    {notes.map((note, index) => (
                      <li
                        key={note.id}
                        tabIndex={-1}
                        id={`preview-note-${note.id}`}
                      >
                        <span className="preview-note-number">{index + 1}</span>
                        <p>{note.text}</p>
                        <button
                          type="button"
                          disabled={busy}
                          aria-label={t('edit', { number: index + 1 })}
                          onClick={() => {
                            setEditingId(note.id);
                            setDraft({ x: note.x, y: note.y });
                            setText(note.text);
                            setPlacing(false);
                          }}
                        >
                          ✎
                        </button>
                        <button
                          type="button"
                          disabled={busy}
                          aria-label={t('delete', { number: index + 1 })}
                          onClick={() => void deleteNote(note.id)}
                        >
                          ×
                        </button>
                      </li>
                    ))}
                  </ol>
                ) : (
                  <p className="preview-hint">{t('emptyNotes')}</p>
                )}
              </section>
            )}
          </aside>
        </div>
        <div className="preview-sr-only" role="status" aria-live="polite">
          {status}
        </div>
      </section>
    </div>
  );
}

export function AssetPreview(props: AssetPreviewProps) {
  return <AssetPreviewDialog key={props.asset.id} {...props} />;
}
