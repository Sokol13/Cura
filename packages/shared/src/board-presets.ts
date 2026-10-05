import type { SlotTemplate } from './boards.js';

// Stable persisted labels identify untouched built-in frames in existing boards.
export const BUILT_IN_SLOT_TEMPLATES = {
  character: {
    name: 'Character',
    slots: [
      { key: 'reference', label: 'Reference' },
      { key: 'close', label: 'Close-up' },
      { key: 'wide', label: 'Wide shot' },
      { key: 'angle35', label: '35° view' },
    ],
  },
  scene: {
    name: 'Scene',
    slots: [
      { key: 'overview', label: 'Overview' },
      { key: 'detail', label: 'Detail' },
      { key: 'option', label: 'Option' },
    ],
  },
  product: {
    name: 'Product',
    slots: [
      { key: 'white', label: 'White model' },
      { key: 'clay', label: 'Clay render' },
      { key: 'ai', label: 'AI render' },
    ],
  },
  brand: {
    name: 'Brand',
    slots: [
      { key: 'horizontal', label: 'Horizontal logo' },
      { key: 'vertical', label: 'Vertical logo' },
      { key: 'monochrome', label: 'Monochrome logo' },
    ],
  },
} as const satisfies Record<
  NonNullable<SlotTemplate['preset']>,
  { name: string; slots: readonly { key: string; label: string }[] }
>;
