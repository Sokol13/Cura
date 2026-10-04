import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  SettingsSchema,
  type Settings,
  type UpdateSettings,
} from '@cura/shared';
import { request } from './api';

export function SettingsDialog({
  settings,
  libraryId,
  onUpdate,
  onClose,
  onError,
}: {
  settings: Settings;
  libraryId: string;
  onUpdate: (patch: UpdateSettings) => Promise<void>;
  onClose: () => void;
  onError: (error: unknown) => void;
}) {
  const { t } = useTranslation();
  const panel = useRef<HTMLElement>(null);
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    const previous =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    const node = panel.current;
    node?.querySelector<HTMLElement>('button, select, input')?.focus();
    const keydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        close.current();
      }
      if (event.key !== 'Tab') return;
      const controls = Array.from(
        node?.querySelectorAll<HTMLElement>(
          'button:not(:disabled), select, input, a[href]',
        ) ?? [],
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
    };
    document.addEventListener('keydown', keydown, true);
    return () => {
      document.removeEventListener('keydown', keydown, true);
      previous?.focus();
    };
  }, []);
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);
  const update = (patch: UpdateSettings) => {
    void onUpdate(patch).catch(onError);
  };
  const maintenance = async (path: string) => {
    setBusy(true);
    try {
      await request(path, { method: 'POST', body: {} });
      setStatus(
        t(path.endsWith('/rescan') ? 'scanStarted' : 'cacheRebuilding'),
      );
    } catch (error) {
      onError(error);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="dialog-backdrop" onClick={onClose}>
      <section
        ref={panel}
        className="organization-dialog settings-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="dialog-heading">
          <h2 id="settings-title">{t('settings')}</h2>
          <button aria-label={t('close')} onClick={onClose}>
            ×
          </button>
        </div>
        <div className="dialog-fields">
          <h3>{t('preferences')}</h3>
          <label>
            {t('language')}
            <select
              value={settings.language}
              onChange={(e) =>
                update({
                  language: SettingsSchema.shape.language.parse(e.target.value),
                })
              }
            >
              <option value="zh-CN">简体中文</option>
              <option value="en">English</option>
            </select>
          </label>
          <label>
            {t('theme')}
            <select
              value={settings.theme}
              onChange={(e) =>
                update({
                  theme: SettingsSchema.shape.theme.parse(e.target.value),
                })
              }
            >
              {(['dark', 'light', 'system'] as const).map((theme) => (
                <option key={theme} value={theme}>
                  {t(theme)}
                </option>
              ))}
            </select>
          </label>
          {(['sidebarWidth', 'inspectorWidth'] as const).map((key) => (
            <label key={key}>
              {t(key)}
              <input
                type="range"
                min={key === 'sidebarWidth' ? 180 : 260}
                max={key === 'sidebarWidth' ? 360 : 480}
                value={settings[key]}
                onChange={(e) => update({ [key]: Number(e.target.value) })}
              />
            </label>
          ))}
          <h3>{t('maintenance')}</h3>
          <div className="maintenance-actions">
            <button
              disabled={!libraryId || busy}
              onClick={() => {
                void maintenance(`/api/libraries/${libraryId}/rescan`);
              }}
            >
              {t('rescan')}
            </button>
            <button
              disabled={busy}
              onClick={() => {
                void maintenance('/api/cache/rebuild');
              }}
            >
              {t('rebuildCache')}
            </button>
            <a className="button-link" href="/api/diagnostics" download>
              {t('exportDiagnostics')}
            </a>
          </div>
          <p className="field-hint">{t('diagnosticsHint')}</p>
          {status && <p role="status">{status}</p>}
        </div>
        <div className="dialog-actions">
          <button onClick={onClose}>{t('close')}</button>
        </div>
      </section>
    </div>
  );
}
