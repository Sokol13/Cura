import { createContext, useCallback, useContext } from 'react';
import { useTranslation } from 'react-i18next';
import {
  BUILT_IN_SLOT_TEMPLATES,
  type Board,
  type BoardSlot,
  type SlotTemplate,
} from '@cura/shared';
import './i18n';

type Preset = SlotTemplate['preset'];
export const PresetContext = createContext<Preset>(null);
export function boardPreset(
  board: Board | undefined,
  templates: SlotTemplate[],
): Preset {
  return (
    templates.find(
      (template) =>
        template.id === board?.templateId &&
        template.libraryId === board.libraryId,
    )?.preset ?? null
  );
}
function usePresentation(preset: Preset) {
  const { t } = useTranslation('boards');
  return useCallback(
    (slot: BoardSlot): { label: string; description?: string } => {
      const frame =
        preset &&
        BUILT_IN_SLOT_TEMPLATES[preset].slots.find(
          (candidate) =>
            candidate.key === slot.templateKey &&
            candidate.label === slot.label,
        );
      // Custom template keys and user-renamed built-in frames remain user text.
      return frame
        ? {
            label: t(`presetSlot_${frame.key}`, { defaultValue: frame.label }),
            description: t(`presetSlot_${frame.key}_description`),
          }
        : { label: slot.label };
    },
    [preset, t],
  );
}
export function useSlotPresentation() {
  return usePresentation(useContext(PresetContext));
}
export function useBoardSlotPresentation(
  board: Board | undefined,
  templates: SlotTemplate[],
) {
  return usePresentation(boardPreset(board, templates));
}
