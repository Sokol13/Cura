import { automationUrl, useAutomationPage } from './api';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ScriptsPageSchema,
  SettingDocumentInputSchema,
  SettingDocumentSchema,
  SettingDocumentsPageSchema,
  type SettingDocument,
} from '@cura/shared';
import { request } from '../catalog/api';
import { OrganizationDialog } from '../catalog/OrganizationDialog';
import { AssetPicker, type AssetChoice } from './AssetPicker';
import { DocumentEditor } from './DocumentEditor';
import { useOperation } from './useOperation';
import { OperationError, PageControls } from './common';

export function DocumentsPanel({ libraryId }: { libraryId: string }) {
  const { t } = useTranslation('automation');
  const page = useAutomationPage(
    automationUrl(libraryId, 'documents'),
    SettingDocumentsPageSchema,
  );
  const [selectedId, setSelectedId] = useState('');
  const [creating, setCreating] = useState(false);
  const document = page.data.items.find((item) => item.id === selectedId);
  const accept = (next: SettingDocument) => {
    page.setData((current) => ({
      ...current,
      items: [next, ...current.items.filter((item) => item.id !== next.id)],
    }));
    setSelectedId(next.id);
    setCreating(false);
  };
  return (
    <div className="automation-record-layout">
      <aside className="automation-record-sidebar">
        <button className="button-primary" onClick={() => setCreating(true)}>
          {t('newDocument')}
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
              {item.title}
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
        {document ? (
          <DocumentEditor
            key={`${document.id}:${document.revision}`}
            libraryId={libraryId}
            document={document}
            onSaved={accept}
          />
        ) : (
          <p className="automation-empty">
            {page.data.total ? t('chooseRecord') : t('noDocuments')}
          </p>
        )}
      </div>
      {creating && (
        <NewDocument
          libraryId={libraryId}
          onClose={() => setCreating(false)}
          onCreated={(created) => {
            accept(created);
            page.setOffset(0);
            page.refresh();
          }}
        />
      )}
    </div>
  );
}
function NewDocument({
  libraryId,
  onClose,
  onCreated,
}: {
  libraryId: string;
  onClose: () => void;
  onCreated: (document: SettingDocument) => void;
}) {
  const { t, i18n } = useTranslation('automation');
  const [title, setTitle] = useState('');
  const [kind, setKind] = useState('general');
  const [language, setLanguage] = useState(
    i18n.language === 'en' ? 'en' : 'zh-CN',
  );
  const [pins, setPins] = useState<AssetChoice[]>([]);
  const [scriptId, setScriptId] = useState('');
  const [entityIds, setEntityIds] = useState<string[]>([]);
  const scripts = useAutomationPage(
    automationUrl(libraryId, 'scripts'),
    ScriptsPageSchema,
  );
  const script = scripts.data.items.find((item) => item.id === scriptId);
  const operation = useOperation(libraryId);
  return (
    <OrganizationDialog
      title={t('newDocument')}
      submitLabel={t('createDocument')}
      onClose={onClose}
      disabled={pins.length === 0}
      onSubmit={() =>
        operation.run(
          async (signal) =>
            SettingDocumentSchema.parse(
              await request(automationUrl(libraryId, 'documents'), {
                method: 'POST',
                body: SettingDocumentInputSchema.parse({
                  title,
                  kind,
                  language,
                  pins: pins.map(({ assetId, versionId }) => ({
                    assetId,
                    versionId,
                  })),
                  ...(scriptId ? { scriptId, entityIds } : {}),
                }),
                signal,
              }),
            ),
          onCreated,
        )
      }
    >
      <p className="automation-hint">{t('documentHint')}</p>
      <label className="form-field">
        <span>{t('titleField')}</span>
        <input
          required
          maxLength={200}
          value={title}
          onChange={(event) => setTitle(event.target.value)}
        />
      </label>
      <div className="automation-two-column">
        <label className="form-field">
          <span>{t('documentKind')}</span>
          <select
            value={kind}
            onChange={(event) => setKind(event.target.value)}
          >
            {['general', 'character', 'scene', 'prop'].map((entry) => (
              <option key={entry} value={entry}>
                {t(`entity_${entry}`)}
              </option>
            ))}
          </select>
        </label>
        <label className="form-field">
          <span>{t('language')}</span>
          <select
            value={language}
            onChange={(event) => setLanguage(event.target.value)}
          >
            <option value="en">{t('language_en')}</option>
            <option value="zh-CN">{t('language_zh')}</option>
          </select>
        </label>
      </div>
      <AssetPicker
        libraryId={libraryId}
        value={pins}
        onChange={setPins}
        history
        disabled={operation.busy}
      />
      <label className="form-field">
        <span>{t('scriptReference')}</span>
        <select
          value={scriptId}
          onChange={(event) => {
            setScriptId(event.target.value);
            setEntityIds([]);
          }}
        >
          <option value="">{t('noScript')}</option>
          {scripts.data.items.map((entry) => (
            <option key={entry.id} value={entry.id}>
              {entry.title}
            </option>
          ))}
        </select>
      </label>
      <OperationError error={scripts.error} onRetry={scripts.refresh} />
      {scripts.data.total > 30 && (
        <PageControls
          total={scripts.data.total}
          offset={scripts.offset}
          onOffset={(offset) => {
            scripts.setOffset(offset);
            setScriptId('');
            setEntityIds([]);
          }}
          disabled={scripts.loading}
        />
      )}
      <div className="automation-entity-choices">
        {script?.entities.map((entity) => (
          <label key={entity.id}>
            <input
              type="checkbox"
              disabled={
                !entityIds.includes(entity.id) && entityIds.length >= 100
              }
              checked={entityIds.includes(entity.id)}
              onChange={(event) =>
                setEntityIds(
                  event.target.checked
                    ? [...entityIds, entity.id]
                    : entityIds.filter((id) => id !== entity.id),
                )
              }
            />
            {entity.name} · {t(`entity_${entity.kind}`)}
          </label>
        ))}
      </div>
      <OperationError error={operation.error} />
    </OrganizationDialog>
  );
}
