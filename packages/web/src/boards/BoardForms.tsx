import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { CreateBoard, SlotTemplate } from '@cura/shared';
import { OrganizationDialog } from '../catalog/OrganizationDialog';

export function BoardCreateForm({
  templates,
  onClose,
  onCreate,
}: {
  templates: SlotTemplate[];
  onClose: () => void;
  onCreate: (input: CreateBoard) => Promise<void>;
}) {
  const { t } = useTranslation('boards');
  const [name, setName] = useState('');
  const [kind, setKind] = useState<'canvas' | 'matrix'>('canvas');
  const [templateId, setTemplateId] = useState('');
  const [matrixPreset, setMatrixPreset] = useState<
    'character-angle' | 'scene-option'
  >('character-angle');
  return (
    <OrganizationDialog
      title={t('newBoard')}
      onClose={onClose}
      submitLabel={t('create')}
      disabled={!name.trim()}
      onSubmit={async () => {
        const rows = [1, 2].map((number) => ({
          id: crypto.randomUUID(),
          label: t(matrixPreset === 'character-angle' ? 'character' : 'scene', {
            number,
          }),
        }));
        const columns =
          matrixPreset === 'character-angle'
            ? ['reference', 'closeUp', 'wide', 'angle35'].map((key) => ({
                id: crypto.randomUUID(),
                label: t(key),
              }))
            : [1, 2].map((number) => ({
                id: crypto.randomUUID(),
                label: t('option', { number }),
              }));
        await onCreate({
          name: name.trim(),
          kind,
          ...(kind === 'canvas'
            ? templateId
              ? { templateId }
              : {}
            : { matrixPreset, rows, columns }),
        });
      }}
    >
      <label>
        {t('boardName')}
        <input
          autoComplete="off"
          required
          maxLength={255}
          value={name}
          onChange={(event) => setName(event.target.value)}
        />
      </label>
      <label>
        {t('boardType')}
        <select
          value={kind}
          onChange={(event) =>
            setKind(event.target.value as 'canvas' | 'matrix')
          }
        >
          <option value="canvas">{t('canvas')}</option>
          <option value="matrix">{t('matrix')}</option>
        </select>
      </label>
      {kind === 'canvas' ? (
        <label>
          {t('template')}
          <select
            value={templateId}
            onChange={(event) => setTemplateId(event.target.value)}
          >
            <option value="">{t('blankCanvas')}</option>
            {templates.map((template) => (
              <option key={template.id} value={template.id}>
                {template.preset
                  ? t(`preset_${template.preset}`)
                  : template.name}
              </option>
            ))}
          </select>
        </label>
      ) : (
        <label>
          {t('matrixPreset')}
          <select
            value={matrixPreset}
            onChange={(event) =>
              setMatrixPreset(
                event.target.value as 'character-angle' | 'scene-option',
              )
            }
          >
            <option value="character-angle">{t('characterAngles')}</option>
            <option value="scene-option">{t('sceneOptions')}</option>
          </select>
        </label>
      )}
    </OrganizationDialog>
  );
}

export function NameForm({
  title,
  label,
  initial = '',
  onClose,
  onSave,
}: {
  title: string;
  label: string;
  initial?: string;
  onClose: () => void;
  onSave: (name: string) => Promise<void>;
}) {
  const [name, setName] = useState(initial);
  const { t } = useTranslation('boards');
  return (
    <OrganizationDialog
      title={title}
      onClose={onClose}
      submitLabel={t('save')}
      disabled={!name.trim()}
      onSubmit={() => onSave(name.trim())}
    >
      <label>
        {label}
        <input
          required
          maxLength={255}
          value={name}
          onChange={(event) => setName(event.target.value)}
        />
      </label>
    </OrganizationDialog>
  );
}

export function DeleteConfirm({
  name,
  hint,
  onClose,
  onConfirm,
}: {
  name: string;
  hint: string;
  onClose: () => void;
  onConfirm: () => Promise<void>;
}) {
  const { t } = useTranslation('boards');
  return (
    <OrganizationDialog
      title={t('confirmDelete', { name })}
      onClose={onClose}
      submitLabel={t('delete')}
      danger
      onSubmit={onConfirm}
    >
      <p>{hint}</p>
    </OrganizationDialog>
  );
}
