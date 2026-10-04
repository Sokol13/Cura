import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { ExportJob, ExportRequest } from '@cura/shared';
import { request } from '../catalog/api';
import './i18n';
import './process.css';
// Export jobs are retained server-side. A list started before a POST may omit that
// job, and a queued POST response may arrive after the list already reports it done.
function reconcileJobs(
  current: ExportJob[],
  incoming: ExportJob[],
  libraryId: string,
): ExportJob[] {
  const jobs = new Map(
    current
      .filter((job) => job.libraryId === libraryId)
      .map((job) => [job.id, job]),
  );
  const phase = (job: ExportJob) =>
    job.status === 'queued' ? 0 : job.status === 'running' ? 1 : 2;
  for (const next of incoming) {
    if (next.libraryId !== libraryId) continue;
    const previous = jobs.get(next.id);
    if (
      previous &&
      (phase(previous) > phase(next) ||
        (phase(previous) === phase(next) &&
          (previous.progress > next.progress ||
            (previous.progress === next.progress &&
              previous.updatedAt > next.updatedAt))))
    )
      continue;
    jobs.set(next.id, next);
  }
  return [...jobs.values()].sort(
    (left, right) =>
      right.createdAt.localeCompare(left.createdAt) ||
      right.id.localeCompare(left.id),
  );
}
export function ExportPanel({
  libraryId,
  assetIds = [],
}: {
  libraryId: string;
  assetIds?: string[];
}) {
  const { t } = useTranslation('process');
  const submitting = useRef(false);
  const currentLibrary = useRef(libraryId);
  currentLibrary.current = libraryId;
  const [jobs, setJobs] = useState<ExportJob[]>([]),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [revision, setRevision] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    void request<ExportJob[]>(`/api/libraries/${libraryId}/exports`, {
      signal: controller.signal,
    })
      .then((loaded) => {
        if (!controller.signal.aborted)
          setJobs((current) => reconcileJobs(current, loaded, libraryId));
      })
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
    // React batches same-tick events; a ref guards the request before repaint.
    if (submitting.current) return;
    submitting.current = true;
    setBusy(true);
    setError('');
    try {
      const job = await request<ExportJob>(
        `/api/libraries/${libraryId}/exports`,
        { method: 'POST', body: input },
      );
      if (currentLibrary.current === libraryId)
        setJobs((current) => reconcileJobs(current, [job], libraryId));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t('error'));
    } finally {
      submitting.current = false;
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
      {jobs
        .filter((job) => job.libraryId === libraryId)
        .map((job) => (
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
              {t(
                job.request.scope === 'library' ? 'wholeLibrary' : 'selection',
              )}{' '}
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
