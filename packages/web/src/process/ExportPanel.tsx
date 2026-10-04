import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { ExportJob, ExportRequest } from '@cura/shared';
import { request } from '../catalog/api';
import './i18n';
import './process.css';
export function ExportPanel({
  libraryId,
  assetIds = [],
}: {
  libraryId: string;
  assetIds?: string[];
}) {
  const { t } = useTranslation('process');
  const [jobs, setJobs] = useState<ExportJob[]>([]),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [revision, setRevision] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    void request<ExportJob[]>(`/api/libraries/${libraryId}/exports`, {
      signal: controller.signal,
    })
      .then(setJobs)
      .catch((reason: unknown) => {
        if (!controller.signal.aborted)
          setError(reason instanceof Error ? reason.message : t('error'));
      });
    return () => controller.abort();
  }, [libraryId, revision, t]);
  useEffect(() => {
    if (
      !jobs.some((job) => job.status === 'queued' || job.status === 'running')
    )
      return;
    const timer = window.setTimeout(
      () => setRevision((value) => value + 1),
      400,
    );
    return () => window.clearTimeout(timer);
  }, [jobs]);
  const start = async (input: ExportRequest) => {
    setBusy(true);
    setError('');
    try {
      const job = await request<ExportJob>(
        `/api/libraries/${libraryId}/exports`,
        { method: 'POST', body: input },
      );
      setJobs((current) => [job, ...current]);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t('error'));
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="process-export">
      <h2>{t('portableExport')}</h2>
      <p>{t('exportHint')}</p>
      <p className="process-muted">{t('exportSelectionHint')}</p>
      <div className="process-controls">
        <button
          disabled={busy}
          onClick={() => void start({ scope: 'library' })}
        >
          {t('exportLibrary')}
        </button>
        <button
          disabled={busy || assetIds.length === 0}
          onClick={() => void start({ scope: 'selection', assetIds })}
        >
          {t('exportSelected', { count: assetIds.length })}
        </button>
      </div>
      {error && <p role="alert">{error}</p>}
      {jobs.map((job) => (
        <section
          className="process-job"
          key={job.id}
          aria-label={t('exportJob', {
            scope: t(
              job.request.scope === 'library' ? 'wholeLibrary' : 'selection',
            ),
          })}
        >
          <h3>
            {t(job.request.scope === 'library' ? 'wholeLibrary' : 'selection')}{' '}
            · {new Date(job.createdAt).toLocaleString()}
          </h3>
          <p>{t(job.status)}</p>
          <progress value={job.progress} max={1} />
          {job.error && <p role="status">{job.error}</p>}
          {job.exceptions.map((exception, index) => (
            <p key={index}>{exception.message}</p>
          ))}
          {job.status === 'completed' && (
            <>
              <p>
                {t('archiveSize', {
                  size: (job.bytes / 1024 / 1024).toFixed(2),
                })}
              </p>
              <a
                href={`/api/exports/${job.id}/file`}
                download={job.filename ?? 'cura-export.zip'}
              >
                {t('downloadArchive')}
              </a>
            </>
          )}
        </section>
      ))}
    </section>
  );
}
