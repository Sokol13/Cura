import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { ExportPanel } from '../process/ExportPanel';

export function ExportDialog({
  libraryId,
  assetIds,
  onClose,
}: {
  libraryId: string;
  assetIds: string[];
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const previous =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    const node = dialog.current;
    node?.showModal();
    return () => {
      node?.close();
      previous?.focus();
    };
  }, []);
  return (
    <dialog
      ref={dialog}
      className="export-dialog"
      aria-label={t('neutralExport')}
      onClose={onClose}
    >
      <header className="dialog-heading">
        <h2>{t('neutralExport')}</h2>
        <button onClick={onClose} aria-label={t('close')}>
          ×
        </button>
      </header>
      <ExportPanel libraryId={libraryId} assetIds={assetIds} />
    </dialog>
  );
}
