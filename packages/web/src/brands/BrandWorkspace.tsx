import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  BrandPackageSchema,
  BrandSchema,
  BrandsSchema,
  CmfBoardSchema,
  CmfBoardsSchema,
  AssetVersionsSchema,
  colorValues,
  cmykToHex,
  rgbToHex,
  type Brand,
  type BrandPin,
  type CmfBoard,
  type SaveBrand,
  type SaveCmfBoard,
} from '@cura/shared';
import { ApiError, request, assetUrl } from '../catalog/api';
import { PinPicker } from './PinPicker';
import {
  brandPdf,
  downloadBlob,
  encodeAse,
  makeBrandHtml,
  markdownHtml,
} from './exports';
import './i18n';
import './brands.css';

const brandDraft = (brand: Brand): SaveBrand => ({
  name: brand.name,
  guidelines: brand.guidelines,
  expectedRevision: brand.revision,
  colors: brand.colors.map(({ id, name, hex }) => ({ id, name, hex })),
  fonts: brand.fonts.map(({ id, name, role, pin }) => ({
    id,
    name,
    role,
    pin,
  })),
  logos: brand.logos.map(({ id, name, pin }) => ({ id, name, pin })),
});
const cmfDraft = (board: CmfBoard): SaveCmfBoard => ({
  name: board.name,
  expectedRevision: board.revision,
  entries: board.entries.map(({ id, name, colorName, hex, process, pin }) => ({
    id,
    name,
    colorName,
    hex,
    process,
    pin,
  })),
});
function moved<T>(items: T[], index: number, direction: number): T[] {
  const result = [...items];
  [result[index], result[index + direction]] = [
    result[index + direction]!,
    result[index]!,
  ];
  return result;
}
function RowActions({
  index,
  count,
  onMove,
  onRemove,
}: {
  index: number;
  count: number;
  onMove: (direction: number) => void;
  onRemove: () => void;
}) {
  const { t } = useTranslation('brands');
  return (
    <div className="brand-row-actions">
      <button
        type="button"
        aria-label={t('up')}
        disabled={index === 0}
        onClick={() => onMove(-1)}
      >
        ↑
      </button>
      <button
        type="button"
        aria-label={t('down')}
        disabled={index === count - 1}
        onClick={() => onMove(1)}
      >
        ↓
      </button>
      <button type="button" onClick={onRemove}>
        {t('remove')}
      </button>
    </div>
  );
}
function ColorEditor({
  hex,
  onChange,
}: {
  hex: string;
  onChange: (value: string) => void;
}) {
  const { t } = useTranslation('brands');
  const [mode, setMode] = useState('HEX'),
    [edit, setEdit] = useState({ hex, mode: 'HEX', value: hex });
  const input = useRef<HTMLInputElement>(null);
  const display = useCallback((format: string, color: string) => {
    const values = colorValues(color);
    return format === 'HEX'
      ? values.hex
      : (format === 'RGB' ? values.rgb : values.cmyk).join(', ');
  }, []);
  if (edit.hex !== hex || edit.mode !== mode) {
    setEdit({ hex, mode, value: display(mode, hex) });
  }
  useEffect(() => {
    input.current?.setCustomValidity('');
  }, [hex, mode]);
  return (
    <div className="brand-color-editor">
      <input
        type="color"
        aria-label="HEX"
        value={hex}
        onChange={(event) => onChange(event.target.value)}
      />
      <label>
        {t('colorMode')}
        <select value={mode} onChange={(event) => setMode(event.target.value)}>
          <option>HEX</option>
          <option>RGB</option>
          <option>CMYK</option>
        </select>
      </label>
      <label>
        {t('colorValue')}
        <input
          ref={input}
          value={edit.value}
          onChange={(event) => {
            setEdit({ hex, mode, value: event.target.value });
            try {
              const channels = event.target.value
                .split(',')
                .map((part) => Number(part.trim()));
              const next =
                mode === 'HEX'
                  ? colorValues(event.target.value).hex
                  : mode === 'RGB'
                    ? rgbToHex(channels)
                    : cmykToHex(channels);
              event.target.setCustomValidity('');
              onChange(next);
            } catch {
              event.target.setCustomValidity(t('failed'));
            }
          }}
          onBlur={(event) => {
            if (!event.target.checkValidity()) event.target.reportValidity();
          }}
        />
      </label>
      <small>
        RGB {colorValues(hex).rgb.join(', ')} · CMYK{' '}
        {colorValues(hex).cmyk.join(', ')}%
      </small>
    </div>
  );
}
function PinnedPreview({
  pin,
  onReplace,
}: {
  pin: BrandPin;
  onReplace: () => void;
}) {
  const { t } = useTranslation('brands');
  const [label, setLabel] = useState('');
  useEffect(() => {
    let active = true;
    void request(`/api/assets/${pin.assetId}/versions`)
      .then((value) => {
        const version = AssetVersionsSchema.parse(value).find(
          (item) => item.id === pin.versionId,
        );
        if (active && version)
          setLabel(`V${version.ordinal} · ${version.name}`);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [pin.assetId, pin.versionId]);
  return (
    <div className="brand-pin">
      <img src={assetUrl(pin.versionId, 'thumbnail')} alt="" />
      <div>
        <small>
          {t('pinned')} · {label}
        </small>
        <p>
          <button type="button" onClick={onReplace}>
            {t('replace')}
          </button>{' '}
          <a href={assetUrl(pin.versionId, 'file')}>{t('download')}</a>
        </p>
      </div>
    </div>
  );
}
export function BrandWorkspace({
  libraryId,
  onBack,
}: {
  libraryId: string;
  onBack: () => void;
}) {
  const { t } = useTranslation('brands');
  const mutationPending = useRef(false);
  const [tab, setTab] = useState<'brands' | 'cmf'>('brands'),
    [brands, setBrands] = useState<Brand[]>([]),
    [boards, setBoards] = useState<CmfBoard[]>([]),
    [selected, setSelected] = useState(''),
    [draft, setDraft] = useState<SaveBrand | null>(null),
    [cmf, setCmf] = useState<SaveCmfBoard | null>(null),
    [loading, setLoading] = useState(true),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [status, setStatus] = useState(''),
    [newName, setNewName] = useState(''),
    [creating, setCreating] = useState(false),
    [deleting, setDeleting] = useState(false),
    [picker, setPicker] = useState<{
      kind: 'fonts' | 'logos' | 'entries';
      index?: number;
    } | null>(null);
  const choose = useCallback(
    (
      id: string,
      nextBrands: Brand[],
      nextBoards: CmfBoard[],
      kind: 'brands' | 'cmf',
    ) => {
      setSelected(id);
      setDraft(
        kind === 'brands' && nextBrands.find((item) => item.id === id)
          ? brandDraft(nextBrands.find((item) => item.id === id)!)
          : null,
      );
      setCmf(
        kind === 'cmf' && nextBoards.find((item) => item.id === id)
          ? cmfDraft(nextBoards.find((item) => item.id === id)!)
          : null,
      );
      setStatus('');
    },
    [],
  );
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [allBrands, allBoards] = await Promise.all([
        request(`/api/libraries/${libraryId}/brands`).then((value) =>
          BrandsSchema.parse(value),
        ),
        request(`/api/libraries/${libraryId}/cmf-boards`).then((value) =>
          CmfBoardsSchema.parse(value),
        ),
      ]);
      setBrands(allBrands);
      setBoards(allBoards);
      return { allBrands, allBoards };
    } finally {
      setLoading(false);
    }
  }, [libraryId]);
  const fail = useCallback(
    (failure: unknown) => {
      setError(
        failure instanceof ApiError && failure.code === 'REVISION_CONFLICT'
          ? t('conflict')
          : failure instanceof ApiError && failure.code === 'EXPORT_TOO_LARGE'
            ? t('large')
            : failure instanceof Error &&
                failure.message === 'PREVIEW_UNAVAILABLE'
              ? t('previewMissing')
              : t('failed'),
      );
    },
    [t],
  );
  useEffect(() => {
    let active = true;
    void load()
      .then(({ allBrands, allBoards }) => {
        if (active)
          choose(allBrands[0]?.id ?? '', allBrands, allBoards, 'brands');
      })
      .catch(fail);
    return () => {
      active = false;
    };
  }, [load, choose, fail]);
  async function act(operation: () => Promise<void>) {
    if (mutationPending.current) return;
    mutationPending.current = true;
    setBusy(true);
    setError('');
    setStatus('');
    try {
      await operation();
    } catch (failure) {
      fail(failure);
    } finally {
      mutationPending.current = false;
      setBusy(false);
    }
  }
  async function save() {
    await act(async () => {
      if (tab === 'brands' && draft) {
        const saved = BrandSchema.parse(
          await request(`/api/brands/${selected}`, {
            method: 'PUT',
            body: draft,
          }),
        );
        setBrands((old) =>
          old.map((item) => (item.id === saved.id ? saved : item)),
        );
        setDraft(brandDraft(saved));
      } else if (cmf) {
        const saved = CmfBoardSchema.parse(
          await request(`/api/cmf-boards/${selected}`, {
            method: 'PUT',
            body: cmf,
          }),
        );
        setBoards((old) =>
          old.map((item) => (item.id === saved.id ? saved : item)),
        );
        setCmf(cmfDraft(saved));
      }
      setStatus(t('saved'));
    });
  }
  async function create() {
    await act(async () => {
      const response = await request(
        `/api/libraries/${libraryId}/${tab === 'brands' ? 'brands' : 'cmf-boards'}`,
        { method: 'POST', body: { name: newName } },
      );
      const item =
        tab === 'brands'
          ? BrandSchema.parse(response)
          : CmfBoardSchema.parse(response);
      const { allBrands, allBoards } = await load();
      choose(item.id, allBrands, allBoards, tab);
      setCreating(false);
      setNewName('');
    });
  }
  async function remove() {
    await act(async () => {
      await request(
        `/api/${tab === 'brands' ? 'brands' : 'cmf-boards'}/${selected}`,
        { method: 'DELETE' },
      );
      const { allBrands, allBoards } = await load();
      choose(
        (tab === 'brands' ? allBrands : allBoards)[0]?.id ?? '',
        allBrands,
        allBoards,
        tab,
      );
      setDeleting(false);
    });
  }
  async function exportBrand(format: 'html' | 'json' | 'ase' | 'pdf') {
    await act(async () => {
      const data = BrandPackageSchema.parse(
        await request(`/api/brands/${selected}/package`),
      );
      const blob =
        format === 'pdf'
          ? await brandPdf(data)
          : format === 'html'
            ? new Blob([makeBrandHtml(data)], {
                type: 'text/html;charset=utf-8',
              })
            : format === 'json'
              ? new Blob([JSON.stringify(data, null, 2)], {
                  type: 'application/json;charset=utf-8',
                })
              : new Blob([new Uint8Array(encodeAse(data.brand.colors))], {
                  type: 'application/octet-stream',
                });
      downloadBlob(blob, `${data.brand.name}.${format}`);
    });
  }
  function pinChosen(pin: BrandPin, name: string) {
    if (!picker) return;
    const { kind, index } = picker;
    if (kind === 'entries' && cmf) {
      const entries = [...cmf.entries];
      if (index === undefined)
        entries.push({ name, colorName: '', hex: '#b7afa1', process: '', pin });
      else entries[index] = { ...entries[index]!, pin };
      setCmf({ ...cmf, entries });
    } else if (draft && kind === 'fonts') {
      const fonts = [...draft.fonts];
      if (index === undefined) fonts.push({ name, role: '', pin });
      else fonts[index] = { ...fonts[index]!, pin };
      setDraft({ ...draft, fonts });
    } else if (draft && kind === 'logos') {
      const logos = [...draft.logos];
      if (index === undefined) logos.push({ name, pin });
      else logos[index] = { ...logos[index]!, pin };
      setDraft({ ...draft, logos });
    }
    setPicker(null);
  }
  const savedBrand = brands.find((item) => item.id === selected),
    navigationLocked =
      busy || loading || creating || deleting || Boolean(picker),
    dirty =
      tab === 'brands' && draft && savedBrand
        ? JSON.stringify(draft) !== JSON.stringify(brandDraft(savedBrand))
        : false;
  return (
    <main className="brand-workspace">
      <header className="brand-header">
        <button disabled={navigationLocked} onClick={onBack}>
          ← {t('back')}
        </button>
        <h1>{t('title')}</h1>
        <div role="tablist">
          <button
            role="tab"
            disabled={navigationLocked}
            aria-selected={tab === 'brands'}
            onClick={() => {
              setTab('brands');
              choose(brands[0]?.id ?? '', brands, boards, 'brands');
            }}
          >
            {t('brands')}
          </button>
          <button
            role="tab"
            disabled={navigationLocked}
            aria-selected={tab === 'cmf'}
            onClick={() => {
              setTab('cmf');
              choose(boards[0]?.id ?? '', brands, boards, 'cmf');
            }}
          >
            {t('cmf')}
          </button>
        </div>
      </header>
      <div className="brand-layout">
        <aside className="brand-sidebar">
          <button
            className="button-primary"
            disabled={navigationLocked}
            onClick={() => {
              setCreating(true);
              setNewName('');
            }}
          >
            {t(tab === 'brands' ? 'newBrand' : 'newCmf')}
          </button>
          {(tab === 'brands' ? brands : boards).map((item) => (
            <button
              className={selected === item.id ? 'active' : ''}
              disabled={navigationLocked}
              key={item.id}
              onClick={() => choose(item.id, brands, boards, tab)}
            >
              {item.name}
            </button>
          ))}
        </aside>
        <section className="brand-content">
          {error && (
            <div role="alert" className="error-banner">
              {error}
              <button
                disabled={navigationLocked}
                onClick={() =>
                  void act(async () => {
                    const { allBrands, allBoards } = await load();
                    choose(selected, allBrands, allBoards, tab);
                  })
                }
              >
                {t('reload')}
              </button>
            </div>
          )}
          {status && <p role="status">{status}</p>}
          {busy && <p role="status">{t('busy')}</p>}
          {loading ? (
            <p role="status">{t('loading')}</p>
          ) : !draft && !cmf ? (
            <div className="empty-state">{t('empty')}</div>
          ) : (
            <form
              onSubmit={(event) => {
                event.preventDefault();
                void save();
              }}
            >
              <fieldset disabled={navigationLocked} className="brand-form">
                <div className="brand-title-row">
                  <label>
                    {t('name')}
                    <input
                      required
                      maxLength={200}
                      value={draft?.name ?? cmf?.name ?? ''}
                      onChange={(event) =>
                        draft
                          ? setDraft({ ...draft, name: event.target.value })
                          : cmf && setCmf({ ...cmf, name: event.target.value })
                      }
                    />
                  </label>
                  <button className="button-primary" type="submit">
                    {t(tab === 'brands' ? 'save' : 'saveCmf')}
                  </button>
                  <button type="button" onClick={() => setDeleting(true)}>
                    {t('delete')}
                  </button>
                </div>
                {draft && (
                  <>
                    <section>
                      <div className="brand-section-title">
                        <h2>{t('colors')}</h2>
                        <button
                          type="button"
                          onClick={() =>
                            setDraft({
                              ...draft,
                              colors: [
                                ...draft.colors,
                                { name: t('newName'), hex: '#ef7c40' },
                              ],
                            })
                          }
                        >
                          {t('addColor')}
                        </button>
                      </div>
                      <p>{t('approx')}</p>
                      {!draft.colors.length && <p>{t('noColors')}</p>}
                      {draft.colors.map((color, index) => (
                        <fieldset
                          className="brand-card"
                          key={color.id ?? index}
                        >
                          <label>
                            {t('colorName')}
                            <input
                              required
                              value={color.name}
                              onChange={(event) =>
                                setDraft({
                                  ...draft,
                                  colors: draft.colors.map((item, position) =>
                                    position === index
                                      ? { ...item, name: event.target.value }
                                      : item,
                                  ),
                                })
                              }
                            />
                          </label>
                          <ColorEditor
                            hex={color.hex}
                            onChange={(hex) =>
                              setDraft({
                                ...draft,
                                colors: draft.colors.map((item, position) =>
                                  position === index ? { ...item, hex } : item,
                                ),
                              })
                            }
                          />
                          <RowActions
                            index={index}
                            count={draft.colors.length}
                            onMove={(direction) =>
                              setDraft({
                                ...draft,
                                colors: moved(draft.colors, index, direction),
                              })
                            }
                            onRemove={() =>
                              setDraft({
                                ...draft,
                                colors: draft.colors.filter(
                                  (_, position) => position !== index,
                                ),
                              })
                            }
                          />
                        </fieldset>
                      ))}
                    </section>
                    <section>
                      <div className="brand-section-title">
                        <h2>{t('fonts')}</h2>
                        <button
                          type="button"
                          onClick={() => setPicker({ kind: 'fonts' })}
                        >
                          {t('addFont')}
                        </button>
                      </div>
                      <p>{t('unsupportedFont')}</p>
                      {!draft.fonts.length && <p>{t('noFonts')}</p>}
                      {draft.fonts.map((font, index) => (
                        <fieldset className="brand-card" key={font.id ?? index}>
                          <label>
                            {t('fontName')}
                            <input
                              required
                              value={font.name}
                              onChange={(event) =>
                                setDraft({
                                  ...draft,
                                  fonts: draft.fonts.map((item, position) =>
                                    position === index
                                      ? { ...item, name: event.target.value }
                                      : item,
                                  ),
                                })
                              }
                            />
                          </label>
                          <label>
                            {t('role')}
                            <input
                              value={font.role}
                              onChange={(event) =>
                                setDraft({
                                  ...draft,
                                  fonts: draft.fonts.map((item, position) =>
                                    position === index
                                      ? { ...item, role: event.target.value }
                                      : item,
                                  ),
                                })
                              }
                            />
                          </label>
                          <PinnedPreview
                            pin={font.pin}
                            onReplace={() =>
                              setPicker({ kind: 'fonts', index })
                            }
                          />
                          <RowActions
                            index={index}
                            count={draft.fonts.length}
                            onMove={(direction) =>
                              setDraft({
                                ...draft,
                                fonts: moved(draft.fonts, index, direction),
                              })
                            }
                            onRemove={() =>
                              setDraft({
                                ...draft,
                                fonts: draft.fonts.filter(
                                  (_, position) => position !== index,
                                ),
                              })
                            }
                          />
                        </fieldset>
                      ))}
                    </section>
                    <section>
                      <div className="brand-section-title">
                        <h2>{t('logos')}</h2>
                        <button
                          type="button"
                          onClick={() => setPicker({ kind: 'logos' })}
                        >
                          {t('addLogo')}
                        </button>
                      </div>
                      {!draft.logos.length && <p>{t('noLogos')}</p>}
                      {draft.logos.map((logo, index) => (
                        <fieldset className="brand-card" key={logo.id ?? index}>
                          <label>
                            {t('logoName')}
                            <input
                              required
                              value={logo.name}
                              onChange={(event) =>
                                setDraft({
                                  ...draft,
                                  logos: draft.logos.map((item, position) =>
                                    position === index
                                      ? { ...item, name: event.target.value }
                                      : item,
                                  ),
                                })
                              }
                            />
                          </label>
                          <PinnedPreview
                            pin={logo.pin}
                            onReplace={() =>
                              setPicker({ kind: 'logos', index })
                            }
                          />
                          <RowActions
                            index={index}
                            count={draft.logos.length}
                            onMove={(direction) =>
                              setDraft({
                                ...draft,
                                logos: moved(draft.logos, index, direction),
                              })
                            }
                            onRemove={() =>
                              setDraft({
                                ...draft,
                                logos: draft.logos.filter(
                                  (_, position) => position !== index,
                                ),
                              })
                            }
                          />
                        </fieldset>
                      ))}
                    </section>
                    <section>
                      <label>
                        {t('guidelines')}
                        <textarea
                          rows={12}
                          value={draft.guidelines}
                          onChange={(event) =>
                            setDraft({
                              ...draft,
                              guidelines: event.target.value,
                            })
                          }
                        />
                      </label>
                      <p>{t('guidelinesHint')}</p>
                      <details>
                        <summary>{t('preview')}</summary>
                        <div
                          className="brand-guidelines"
                          dangerouslySetInnerHTML={{
                            __html: markdownHtml(draft.guidelines),
                          }}
                        />
                      </details>
                    </section>
                    <section>
                      <h2>{t('export')}</h2>
                      <p>{t('exportHint')}</p>
                      {dirty && <p>{t('editHint')}</p>}
                      <div className="brand-export-buttons">
                        {(['html', 'pdf', 'json', 'ase'] as const).map(
                          (format) => (
                            <button
                              type="button"
                              key={format}
                              disabled={Boolean(dirty)}
                              onClick={() => void exportBrand(format)}
                            >
                              {t('export')} {format.toUpperCase()}
                            </button>
                          ),
                        )}
                      </div>
                    </section>
                  </>
                )}
                {cmf && (
                  <section>
                    <div className="brand-section-title">
                      <h2>{t('samples')}</h2>
                      <button
                        type="button"
                        onClick={() => setPicker({ kind: 'entries' })}
                      >
                        {t('addSample')}
                      </button>
                    </div>
                    {!cmf.entries.length && <p>{t('noSamples')}</p>}
                    {cmf.entries.map((entry, index) => (
                      <fieldset
                        className="brand-card cmf-card"
                        key={entry.id ?? index}
                      >
                        <label>
                          {t('sampleName')}
                          <input
                            required
                            value={entry.name}
                            onChange={(event) =>
                              setCmf({
                                ...cmf,
                                entries: cmf.entries.map((item, position) =>
                                  position === index
                                    ? { ...item, name: event.target.value }
                                    : item,
                                ),
                              })
                            }
                          />
                        </label>
                        <PinnedPreview
                          pin={entry.pin}
                          onReplace={() =>
                            setPicker({ kind: 'entries', index })
                          }
                        />
                        <label>
                          {t('colorName')}
                          <input
                            value={entry.colorName}
                            onChange={(event) =>
                              setCmf({
                                ...cmf,
                                entries: cmf.entries.map((item, position) =>
                                  position === index
                                    ? { ...item, colorName: event.target.value }
                                    : item,
                                ),
                              })
                            }
                          />
                        </label>
                        <ColorEditor
                          hex={entry.hex}
                          onChange={(hex) =>
                            setCmf({
                              ...cmf,
                              entries: cmf.entries.map((item, position) =>
                                position === index ? { ...item, hex } : item,
                              ),
                            })
                          }
                        />
                        <label>
                          {t('process')}
                          <textarea
                            rows={3}
                            value={entry.process}
                            onChange={(event) =>
                              setCmf({
                                ...cmf,
                                entries: cmf.entries.map((item, position) =>
                                  position === index
                                    ? { ...item, process: event.target.value }
                                    : item,
                                ),
                              })
                            }
                          />
                        </label>
                        <RowActions
                          index={index}
                          count={cmf.entries.length}
                          onMove={(direction) =>
                            setCmf({
                              ...cmf,
                              entries: moved(cmf.entries, index, direction),
                            })
                          }
                          onRemove={() =>
                            setCmf({
                              ...cmf,
                              entries: cmf.entries.filter(
                                (_, position) => position !== index,
                              ),
                            })
                          }
                        />
                      </fieldset>
                    ))}
                  </section>
                )}
              </fieldset>
            </form>
          )}
        </section>
      </div>
      {creating && (
        <div className="brand-dialog-backdrop">
          <form
            role="dialog"
            aria-modal="true"
            aria-label={t(tab === 'brands' ? 'newBrand' : 'newCmf')}
            className="brand-dialog"
            onSubmit={(event) => {
              event.preventDefault();
              void create();
            }}
          >
            <h2>{t(tab === 'brands' ? 'newBrand' : 'newCmf')}</h2>
            <label>
              {t('name')}
              <input
                required
                maxLength={200}
                autoFocus
                disabled={busy}
                value={newName}
                onChange={(event) => setNewName(event.target.value)}
              />
            </label>
            <footer>
              <button
                type="button"
                disabled={busy}
                onClick={() => setCreating(false)}
              >
                {t('cancel')}
              </button>
              <button disabled={busy} type="submit" className="button-primary">
                {t('create')}
              </button>
            </footer>
          </form>
        </div>
      )}
      {deleting && (
        <div className="brand-dialog-backdrop">
          <section
            className="brand-dialog"
            role="dialog"
            aria-modal="true"
            aria-label={t('delete')}
          >
            <p>{t('confirmDelete')}</p>
            <footer>
              <button disabled={busy} onClick={() => setDeleting(false)}>
                {t('cancel')}
              </button>
              <button disabled={busy} onClick={() => void remove()}>
                {t('delete')}
              </button>
            </footer>
          </section>
        </div>
      )}
      {picker && (
        <PinPicker
          libraryId={libraryId}
          onChoose={pinChosen}
          onClose={() => setPicker(null)}
        />
      )}
    </main>
  );
}
