import { automationUrl, useAutomationPage } from './api';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  AutomationJobSchema,
  AutomationJobsPageSchema,
  AutomationProposalsPageSchema,
  AutomationProvidersSchema,
  type AutomationProviderInfo,
  type AutomationJob,
} from '@cura/shared';
import { request } from '../catalog/api';
import { AssetPicker, type AssetChoice } from './AssetPicker';
import { ProposalReview } from './ProposalReview';
import { useOperation } from './useOperation';
import { OperationError, PageControls } from './common';

export function ReviewPanel({ libraryId }: { libraryId: string }) {
  const { t } = useTranslation('automation');
  const [providers, setProviders] = useState<AutomationProviderInfo[]>([]);
  const [providerId, setProviderId] = useState('metadata-rules');
  const [providerError, setProviderError] = useState(false);
  const [pollError, setPollError] = useState(false);
  const [providerRetry, setProviderRetry] = useState(0);
  const [choices, setChoices] = useState<AssetChoice[]>([]);
  const [jobId, setJobId] = useState('');
  const [status, setStatus] = useState('');
  const [activeJob, setActiveJob] = useState<AutomationJob | null>(null);
  const jobs = useAutomationPage(
    automationUrl(libraryId, 'jobs'),
    AutomationJobsPageSchema,
  );
  const query = new URLSearchParams({
    ...(jobId ? { jobId } : {}),
    ...(status ? { status } : {}),
  });
  const proposals = useAutomationPage(
    `${automationUrl(libraryId, 'proposals')}?${query}`,
    AutomationProposalsPageSchema,
  );
  const operation = useOperation(libraryId);
  useEffect(() => {
    const abort = new AbortController();
    void request(automationUrl(libraryId, 'providers'), {
      signal: abort.signal,
    })
      .then((raw) => {
        const available = AutomationProvidersSchema.parse(raw).filter((entry) =>
          entry.capabilities.includes('vision-proposals'),
        );
        if (!abort.signal.aborted) {
          setProviders(available);
          setProviderError(false);
        }
      })
      .catch(() => {
        if (!abort.signal.aborted) setProviderError(true);
      });
    return () => abort.abort();
  }, [libraryId, providerRetry]);
  const refreshJobs = jobs.refresh;
  const refreshProposals = proposals.refresh;
  const activeId =
    activeJob && ['queued', 'running'].includes(activeJob.status)
      ? activeJob.id
      : null;
  useEffect(() => {
    if (!activeId) return;
    const abort = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const job = AutomationJobSchema.parse(
          await request(automationUrl(libraryId, `jobs/${activeId}`), {
            signal: abort.signal,
          }),
        );
        if (abort.signal.aborted) return;
        setActiveJob(job);
        setPollError(false);
        refreshJobs();
        if (['queued', 'running'].includes(job.status))
          timer = setTimeout(() => void poll(), 800);
        else refreshProposals();
      } catch {
        if (!abort.signal.aborted) {
          setPollError(true);
          timer = setTimeout(() => void poll(), 2000);
        }
      }
    };
    timer = setTimeout(() => void poll(), 300);
    return () => {
      clearTimeout(timer);
      abort.abort();
    };
  }, [libraryId, activeId, refreshJobs, refreshProposals]);
  const selectedProvider = providers.find(
    (provider) => provider.id === providerId,
  );
  const chooseJob = (job: AutomationJob) => {
    setJobId(job.id);
    setActiveJob(job);
    proposals.setOffset(0);
  };
  return (
    <div className="automation-review-layout">
      <aside className="automation-card automation-analysis-form">
        <h2>{t('chooseAssets')}</h2>
        <p className="automation-hint">{t('analysisHint')}</p>
        <AssetPicker
          libraryId={libraryId}
          value={choices}
          onChange={setChoices}
          disabled={operation.busy}
        />
        <label className="form-field">
          <span>{t('provider')}</span>
          <select
            value={providerId}
            disabled={operation.busy}
            onChange={(event) => setProviderId(event.target.value)}
          >
            {providers.map((provider) => (
              <option
                key={provider.id}
                value={provider.id}
                disabled={!provider.configured}
              >
                {provider.kind === 'metadata-rules'
                  ? t('provider_rules')
                  : provider.label}
                {!provider.configured ? ` · ${t('providerUnavailable')}` : ''}
              </option>
            ))}
          </select>
        </label>
        <OperationError
          error={providerError}
          onRetry={() => setProviderRetry((value) => value + 1)}
        />
        <button
          className="button-primary"
          disabled={
            operation.busy ||
            choices.length === 0 ||
            !selectedProvider?.configured
          }
          onClick={() =>
            void operation.run(
              async (signal) =>
                AutomationJobSchema.parse(
                  await request(automationUrl(libraryId, 'jobs'), {
                    method: 'POST',
                    body: {
                      assetIds: choices.map((choice) => choice.assetId),
                      providerId,
                    },
                    signal,
                  }),
                ),
              (job) => {
                chooseJob(job);
                jobs.refresh();
                proposals.refresh();
              },
            )
          }
        >
          {t('analyze')}
        </button>
        <OperationError error={operation.error} />
        <h2>{t('jobs')}</h2>
        <OperationError error={jobs.error} onRetry={jobs.refresh} />
        {jobs.loading && <p role="status">{t('loading')}</p>}
        {jobs.data.items.length === 0 && !jobs.loading && <p>{t('noJobs')}</p>}
        <div className="automation-record-list">
          {jobs.data.items.map((job) => (
            <button
              key={job.id}
              aria-current={job.id === jobId ? 'true' : undefined}
              disabled={operation.busy}
              onClick={() => chooseJob(job)}
            >
              <span>{t(`status_${job.status}`)}</span>
              <small>
                {job.processed}/{job.total} ·{' '}
                {new Date(job.createdAt).toLocaleString()}
              </small>
            </button>
          ))}
        </div>
        <PageControls
          total={jobs.data.total}
          offset={jobs.offset}
          onOffset={jobs.setOffset}
          disabled={jobs.loading || operation.busy}
        />
      </aside>
      <div className="automation-review-main">
        <div className="automation-section-heading">
          <h2>{t('proposals')}</h2>
          <div className="automation-inline">
            <button
              disabled={operation.busy}
              onClick={() => {
                setJobId('');
                setActiveJob(null);
                proposals.setOffset(0);
              }}
            >
              {t('allJobs')}
            </button>
            <select
              aria-label={t('proposals')}
              value={status}
              onChange={(event) => {
                setStatus(event.target.value);
                proposals.setOffset(0);
              }}
            >
              <option value="">{t('allStatuses')}</option>
              {['pending', 'applied', 'undone'].map((state) => (
                <option key={state} value={state}>
                  {t(`status_${state}`)}
                </option>
              ))}
            </select>
          </div>
        </div>
        {activeJob && (
          <div className="automation-job-state" role="status">
            <strong>{t(`status_${activeJob.status}`)}</strong>{' '}
            {activeJob.processed}/{activeJob.total}
            {activeJob.archiveRuleSnapshot && (
              <p>
                {activeJob.archiveRuleSnapshot.name} ·{' '}
                {t('revision', {
                  number: activeJob.archiveRuleSnapshot.revision,
                })}{' '}
                · {t('olderThan')}:{' '}
                {activeJob.archiveRuleSnapshot.filters.olderThanDays} ·{' '}
                {t('maxRating')}:{' '}
                {activeJob.archiveRuleSnapshot.filters.maxRating}
              </p>
            )}
            {activeId && (
              <button
                disabled={operation.busy}
                onClick={() =>
                  void operation.run(
                    async (signal) =>
                      AutomationJobSchema.parse(
                        await request(
                          automationUrl(libraryId, `jobs/${activeId}/cancel`),
                          { method: 'POST', signal },
                        ),
                      ),
                    (job) => {
                      setActiveJob(job);
                      jobs.refresh();
                      proposals.refresh();
                    },
                  )
                }
              >
                {t('cancelJob')}
              </button>
            )}
            {(activeJob.errorCode ||
              activeJob.results.some((result) => result.errorCode)) && (
              <ul>
                {activeJob.results
                  .filter((result) => result.errorCode)
                  .map((result) => (
                    <li key={result.assetId}>
                      {choices.find(
                        (choice) => choice.assetId === result.assetId,
                      )?.name ?? result.assetId}
                      : {t('proposalError')}
                    </li>
                  ))}
                {activeJob.errorCode && <li>{t('saveError')}</li>}
              </ul>
            )}
          </div>
        )}
        <OperationError error={pollError} />
        <OperationError error={proposals.error} onRetry={proposals.refresh} />
        {proposals.loading && <p role="status">{t('loading')}</p>}
        <ProposalReview
          key={`${jobId}:${status}:${proposals.offset}`}
          libraryId={libraryId}
          proposals={proposals.data.items}
          onUpdated={(items) =>
            proposals.setData((page) => ({ ...page, items }))
          }
          onRefresh={proposals.refresh}
          disabled={proposals.loading || Boolean(activeId)}
        />
        <PageControls
          total={proposals.data.total}
          offset={proposals.offset}
          onOffset={proposals.setOffset}
          disabled={proposals.loading}
        />
      </div>
    </div>
  );
}
