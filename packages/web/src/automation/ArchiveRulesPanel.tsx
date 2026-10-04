import { automationUrl, useAutomationPage } from './api';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ArchivePreviewSchema,
  ArchiveRuleInputSchema,
  ArchiveRuleSchema,
  ArchiveRuleUpdateSchema,
  ArchiveRulesPageSchema,
  AutomationJobSchema,
  FoldersSchema,
  TagsSchema,
  type ArchivePreview,
  type ArchiveRule,
  type AutomationJob,
  type Folder,
  type Tag,
} from '@cura/shared';
import { request } from '../catalog/api';
import { OrganizationDialog } from '../catalog/OrganizationDialog';
import { OperationError, PageControls } from './common';
import { useOperation } from './useOperation';

export function ArchiveRulesPanel({ libraryId }: { libraryId: string }) {
  const { t } = useTranslation('automation');
  const page = useAutomationPage(
    automationUrl(libraryId, 'archive-rules'),
    ArchiveRulesPageSchema,
  );
  const [selectedId, setSelectedId] = useState('');
  const [editor, setEditor] = useState<ArchiveRule | 'new' | null>(null);
  const rule = page.data.items.find((item) => item.id === selectedId);
  return (
    <div className="automation-record-layout">
      <aside className="automation-record-sidebar">
        <button className="button-primary" onClick={() => setEditor('new')}>
          {t('newRule')}
        </button>
        <OperationError error={page.error} onRetry={page.refresh} />
        {page.loading && <p role="status">{t('loading')}</p>}
        <div className="automation-record-list">
          {page.data.items.map((item) => (
            <button
              key={item.id}
              aria-current={item.id === selectedId ? 'true' : undefined}
              onClick={() => setSelectedId(item.id)}
            >
              {item.name}
            </button>
          ))}
        </div>
        <PageControls
          total={page.data.total}
          offset={page.offset}
          onOffset={page.setOffset}
          disabled={page.loading}
        />
      </aside>
      <div className="automation-detail">
        {rule ? (
          <RuleDetail
            key={`${rule.id}:${rule.revision}`}
            libraryId={libraryId}
            rule={rule}
            onEdit={() => setEditor(rule)}
            onRefresh={page.refresh}
          />
        ) : (
          <p className="automation-empty">
            {page.data.total ? t('chooseRecord') : t('noRules')}
          </p>
        )}
      </div>
      {editor && (
        <RuleEditor
          libraryId={libraryId}
          rule={editor === 'new' ? null : editor}
          onClose={() => setEditor(null)}
          onSaved={(saved) => {
            page.setData((current) => ({
              ...current,
              items: [
                saved,
                ...current.items.filter((item) => item.id !== saved.id),
              ],
            }));
            setSelectedId(saved.id);
            page.setOffset(0);
            setEditor(null);
            page.refresh();
          }}
        />
      )}
    </div>
  );
}
function RuleDetail({
  libraryId,
  rule,
  onEdit,
  onRefresh,
}: {
  libraryId: string;
  rule: ArchiveRule;
  onEdit: () => void;
  onRefresh: () => void;
}) {
  const { t } = useTranslation('automation');
  const operation = useOperation(`${libraryId}:${rule.id}`);
  const [preview, setPreview] = useState<ArchivePreview | null>(null);
  const [job, setJob] = useState<AutomationJob | null>(null);
  const [previewOffset, setPreviewOffset] = useState(0);
  const [deleting, setDeleting] = useState(false);
  const path = automationUrl(libraryId, `archive-rules/${rule.id}`);
  const previewPage = (offset: number) =>
    void operation.run(
      async (signal) =>
        ArchivePreviewSchema.parse(
          await request(`${path}/preview?offset=${offset}&limit=30`, {
            method: 'POST',
            body: { expectedRevision: rule.revision },
            signal,
          }),
        ),
      (result) => {
        setPreview(result);
        setPreviewOffset(offset);
      },
    );
  return (
    <>
      <header className="automation-section-heading">
        <div>
          <h2>{rule.name}</h2>
          <small>
            {t('revision', { number: rule.revision })} · {t('olderThan')}:{' '}
            {rule.filters.olderThanDays} · {t('maxRating')}:{' '}
            {rule.filters.maxRating}
          </small>
        </div>
        <div className="automation-inline">
          <button disabled={operation.busy} onClick={onEdit}>
            {t('edit')}
          </button>
          <button disabled={operation.busy} onClick={() => setDeleting(true)}>
            {t('delete')}
          </button>
        </div>
      </header>
      <p className="automation-hint">{t('ageHint')}</p>
      <div className="automation-inline">
        <button disabled={operation.busy} onClick={() => previewPage(0)}>
          {t('previewRule')}
        </button>
        <button
          className="button-primary"
          disabled={operation.busy || !preview || operation.conflict}
          onClick={() =>
            void operation.run(
              async (signal) =>
                AutomationJobSchema.parse(
                  await request(`${path}/run`, {
                    method: 'POST',
                    body: { expectedRevision: rule.revision },
                    signal,
                  }),
                ),
              (result) => {
                setJob(result);
                setPreview(null);
              },
            )
          }
        >
          {t('runRule')}
        </button>
      </div>
      <OperationError error={operation.error} onRetry={onRefresh} />
      {preview && (
        <>
          <div className="automation-two-column">
            <section className="automation-card">
              <h3>
                {t('eligible')} · {preview.eligibleTotal}
              </h3>
              <ul>
                {preview.eligible.map((asset) => (
                  <li key={asset.assetId}>{asset.name}</li>
                ))}
              </ul>
            </section>
            <section className="automation-card">
              <h3>
                {t('protected')} · {preview.protectedTotal}
              </h3>
              <ul>
                {preview.protected.map((asset) => (
                  <li key={asset.assetId}>{asset.name}</li>
                ))}
              </ul>
            </section>
          </div>
          <PageControls
            total={Math.max(preview.eligibleTotal, preview.protectedTotal)}
            offset={previewOffset}
            onOffset={previewPage}
            disabled={operation.busy}
          />
        </>
      )}
      {job && (
        <section className="automation-card" role="status">
          <h3>{t('archiveResult')}</h3>
          {job.archiveRuleSnapshot && (
            <p>
              {job.archiveRuleSnapshot.name} ·{' '}
              {t('revision', { number: job.archiveRuleSnapshot.revision })}
            </p>
          )}
          <p>
            {t(`status_${job.status}`)} · {job.processed}/{job.total}
          </p>
          <p>
            {t('archived')}:{' '}
            {job.results.filter((result) => result.proposalId !== null).length}{' '}
            · {t('skipped')}:{' '}
            {job.results.filter((result) => result.errorCode !== null).length}
          </p>
          {job.errorCode && <p>{t('saveError')}</p>}
        </section>
      )}
      {deleting && (
        <OrganizationDialog
          title={t('deleteRule', { name: rule.name })}
          submitLabel={t('delete')}
          danger
          onClose={() => setDeleting(false)}
          onSubmit={() =>
            operation.run(
              (signal) =>
                request(path, {
                  method: 'DELETE',
                  body: { expectedRevision: rule.revision },
                  signal,
                }),
              () => {
                setDeleting(false);
                onRefresh();
              },
            )
          }
        >
          <p>{t('deleteRuleConfirm')}</p>
          <OperationError error={operation.error} />
        </OrganizationDialog>
      )}
    </>
  );
}
function RuleEditor({
  libraryId,
  rule,
  onClose,
  onSaved,
}: {
  libraryId: string;
  rule: ArchiveRule | null;
  onClose: () => void;
  onSaved: (rule: ArchiveRule) => void;
}) {
  const { t } = useTranslation('automation');
  const [name, setName] = useState(rule?.name ?? '');
  const [enabled, setEnabled] = useState(rule?.enabled ?? false);
  const [filters, setFilters] = useState(
    rule?.filters ?? {
      olderThanDays: 30,
      folderId: null,
      tagIds: [],
      maxRating: 5,
    },
  );
  const [folders, setFolders] = useState<Folder[]>([]);
  const [tags, setTags] = useState<Tag[]>([]);
  const [error, setError] = useState(false);
  const [optionsRetry, setOptionsRetry] = useState(0);
  const operation = useOperation(`${libraryId}:${rule?.id ?? 'new'}`);
  useEffect(() => {
    const abort = new AbortController();
    void Promise.all([
      request(`/api/libraries/${libraryId}/folders`, {
        signal: abort.signal,
      }).then((value) => FoldersSchema.parse(value)),
      request(`/api/libraries/${libraryId}/tags`, {
        signal: abort.signal,
      }).then((value) => TagsSchema.parse(value)),
    ])
      .then(([nextFolders, nextTags]) => {
        if (!abort.signal.aborted) {
          setFolders(nextFolders);
          setError(false);
          setTags(nextTags);
        }
      })
      .catch(() => {
        if (!abort.signal.aborted) setError(true);
      });
    return () => abort.abort();
  }, [libraryId, optionsRetry]);
  return (
    <OrganizationDialog
      title={t(rule ? 'edit' : 'newRule')}
      submitLabel={t('save')}
      disabled={operation.conflict}
      onClose={onClose}
      onSubmit={() =>
        operation.run(async (signal) => {
          const fields = { name, enabled, filters };
          const body = rule
            ? ArchiveRuleUpdateSchema.parse({
                ...fields,
                expectedRevision: rule.revision,
              })
            : ArchiveRuleInputSchema.parse(fields);
          return ArchiveRuleSchema.parse(
            await request(
              automationUrl(
                libraryId,
                `archive-rules${rule ? `/${rule.id}` : ''}`,
              ),
              { method: rule ? 'PATCH' : 'POST', body, signal },
            ),
          );
        }, onSaved)
      }
    >
      <label className="form-field">
        <span>{t('ruleName')}</span>
        <input
          required
          maxLength={200}
          value={name}
          onChange={(event) => setName(event.target.value)}
        />
      </label>
      <label>
        <input
          type="checkbox"
          checked={enabled}
          onChange={(event) => setEnabled(event.target.checked)}
        />
        {t('enabled')}
      </label>
      <p className="automation-hint">{t('enabledHint')}</p>
      <div className="automation-two-column">
        <label className="form-field">
          <span>{t('olderThan')}</span>
          <input
            type="number"
            min="0"
            max="36500"
            step="any"
            required
            value={filters.olderThanDays}
            onChange={(event) =>
              setFilters({
                ...filters,
                olderThanDays: Number(event.target.value),
              })
            }
          />
        </label>
        <label className="form-field">
          <span>{t('maxRating')}</span>
          <select
            value={filters.maxRating}
            onChange={(event) =>
              setFilters({ ...filters, maxRating: Number(event.target.value) })
            }
          >
            {[0, 1, 2, 3, 4, 5].map((rating) => (
              <option key={rating}>{rating}</option>
            ))}
          </select>
        </label>
      </div>
      <label className="form-field">
        <span>{t('folder')}</span>
        <select
          value={filters.folderId ?? ''}
          onChange={(event) =>
            setFilters({ ...filters, folderId: event.target.value || null })
          }
        >
          <option value="">{t('allFolders')}</option>
          {folders.map((folder) => (
            <option key={folder.id} value={folder.id}>
              {folder.name}
            </option>
          ))}
        </select>
      </label>
      <fieldset>
        <legend>{t('requiredTags')}</legend>
        {tags.map((tag) => (
          <label key={tag.id}>
            <input
              type="checkbox"
              checked={filters.tagIds.includes(tag.id)}
              onChange={(event) =>
                setFilters({
                  ...filters,
                  tagIds: event.target.checked
                    ? [...filters.tagIds, tag.id]
                    : filters.tagIds.filter((id) => id !== tag.id),
                })
              }
            />
            {tag.name}
          </label>
        ))}
      </fieldset>
      <OperationError
        error={error}
        onRetry={() => setOptionsRetry((value) => value + 1)}
      />
      <OperationError
        error={operation.error}
        onRetry={
          operation.conflict && rule
            ? () =>
                void operation.run(async (signal) => {
                  let offset = 0;
                  while (true) {
                    const result = ArchiveRulesPageSchema.parse(
                      await request(
                        `${automationUrl(libraryId, 'archive-rules')}?offset=${offset}&limit=100`,
                        { signal },
                      ),
                    );
                    const latest = result.items.find(
                      (item) => item.id === rule.id,
                    );
                    if (latest) return latest;
                    offset += 100;
                    if (offset >= result.total)
                      throw new Error('Rule no longer exists');
                  }
                }, onSaved)
            : undefined
        }
      />
    </OrganizationDialog>
  );
}
