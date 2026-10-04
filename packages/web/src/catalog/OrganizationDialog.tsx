import {
  useEffect,
  useId,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from 'react';
import { useTranslation } from 'react-i18next';

import { request } from './api';

type DialogProps = {
  title: string;
  children: ReactNode;
  onClose: () => void;
  onSubmit: () => Promise<void>;
  submitLabel: string;
  danger?: boolean;
  disabled?: boolean;
};

export function OrganizationDialog({
  title,
  children,
  onClose,
  onSubmit,
  submitLabel,
  danger,
  disabled,
}: DialogProps) {
  const { t } = useTranslation();
  const titleId = useId();
  const panel = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  close.current = onClose;
  const busyRef = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    const previous =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    const node = panel.current;
    node
      ?.querySelector<HTMLElement>('input, select, textarea, button')
      ?.focus();
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        if (!busyRef.current) close.current();
      }
      if (event.key !== 'Tab') return;
      const controls = Array.from(
        node?.querySelectorAll<HTMLElement>(
          'button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex="0"]',
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
    document.addEventListener('keydown', handleKey, true);
    return () => {
      document.removeEventListener('keydown', handleKey, true);
      previous?.focus();
    };
  }, []);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busyRef.current || disabled) return;
    busyRef.current = true;
    setBusy(true);
    setError('');
    try {
      await onSubmit();
    } catch (failure) {
      setError(
        failure instanceof Error
          ? failure.message
          : t('requestFailed', 'Something went wrong. Please try again.'),
      );
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  return (
    <div className="dialog-backdrop">
      <div
        ref={panel}
        className="organization-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        <form onSubmit={(event) => void submit(event)}>
          <h2 className="dialog-heading" id={titleId}>
            {title}
          </h2>
          <fieldset className="dialog-fields" disabled={busy}>
            {children}
          </fieldset>
          {error && (
            <p role="alert" className="error-message">
              {error}
            </p>
          )}
          <div className="dialog-actions">
            <button type="button" disabled={busy} onClick={onClose}>
              {t('cancel', 'Cancel')}
            </button>
            <button
              type="submit"
              className={danger ? 'button-danger' : 'button-primary'}
              disabled={busy || disabled}
            >
              {busy ? t('saving', 'Saving…') : submitLabel}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

type DirectoryList = {
  path: string;
  parent: string | null;
  directories: { name: string; path: string }[];
};

export function DirectoryBrowserDialog({
  libraryId,
  onClose,
  onRegistered,
}: {
  libraryId: string;
  onClose: () => void;
  onRegistered: () => void;
}) {
  const { t } = useTranslation();
  const [path, setPath] = useState('');
  const [listing, setListing] = useState<DirectoryList | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const requestId = useRef(0);

  async function browse(directory?: string) {
    const id = ++requestId.current;
    setLoading(true);
    setError('');
    try {
      const result = await request<DirectoryList>(
        `/api/directories${directory ? `?path=${encodeURIComponent(directory)}` : ''}`,
      );
      if (id !== requestId.current) return;
      setListing(result);
      setPath(result.path);
    } catch (failure) {
      if (id !== requestId.current) return;
      setError(
        failure instanceof Error
          ? failure.message
          : t('requestFailed', 'Something went wrong. Please try again.'),
      );
    } finally {
      if (id === requestId.current) setLoading(false);
    }
  }

  useEffect(() => {
    void browse();
    return () => {
      requestId.current += 1;
    };
    // A new dialog starts in the server's home directory; later navigation is explicit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <OrganizationDialog
      title={t('registerFolder', 'Register folder')}
      onClose={onClose}
      submitLabel={t('registerFolder', 'Register folder')}
      disabled={loading || !path.trim()}
      onSubmit={async () => {
        await request(`/api/libraries/${encodeURIComponent(libraryId)}/roots`, {
          method: 'POST',
          body: { path: path.trim() },
        });
        onRegistered();
        onClose();
      }}
    >
      <p className="field-hint">
        {t(
          'registerFolderHint',
          'Choose a folder on this computer. Cura watches for changes and keeps your originals in place.',
        )}
      </p>
      <div className="directory-path">
        <label className="form-field">
          <span>{t('directoryPath', 'Directory path')}</span>
          <input
            value={path}
            onChange={(event) => setPath(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                void browse(path);
              }
            }}
          />
        </label>
        <button
          type="button"
          disabled={loading}
          onClick={() => void browse(path)}
        >
          {t('browse', 'Browse')}
        </button>
      </div>
      <button
        type="button"
        disabled={loading || !listing?.parent}
        onClick={() => void browse(listing?.parent ?? undefined)}
      >
        <span aria-hidden="true">↑ </span>
        {t('parentDirectory', 'Parent directory')}
      </button>
      {error && (
        <p role="alert" className="error-message">
          {error}
        </p>
      )}
      <div className="directory-list" aria-busy={loading}>
        {loading ? (
          <p role="status" className="empty-note">
            {t('loading', 'Loading…')}
          </p>
        ) : listing?.directories.length ? (
          listing.directories.map((directory) => (
            <button
              type="button"
              className="directory-entry"
              key={directory.path}
              onClick={() => void browse(directory.path)}
            >
              <span className="nav-icon" aria-hidden="true">
                ▱
              </span>
              <span>{directory.name}</span>
              <span aria-hidden="true">›</span>
            </button>
          ))
        ) : (
          <p className="empty-note">{t('noDirectories', 'No subfolders')}</p>
        )}
      </div>
    </OrganizationDialog>
  );
}
