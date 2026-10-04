import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  AutomationApplyRequestSchema,
  AutomationApplyResultSchema,
  type AutomationProposalView,
  type AutomationChange,
  type AutomationApplyResult,
} from '@cura/shared';
import { assetUrl, request } from '../catalog/api';
import { useOperation } from './useOperation';
import './i18n';

export function ProposalReview({
  libraryId,
  proposals,
  onUpdated,
  onRefresh,
  disabled = false,
}: {
  libraryId: string;
  proposals: AutomationProposalView[];
  onUpdated: (items: AutomationProposalView[]) => void;
  onRefresh: () => void;
  disabled?: boolean;
}) {
  const { t } = useTranslation('automation');
  const operation = useOperation(libraryId);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [conflicts, setConflicts] = useState<
    AutomationApplyResult['conflicts']
  >([]);
  const busy = disabled || operation.busy;
  const changesFor = (mode: 'apply' | 'undo') =>
    proposals.flatMap((proposal) => {
      const changes = proposal.changes.filter(
        (change) =>
          selected.has(change.id) &&
          (mode === 'undo'
            ? change.status === 'applied'
            : change.status !== 'applied'),
      );
      return changes.length
        ? [
            {
              proposalId: proposal.id,
              expectedVersionId: proposal.versionId,
              changes: changes.map((change) => ({
                changeId: change.id,
                expectedValue:
                  mode === 'undo' ? change.afterValue : change.beforeValue,
              })),
            },
          ]
        : [];
    });
  const submit = (mode: 'apply' | 'undo') =>
    void operation.run(
      async (signal) =>
        AutomationApplyResultSchema.parse(
          await request(
            `/api/libraries/${encodeURIComponent(libraryId)}/automation/proposals/${mode}`,
            {
              method: 'POST',
              body: AutomationApplyRequestSchema.parse({
                items: changesFor(mode),
              }),
              signal,
            },
          ),
        ),
      (result) => {
        onUpdated(
          proposals.map(
            (proposal) =>
              result.proposals.find((item) => item.id === proposal.id) ??
              proposal,
          ),
        );
        setConflicts(result.conflicts);
        setSelected(new Set());
      },
    );
  const fieldLabel = (change: AutomationChange) =>
    t(`field_${change.field === 'tagIds' ? 'tags' : change.field}`);
  const valueLabel = (change: AutomationChange, after: boolean) => {
    if (change.field === 'tagIds')
      return (
        (after
          ? change.afterTagLabels.length
            ? change.afterTagLabels.map((tag) => tag.name)
            : change.suggestedTagNames
          : change.beforeTagLabels.map((tag) => tag.name)
        ).join(' · ') || t('none')
      );
    return String(
      (after ? change.afterValue : change.beforeValue) ?? t('none'),
    );
  };
  return (
    <section className="automation-proposals" aria-label={t('proposals')}>
      <div className="automation-inline automation-sticky">
        <button
          className="button-primary"
          disabled={busy || changesFor('apply').length === 0}
          onClick={() => submit('apply')}
        >
          {t('apply')}
        </button>
        <button
          disabled={busy || changesFor('undo').length === 0}
          onClick={() => submit('undo')}
        >
          {t('undo')}
        </button>
        <button disabled={operation.busy} onClick={onRefresh}>
          {t('refresh')}
        </button>
      </div>
      {operation.error && (
        <p role="alert" className="automation-error">
          {t(operation.error)}
        </p>
      )}
      {conflicts.length > 0 && (
        <div role="alert" className="automation-error">
          <strong>{t('conflicts')}</strong>
          <p>{t('versionConflict')}</p>
          <ul>
            {conflicts.map((conflict) => {
              const proposal = proposals.find(
                (item) => item.id === conflict.proposalId,
              );
              const change = proposal?.changes.find(
                (item) => item.id === conflict.changeId,
              );
              return (
                <li key={conflict.changeId}>
                  {proposal?.sourceName} ·{' '}
                  {change ? fieldLabel(change) : t('proposals')}
                </li>
              );
            })}
          </ul>
        </div>
      )}
      {proposals.length === 0 && (
        <p className="automation-empty">{t('noProposals')}</p>
      )}
      {proposals.map((proposal) => (
        <article className="automation-card" key={proposal.id}>
          <header className="automation-proposal-header">
            <img src={assetUrl(proposal.versionId, 'thumbnail')} alt="" />
            <div>
              <h3>{proposal.sourceName}</h3>
              <a
                href={assetUrl(proposal.versionId, 'file')}
                target="_blank"
                rel="noreferrer"
              >
                {t('source')}
              </a>
              <p className="automation-muted">
                {t(`provider_${proposal.provenance.mode}`)}
                {proposal.provenance.model
                  ? ` · ${proposal.provenance.model}`
                  : ''}
              </p>
            </div>
          </header>
          {proposal.provenance.mode === 'rules' && (
            <p className="automation-hint">{t('ruleMode')}</p>
          )}
          {proposal.provenance.mode === 'caption' && (
            <p className="automation-hint">{t('captionMode')}</p>
          )}
          {proposal.provenance.rawText && (
            <details>
              <summary>{t('rawCaption')}</summary>
              <p className="automation-preserve">
                {proposal.provenance.rawText}
              </p>
            </details>
          )}
          {proposal.caption &&
            proposal.caption !== proposal.provenance.rawText && (
              <p>{proposal.caption}</p>
            )}
          {proposal.changes.map((change) => (
            <div key={change.id} className="automation-change">
              <label>
                <input
                  type="checkbox"
                  checked={selected.has(change.id)}
                  disabled={busy}
                  aria-label={t('selectChange', {
                    field: fieldLabel(change),
                    name: proposal.sourceName,
                  })}
                  onChange={() =>
                    setSelected((previous) => {
                      const next = new Set(previous);
                      if (next.has(change.id)) next.delete(change.id);
                      else next.add(change.id);
                      return next;
                    })
                  }
                />
                <strong>{fieldLabel(change)}</strong>
                <span className="automation-badge">
                  {t(`status_${change.status}`)}
                </span>
              </label>
              <div className="automation-before-after">
                <div>
                  <small>{t('before')}</small>
                  <p>{valueLabel(change, false)}</p>
                </div>
                <span aria-hidden="true">→</span>
                <div>
                  <small>
                    {t(change.status === 'applied' ? 'appliedValue' : 'after')}
                  </small>
                  <p>{valueLabel(change, true)}</p>
                </div>
              </div>
            </div>
          ))}
        </article>
      ))}
    </section>
  );
}
