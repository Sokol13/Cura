import type { ReactNode } from 'react';
import type { Board, SlotTemplate } from '@cura/shared';
import { boardPreset, PresetContext } from './template-presentation';

export function TemplatePresentationProvider({
  board,
  templates,
  children,
}: {
  board: Board | undefined;
  templates: SlotTemplate[];
  children: ReactNode;
}) {
  return (
    <PresetContext.Provider value={boardPreset(board, templates)}>
      {children}
    </PresetContext.Provider>
  );
}
