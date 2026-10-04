import { describe, expect, it, vi } from 'vitest';
import { SettingsSchema } from '@cura/shared';
import { useWorkspace } from './store';

describe('workspace settings persistence', () => {
  it('preserves the newest preferences when server response timing differs', async () => {
    let server = SettingsSchema.parse({});
    useWorkspace.getState().hydrate(server);
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_path: string, options: RequestInit) => {
        const patch = JSON.parse(String(options.body)) as Record<
          string,
          unknown
        >;
        server = SettingsSchema.parse({ ...server, ...patch });
        const snapshot = { ...server };
        await new Promise((resolve) =>
          setTimeout(resolve, 'theme' in patch ? 30 : 1),
        );
        return new Response(JSON.stringify(snapshot));
      }),
    );
    await Promise.all([
      useWorkspace.getState().update({ theme: 'light' }),
      useWorkspace.getState().update({ layout: 'list' }),
    ]);
    expect(useWorkspace.getState().settings).toMatchObject({
      theme: 'light',
      layout: 'list',
    });
  });
});
