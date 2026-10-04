import { automationUrl, useAutomationPage } from './api';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  AutomationJobSchema,
  AutomationProvidersSchema,
  ErrorResponseSchema,
  ScriptBreakdownSchema,
  ScriptsPageSchema,
  type AutomationJob,
  type AutomationProviderInfo,
  type ScriptBreakdown,
} from '@cura/shared';
import { ApiError, request } from '../catalog/api';
import { ScriptEditor } from './ScriptEditor';
import { OperationError, PageControls } from './common';
import { useOperation } from './useOperation';

export function ScriptsPanel({ libraryId }: { libraryId: string }) {
  const { t } = useTranslation('automation');
  const page = useAutomationPage(
    automationUrl(libraryId, 'scripts'),
    ScriptsPageSchema,
  );
  const [selectedId, setSelectedId] = useState('');
  const [fileError, setFileError] = useState(false);
  const [providers, setProviders] = useState<AutomationProviderInfo[]>([]);
  const [providerId, setProviderId] = useState('');
  const [providerError, setProviderError] = useState(false);
  const [providerRetry, setProviderRetry] = useState(0);
  const [job, setJob] = useState<AutomationJob | null>(null);
  const [pollError, setPollError] = useState(false);
  const operation = useOperation(libraryId);
  const script = page.data.items.find((item) => item.id === selectedId);
  const accept = (next: ScriptBreakdown) => {
    page.setData((current) => ({
      ...current,
      items: [next, ...current.items.filter((item) => item.id !== next.id)],
    }));
    setSelectedId(next.id);
  };
  const refreshScripts = page.refresh;
  const activeJobId =
    job && ['queued', 'running'].includes(job.status) ? job.id : null;
  useEffect(() => {
    const abort = new AbortController();
    void request(automationUrl(libraryId, 'providers'), {
      signal: abort.signal,
    })
      .then((raw) => {
        const list = AutomationProvidersSchema.parse(raw).filter((provider) =>
          provider.capabilities.includes('script-analysis'),
        );
        if (!abort.signal.aborted) {
          setProviders(list);
          setProviderError(false);
          setProviderId(list.find((provider) => provider.configured)?.id ?? '');
        }
      })
      .catch(() => {
        if (!abort.signal.aborted) setProviderError(true);
      });
    return () => abort.abort();
  }, [libraryId, providerRetry]);
  useEffect(() => {
    if (!activeJobId) return;
    const abort = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const next = AutomationJobSchema.parse(
          await request(automationUrl(libraryId, `jobs/${activeJobId}`), {
            signal: abort.signal,
          }),
        );
        if (abort.signal.aborted) return;
        setJob(next);
        setPollError(false);
        if (['queued', 'running'].includes(next.status))
          timer = setTimeout(() => void poll(), 800);
        else refreshScripts();
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
  }, [libraryId, activeJobId, refreshScripts]);
  const upload = (file: File) => {
    if (!/\.(txt|md|fountain)$/i.test(file.name) || file.size > 512 * 1024) {
      setFileError(true);
      return;
    }
    setFileError(false);
    void operation.run(
      async (signal) => {
        const response = await fetch(
          `${automationUrl(libraryId, 'scripts')}?name=${encodeURIComponent(file.name)}`,
          {
            method: 'POST',
            headers: { 'content-type': 'application/octet-stream' },
            body: file,
            signal,
          },
        );
        if (!response.ok) {
          const error = ErrorResponseSchema.safeParse(
            await response.json().catch(() => null),
          );
          throw new ApiError(
            error.success ? error.data.code : 'UPLOAD_FAILED',
            'Script import failed',
            response.status,
          );
        }
        return ScriptBreakdownSchema.parse(await response.json());
      },
      (next) => {
        accept(next);
        page.setOffset(0);
        page.refresh();
      },
    );
  };
  return (
    <div className="automation-record-layout">
      <aside className="automation-record-sidebar">
        <label className="automation-upload button-primary">
          {t('importScript')}
          <input
            type="file"
            aria-label={t('importScript')}
            accept=".txt,.md,.fountain"
            disabled={operation.busy || Boolean(activeJobId)}
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) upload(file);
              event.target.value = '';
            }}
          />
        </label>
        <p className="automation-hint">{t('scriptHint')}</p>
        <OperationError error={fileError ? 'uploadError' : operation.error} />
        <OperationError error={page.error} onRetry={page.refresh} />
        {page.loading && <p role="status">{t('loading')}</p>}
        <div className="automation-record-list">
          {page.data.items.map((item) => (
            <button
              key={item.id}
              disabled={operation.busy || Boolean(activeJobId)}
              aria-current={item.id === selectedId ? 'true' : undefined}
              onClick={() => {
                setSelectedId(item.id);
                setJob(null);
              }}
            >
              {item.title}
            </button>
          ))}
        </div>
        <PageControls
          total={page.data.total}
          offset={page.offset}
          onOffset={page.setOffset}
          disabled={page.loading || operation.busy || Boolean(activeJobId)}
        />
      </aside>
      <div className="automation-detail">
        {script ? (
          <>
            <ScriptEditor
              key={`${script.id}:${script.revision}`}
              libraryId={libraryId}
              script={script}
              onSaved={accept}
              disabled={Boolean(activeJobId)}
            />
            <OperationError
              error={providerError}
              onRetry={() => setProviderRetry((value) => value + 1)}
            />
            {providers.length > 0 && (
              <section className="automation-card">
                <label className="form-field">
                  <span>{t('provider')}</span>
                  <select
                    value={providerId}
                    disabled={operation.busy || Boolean(activeJobId)}
                    onChange={(event) => setProviderId(event.target.value)}
                  >
                    {providers.map((provider) => (
                      <option
                        key={provider.id}
                        value={provider.id}
                        disabled={!provider.configured}
                      >
                        {provider.label}
                        {!provider.configured
                          ? ` · ${t('providerUnavailable')}`
                          : ''}
                      </option>
                    ))}
                  </select>
                </label>
                <button
                  disabled={
                    operation.busy || Boolean(activeJobId) || !providerId
                  }
                  onClick={() =>
                    void operation.run(
                      async (signal) =>
                        AutomationJobSchema.parse(
                          await request(
                            automationUrl(
                              libraryId,
                              `scripts/${script.id}/analyze`,
                            ),
                            { method: 'POST', body: { providerId }, signal },
                          ),
                        ),
                      setJob,
                    )
                  }
                >
                  {t('reanalyzeScript')}
                </button>
              </section>
            )}
            {job && (
              <section className="automation-card" role="status">
                {t(`status_${job.status}`)} · {job.processed}/{job.total}
                {job.errorCode && <p>{t('proposalError')}</p>}
                {activeJobId && (
                  <button
                    disabled={operation.busy}
                    onClick={() =>
                      void operation.run(
                        async (signal) =>
                          AutomationJobSchema.parse(
                            await request(
                              automationUrl(
                                libraryId,
                                `jobs/${activeJobId}/cancel`,
                              ),
                              { method: 'POST', signal },
                            ),
                          ),
                        setJob,
                      )
                    }
                  >
                    {t('cancelJob')}
                  </button>
                )}
              </section>
            )}
            <OperationError error={pollError} />
          </>
        ) : (
          <p className="automation-empty">
            {page.data.total ? t('chooseRecord') : t('noScripts')}
          </p>
        )}
      </div>
    </div>
  );
}
