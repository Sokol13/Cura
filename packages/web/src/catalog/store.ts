import {
  SettingsSchema,
  type Settings,
  type UpdateSettings,
} from '@cura/shared';
import { create } from 'zustand';
import { request } from './api';

let pendingWrite: Promise<void> = Promise.resolve();

type WorkspaceState = {
  settings: Settings;
  hydrated: boolean;
  hydrate: (settings: Settings) => void;
  update: (patch: UpdateSettings) => Promise<void>;
};
export const useWorkspace = create<WorkspaceState>((set) => ({
  settings: SettingsSchema.parse({}),
  hydrated: false,
  hydrate: (settings) => set({ settings, hydrated: true }),
  update: (patch) => {
    const operation = pendingWrite
      .catch(() => undefined)
      .then(async () => {
        const settings = SettingsSchema.parse(
          await request('/api/settings', { method: 'PATCH', body: patch }),
        );
        set({ settings });
      });
    pendingWrite = operation;
    return operation;
  },
}));
