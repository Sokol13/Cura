import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { SlotTemplate, TemplateSlot } from '@cura/shared';
import { request } from '../catalog/api';
import { OrganizationDialog } from '../catalog/OrganizationDialog';
import { DeleteConfirm } from './BoardForms';

export function TemplateManager({
  libraryId,
  templates,
  onClose,
  onChanged,
}: {
  libraryId: string;
  templates: SlotTemplate[];
  onClose: () => void;
  onChanged: () => Promise<void>;
}) {
  const { t } = useTranslation('boards');
  const [editing, setEditing] = useState<SlotTemplate | 'new' | null>(null);
  const [deleting, setDeleting] = useState<SlotTemplate | null>(null);
  if (editing)
    return (
      <TemplateEditor
        template={editing === 'new' ? null : editing}
        libraryId={libraryId}
        onClose={() => setEditing(null)}
        onSaved={async () => {
          await onChanged();
          setEditing(null);
        }}
      />
    );
  if (deleting)
    return (
      <DeleteConfirm
        name={deleting.name}
        hint={t('deleteTemplateHint')}
        onClose={() => setDeleting(null)}
        onConfirm={async () => {
          try {
            await request(`/api/slot-templates/${deleting.id}`, {
              method: 'DELETE',
            });
            await onChanged();
            setDeleting(null);
          } catch {
            throw new Error(t('saveError'));
          }
        }}
      />
    );
  return (
    <OrganizationDialog
      title={t('templates')}
      onClose={onClose}
      submitLabel={t('close')}
      onSubmit={async () => onClose()}
    >
      <p className="board-muted">{t('chooseTemplate')}</p>
      <div className="board-template-list">
        {templates.map((template) => (
          <article key={template.id}>
            <div className="board-template-icon">▦</div>
            <div>
              <strong>
                {template.preset
                  ? t(`preset_${template.preset}`)
                  : template.name}
              </strong>
              <small>
                {template.slots.length} {t('frames')} ·{' '}
                {t(template.preset ? 'preset' : 'custom')}
              </small>
              {template.preset && (
                <p className="board-muted">
                  {t(`preset_${template.preset}_description`)}
                </p>
              )}
            </div>
            {!template.preset && (
              <div className="board-inline-actions">
                <button
                  type="button"
                  aria-label={`${t('editTemplate')} · ${template.name}`}
                  onClick={() => setEditing(template)}
                >
                  {t('editTemplate')}
                </button>
                <button
                  type="button"
                  aria-label={`${t('deleteTemplate')} · ${template.name}`}
                  onClick={() => setDeleting(template)}
                >
                  ×
                </button>
              </div>
            )}
          </article>
        ))}
      </div>
      <button
        type="button"
        className="primary"
        onClick={() => setEditing('new')}
      >
        <span aria-hidden="true">＋</span> {t('newTemplate')}
      </button>
    </OrganizationDialog>
  );
}

function TemplateEditor({
  template,
  libraryId,
  onClose,
  onSaved,
}: {
  template: SlotTemplate | null;
  libraryId: string;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const { t } = useTranslation('boards');
  const makeSlot = (index: number): TemplateSlot => ({
    key: crypto.randomUUID(),
    label: t('frameNumber', { number: index + 1 }),
    x: (index % 3) * 280,
    y: Math.floor(index / 3) * 240,
    width: 240,
    height: 200,
  });
  const [name, setName] = useState(template?.name ?? '');
  const [slots, setSlots] = useState<TemplateSlot[]>(
    () => template?.slots ?? [makeSlot(0)],
  );
  const update = (key: string, patch: Partial<TemplateSlot>) =>
    setSlots((previous) =>
      previous.map((slot) => (slot.key === key ? { ...slot, ...patch } : slot)),
    );
  return (
    <OrganizationDialog
      title={t(template ? 'editTemplate' : 'newTemplate')}
      onClose={onClose}
      submitLabel={t('save')}
      disabled={
        !name.trim() ||
        !slots.length ||
        slots.some((slot) => !slot.label.trim())
      }
      onSubmit={async () => {
        try {
          await request(
            template
              ? `/api/slot-templates/${template.id}`
              : `/api/libraries/${libraryId}/slot-templates`,
            {
              method: template ? 'PATCH' : 'POST',
              body: { name: name.trim(), slots },
            },
          );
          await onSaved();
        } catch {
          throw new Error(t('saveError'));
        }
      }}
    >
      <label>
        {t('templateName')}
        <input
          required
          maxLength={255}
          value={name}
          onChange={(event) => setName(event.target.value)}
        />
      </label>
      <div className="board-template-fields">
        {slots.map((slot, index) => (
          <fieldset key={slot.key}>
            <legend>{t('frameNumber', { number: index + 1 })}</legend>
            <label>
              {t('frameLabel')}
              <input
                required
                maxLength={255}
                value={slot.label}
                onChange={(event) =>
                  update(slot.key, { label: event.target.value })
                }
              />
            </label>
            <div className="board-dimension-fields">
              {(['x', 'y', 'width', 'height'] as const).map((field) => (
                <label key={field}>
                  {field === 'x' || field === 'y'
                    ? field.toUpperCase()
                    : t(field)}
                  <input
                    type="number"
                    required
                    min={
                      field === 'width' || field === 'height' ? 20 : -10000000
                    }
                    max={
                      field === 'width' || field === 'height' ? 20000 : 10000000
                    }
                    value={slot[field]}
                    onChange={(event) =>
                      update(slot.key, {
                        [field]: event.target.valueAsNumber || 0,
                      })
                    }
                  />
                </label>
              ))}
            </div>
            <button
              type="button"
              disabled={slots.length === 1}
              aria-label={`${t('removeFrame')} ${index + 1}`}
              onClick={() =>
                setSlots((previous) =>
                  previous.filter((entry) => entry.key !== slot.key),
                )
              }
            >
              {t('removeFrame')}
            </button>
          </fieldset>
        ))}
      </div>
      <button
        type="button"
        onClick={() =>
          setSlots((previous) => [...previous, makeSlot(previous.length)])
        }
      >
        {t('addFrame')}
      </button>
    </OrganizationDialog>
  );
}
