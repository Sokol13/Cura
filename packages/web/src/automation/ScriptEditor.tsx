import { automationUrl } from './api';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ScriptBreakdownSchema,
  ScriptUpdateSchema,
  type ScriptBreakdown,
  type ScriptEntityInput,
} from '@cura/shared';
import { assetUrl, request } from '../catalog/api';
import { useOperation } from './useOperation';
import { OperationError } from './common';

export function ScriptEditor({
  libraryId,
  script,
  onSaved,
  disabled = false,
}: {
  libraryId: string;
  script: ScriptBreakdown;
  onSaved: (script: ScriptBreakdown) => void;
  disabled?: boolean;
}) {
  const { t } = useTranslation('automation');
  const [title, setTitle] = useState(script.title);
  const [entities, setEntities] = useState<
    (ScriptEntityInput & { localKey: string })[]
  >(
    script.entities.map((entity) => ({
      id: entity.id,
      localKey: entity.id,
      kind: entity.kind,
      name: entity.name,
      notes: entity.notes,
      ranges: entity.references.map(({ startLine, endLine }) => ({
        startLine,
        endLine,
      })),
    })),
  );
  const operation = useOperation(`${libraryId}:${script.id}`);
  const path = automationUrl(libraryId, `scripts/${script.id}`);
  const update = (index: number, change: Partial<ScriptEntityInput>) =>
    setEntities((current) =>
      current.map((entity, position) =>
        position === index ? { ...entity, ...change } : entity,
      ),
    );
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        void operation.run(
          async (signal) =>
            ScriptBreakdownSchema.parse(
              await request(path, {
                method: 'PATCH',
                body: ScriptUpdateSchema.parse({
                  expectedRevision: script.revision,
                  title,
                  entities: entities.map(
                    ({ id, kind, name, notes, ranges }) => ({
                      ...(id ? { id } : {}),
                      kind,
                      name,
                      notes,
                      ranges,
                    }),
                  ),
                }),
                signal,
              }),
            ),
          onSaved,
        );
      }}
    >
      <header className="automation-section-heading">
        <div>
          <h2>{script.title}</h2>
          <p className="automation-muted">
            {t('revision', { number: script.revision })} · {t('parser')}:{' '}
            {script.provenance.kind === 'structured-script'
              ? t('structuredParser')
              : (script.provenance.model ?? script.provenance.providerId)}
          </p>
        </div>
        <a href={assetUrl(script.sourcePin.versionId, 'file')} download>
          {t('downloadSource')}
        </a>
      </header>
      <fieldset
        disabled={disabled || operation.busy}
        className="automation-editor-fields"
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
        <div className="automation-section-heading">
          <h3>
            {t('entities')} · {entities.length}
          </h3>
          <button
            type="button"
            disabled={entities.length >= 1000}
            onClick={() =>
              setEntities((current) => [
                ...current,
                {
                  localKey: crypto.randomUUID(),
                  kind: 'character',
                  name: '',
                  notes: '',
                  ranges: [],
                },
              ])
            }
          >
            {t('addEntity')}
          </button>
        </div>
        {entities.map((entity, index) => (
          <article
            className="automation-card automation-entity"
            key={entity.localKey}
          >
            <div className="automation-entity-heading">
              <label className="form-field">
                <span>{t('entityKind')}</span>
                <select
                  value={entity.kind}
                  onChange={(event) =>
                    update(index, {
                      kind: event.target.value as ScriptEntityInput['kind'],
                    })
                  }
                >
                  {(['character', 'prop', 'scene'] as const).map((kind) => (
                    <option key={kind} value={kind}>
                      {t(`entity_${kind}`)}
                    </option>
                  ))}
                </select>
              </label>
              <label className="form-field">
                <span>{t('entityName')}</span>
                <input
                  required
                  maxLength={200}
                  value={entity.name}
                  onChange={(event) =>
                    update(index, { name: event.target.value })
                  }
                />
              </label>
              <button
                type="button"
                aria-label={t('removeEntity', { name: entity.name })}
                onClick={() =>
                  setEntities((current) =>
                    current.filter((_, position) => position !== index),
                  )
                }
              >
                ×
              </button>
            </div>
            <label className="form-field">
              <span>{t('notes')}</span>
              <textarea
                maxLength={10000}
                rows={2}
                value={entity.notes ?? ''}
                onChange={(event) =>
                  update(index, { notes: event.target.value })
                }
              />
            </label>
            {entity.ranges.map((range, rangeIndex) => (
              <div key={rangeIndex} className="automation-source-range">
                <div className="automation-inline">
                  <label className="form-field">
                    <span>{t('startLine')}</span>
                    <input
                      required
                      type="number"
                      min="1"
                      max={script.lineCount}
                      value={range.startLine}
                      onChange={(event) =>
                        update(index, {
                          ranges: entity.ranges.map((item, position) =>
                            position === rangeIndex
                              ? {
                                  ...item,
                                  startLine: Number(event.target.value),
                                }
                              : item,
                          ),
                        })
                      }
                    />
                  </label>
                  <label className="form-field">
                    <span>{t('endLine')}</span>
                    <input
                      required
                      type="number"
                      min={range.startLine}
                      max={script.lineCount}
                      value={range.endLine}
                      onChange={(event) =>
                        update(index, {
                          ranges: entity.ranges.map((item, position) =>
                            position === rangeIndex
                              ? { ...item, endLine: Number(event.target.value) }
                              : item,
                          ),
                        })
                      }
                    />
                  </label>
                  <button
                    type="button"
                    aria-label={t('removeRange')}
                    onClick={() =>
                      update(index, {
                        ranges: entity.ranges.filter(
                          (_, position) => position !== rangeIndex,
                        ),
                      })
                    }
                  >
                    ×
                  </button>
                </div>
                {script.entities
                  .find((item) => item.id === entity.id)
                  ?.references.filter(
                    (reference) =>
                      reference.startLine === range.startLine &&
                      reference.endLine === range.endLine,
                  )
                  .map((reference, position) => (
                    <blockquote key={position} aria-label={t('excerpt')}>
                      {reference.excerpt}
                    </blockquote>
                  ))}
              </div>
            ))}
            <button
              type="button"
              disabled={entity.ranges.length >= 100}
              onClick={() =>
                update(index, {
                  ranges: [...entity.ranges, { startLine: 1, endLine: 1 }],
                })
              }
            >
              {t('addRange')}
            </button>
          </article>
        ))}
        <div className="automation-inline">
          <button className="button-primary" disabled={operation.conflict}>
            {t('save')}
          </button>
        </div>
      </fieldset>
      <OperationError
        error={operation.error}
        onRetry={
          operation.conflict
            ? () =>
                void operation.run(
                  async (signal) =>
                    ScriptBreakdownSchema.parse(
                      await request(path, { signal }),
                    ),
                  onSaved,
                )
            : undefined
        }
      />
    </form>
  );
}
