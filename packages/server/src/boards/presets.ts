import { BUILT_IN_SLOT_TEMPLATES, type SlotTemplate } from '@cura/shared';

export const boardPresets = Object.entries(BUILT_IN_SLOT_TEMPLATES).map(
  ([preset, template]) => ({
    name: template.name,
    preset: preset as NonNullable<SlotTemplate['preset']>,
    slots: template.slots.map(({ key, label }, index) => ({
      key,
      label,
      x: (index % 2) * 280 + 20,
      y: Math.floor(index / 2) * 220 + 20,
      width: 240,
      height: 180,
    })),
  }),
);
