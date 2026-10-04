import { automationUrl } from './api';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  SettingDocumentSchema,
  SettingDocumentUpdateSchema,
  type SettingDocument,
} from '@cura/shared';
import { assetUrl, request } from '../catalog/api';
import { OperationError } from './common';
import { useOperation } from './useOperation';

export function DocumentEditor({
  libraryId,
  document,
  onSaved,
}: {
  libraryId: string;
  document: SettingDocument;
  onSaved: (document: SettingDocument) => void;
}) {
  const { t } = useTranslation('automation');
  const [title, setTitle] = useState(document.title);
  const [markdown, setMarkdown] = useState(document.markdown);
  const operation = useOperation(`${libraryId}:${document.id}`);
  const path = automationUrl(libraryId, `documents/${document.id}`);
  return (
    <>
      <header className="automation-section-heading">
        <div>
          <h2>{document.title}</h2>
          <small>
            {t('revision', { number: document.revision })} ·{' '}
            {t(
              title !== document.title || markdown !== document.markdown
                ? 'unsaved'
                : 'saved',
            )}
          </small>
        </div>
        <div className="automation-inline">
          <a href={`${path}/export?format=markdown`} download>
            {t('downloadMarkdown')}
          </a>
          <a href={`${path}/export?format=json`} download>
            {t('downloadJson')}
          </a>
        </div>
      </header>
      <div className="automation-document-layout">
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void operation.run(
              async (signal) =>
                SettingDocumentSchema.parse(
                  await request(path, {
                    method: 'PATCH',
                    body: SettingDocumentUpdateSchema.parse({
                      expectedRevision: document.revision,
                      title,
                      markdown,
                    }),
                    signal,
                  }),
                ),
              onSaved,
            );
          }}
        >
          <fieldset
            className="automation-editor-fields"
            disabled={operation.busy}
          >
            <label className="form-field">
              <span>{t('titleField')}</span>
              <input
                required
                maxLength={200}
                value={title}
                onChange={(event) => setTitle(event.target.value)}
              />
            </label>
            <label className="form-field">
              <span>{t('markdown')}</span>
              <textarea
                className="automation-markdown"
                value={markdown}
                maxLength={1000000}
                onChange={(event) => setMarkdown(event.target.value)}
              />
            </label>
            <button className="button-primary" disabled={operation.conflict}>
              {t('save')}
            </button>
          </fieldset>
          <OperationError
            error={operation.error}
            onRetry={
              operation.conflict
                ? () =>
                    void operation.run(
                      async (signal) =>
                        SettingDocumentSchema.parse(
                          await request(path, { signal }),
                        ),
                      onSaved,
                    )
                : undefined
            }
          />
        </form>
        <aside className="automation-document-sources">
          <h3>{t('pinnedSources')}</h3>
          <p className="automation-hint">{t('copiedMetadata')}</p>
          {document.sources.map((source) => (
            <article
              className="automation-card"
              key={`${source.assetId}:${source.versionId}`}
            >
              <a
                href={assetUrl(source.versionId, 'file')}
                target="_blank"
                rel="noreferrer"
              >
                <img src={assetUrl(source.versionId, 'thumbnail')} alt="" />
                <strong>{source.name}</strong>
              </a>
              <dl>
                <dt>{t('prompt')}</dt>
                <dd>{source.prompt || t('none')}</dd>
                <dt>{t('model')}</dt>
                <dd>{source.model || t('none')}</dd>
                <dt>{t('seed')}</dt>
                <dd>{source.seed || t('none')}</dd>
                <dt>{t('notes')}</dt>
                <dd>{source.note || t('none')}</dd>
              </dl>
              <details>
                <summary>{t('provenance')}</summary>
                <small className="automation-hash">
                  {source.versionId}
                  <br />
                  {source.hash}
                </small>
              </details>
            </article>
          ))}
          {document.entities.length > 0 && (
            <section>
              <h3>{t('scriptReference')}</h3>
              {document.entities.map((entity) => (
                <article key={entity.id} className="automation-card">
                  <strong>{entity.name}</strong>
                  <p>{entity.notes}</p>
                  {entity.references.map((reference, index) => (
                    <blockquote key={index}>
                      <small>
                        {reference.startLine}–{reference.endLine}
                      </small>
                      <br />
                      {reference.excerpt}
                    </blockquote>
                  ))}
                </article>
              ))}
            </section>
          )}
        </aside>
      </div>
    </>
  );
}
