import type { SlotTemplate, TemplateSlot } from '@cura/shared';

function frames(labels: Array<[string, string]>): TemplateSlot[] {
  return labels.map(([key, label], index) => ({
    key,
    label,
    x: (index % 2) * 280 + 20,
    y: Math.floor(index / 2) * 220 + 20,
    width: 240,
    height: 180,
  }));
}
export const boardPresets: Array<{
  name: string;
  preset: NonNullable<SlotTemplate['preset']>;
  slots: TemplateSlot[];
}> = [
  {
    name: 'Character',
    preset: 'character',
    slots: frames([
      ['reference', 'Reference'],
      ['close', 'Close-up'],
      ['wide', 'Wide shot'],
      ['angle35', '35° view'],
    ]),
  },
  {
    name: 'Scene',
    preset: 'scene',
    slots: frames([
      ['overview', 'Overview'],
      ['detail', 'Detail'],
      ['option', 'Option'],
    ]),
  },
  {
    name: 'Product',
    preset: 'product',
    slots: frames([
      ['white', 'White model'],
      ['clay', 'Clay render'],
      ['ai', 'AI render'],
    ]),
  },
  {
    name: 'Brand',
    preset: 'brand',
    slots: frames([
      ['horizontal', 'Horizontal logo'],
      ['vertical', 'Vertical logo'],
      ['monochrome', 'Monochrome logo'],
    ]),
  },
];
