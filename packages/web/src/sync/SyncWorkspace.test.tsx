import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { i18n } from '../i18n';
import { SyncStatusSchema, type SyncStatus } from '@cura/shared';
import { SyncWorkspace } from './SyncWorkspace';

const id = (value: number) =>
  `00000000-0000-4000-8000-${String(value).padStart(12, '0')}`;
const libraryId = id(1),
  accountId = id(2),
  linkId = id(3),
  remoteId = id(4);
const time = '2026-10-04T00:00:00.000Z';
const account = { id: accountId, email: 'owner@example.test' };
const link = {
  id: linkId,
  libraryId,
  name: 'Studio library',
  role: 'owner',
  state: 'idle',
  phase: null,
  progress: { completed: 0, total: null },
  paused: false,
  materialized: true,
  pendingChanges: 0,
  conflictCount: 0,
  cursor: '0',
  lastSyncedAt: null,
  lastError: null,
  createdAt: time,
  updatedAt: time,
};
const signedIn = SyncStatusSchema.parse({
  configured: true,
  auth: 'signed-in',
  account,
  links: [],
  error: null,
});
const signedOut = SyncStatusSchema.parse({
  ...signedIn,
  auth: 'signed-out',
  account: null,
});
const local = SyncStatusSchema.parse({
  ...signedOut,
  configured: false,
  auth: 'unconfigured',
});
type Call = { path: string; method: string; body: unknown };
function fetchHarness(handler: (call: Call) => unknown | Promise<unknown>) {
  const calls: Call[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (path: string, options?: RequestInit) => {
      const call = {
        path,
        method: options?.method ?? 'GET',
        body: options?.body
          ? (JSON.parse(String(options.body)) as unknown)
          : undefined,
      };
      calls.push(call);
      const result = await handler(call);
      return result instanceof Response ? result : Response.json(result);
    }),
  );
  return calls;
}
beforeEach(async () => {
  await i18n.changeLanguage('en');
  localStorage.clear();
  sessionStorage.clear();
});
afterEach(() => vi.unstubAllGlobals());

describe('cloud workspace', () => {
  it('keeps unconfigured libraries explicitly local without exposing cloud controls', async () => {
    const calls = fetchHarness(() => local),
      back = vi.fn();
    render(<SyncWorkspace libraryId={libraryId} onBack={back} />);
    expect(await screen.findByText('Local mode')).toBeVisible();
    expect(
      screen.queryByRole('button', { name: 'Sign in' }),
    ).not.toBeInTheDocument();
    expect(calls.map((call) => call.path)).toEqual(['/api/sync/status']);
    fireEvent.click(screen.getByRole('button', { name: /Back to library/ }));
    expect(back).toHaveBeenCalledOnce();
  });

  it('refreshes idle linked libraries so automatic sync progress becomes visible', async () => {
    vi.useFakeTimers();
    try {
      let current = SyncStatusSchema.parse({ ...signedIn, links: [link] });
      fetchHarness((call) =>
        call.path === '/api/sync/libraries' ? [] : current,
      );
      await act(async () => {
        render(<SyncWorkspace libraryId={libraryId} onBack={() => {}} />);
      });
      expect(screen.getByText('Ready to sync')).toBeVisible();
      current = SyncStatusSchema.parse({
        ...current,
        links: [
          {
            ...link,
            state: 'syncing',
            phase: 'upload',
            progress: { completed: 1, total: 2 },
          },
        ],
      });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(5000);
      });
      expect(screen.getByRole('progressbar')).toHaveAttribute('value', '1');
      expect(screen.getByText('Uploading retained files')).toBeVisible();
      current = SyncStatusSchema.parse({ ...signedIn, links: [link] });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(500);
      });
      expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
      expect(screen.getByText('Ready to sync')).toBeVisible();
    } finally {
      vi.useRealTimers();
    }
  });

  it('sends credentials only to the local server and clears the password while sign-in is pending', async () => {
    let current: SyncStatus = signedOut;
    let finish!: (value: unknown) => void;
    const calls = fetchHarness((call) => {
      if (call.path === '/api/sync/auth/sign-in')
        return new Promise((resolve) => {
          finish = resolve;
        });
      return call.path === '/api/sync/libraries' ? [] : current;
    });
    render(<SyncWorkspace libraryId={libraryId} onBack={() => {}} />);
    await screen.findByLabelText('Email');
    fireEvent.change(screen.getByLabelText('Email'), {
      target: { value: account.email },
    });
    fireEvent.change(screen.getByLabelText('Password'), {
      target: { value: 'private-password' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(screen.getByLabelText('Password')).toHaveValue('');
    expect(
      screen.getByRole('button', { name: /Back to library/ }),
    ).toBeDisabled();
    await act(async () => {
      current = signedIn;
      finish(signedIn);
    });
    expect(await screen.findByText(accountId)).toBeVisible();
    expect(calls.find((call) => call.path.endsWith('/sign-in'))).toMatchObject({
      method: 'POST',
      body: { email: account.email, password: 'private-password' },
    });
    expect(localStorage.length).toBe(0);
    expect(sessionStorage.length).toBe(0);
  });

  it('reports failed sign-in without retaining the password and permits retry', async () => {
    fetchHarness((call) =>
      call.path.endsWith('/sign-in')
        ? Response.json(
            { code: 'AUTH_FAILED', error: 'Invalid credentials' },
            { status: 401 },
          )
        : signedOut,
    );
    render(<SyncWorkspace libraryId={libraryId} onBack={() => {}} />);
    await screen.findByLabelText('Email');
    fireEvent.change(screen.getByLabelText('Email'), {
      target: { value: account.email },
    });
    fireEvent.change(screen.getByLabelText('Password'), {
      target: { value: 'wrong-password' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Invalid credentials',
    );
    expect(screen.getByLabelText('Password')).toHaveValue('');
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeEnabled();
  });

  it('refreshes server authentication and signs out only this local session', async () => {
    let current: SyncStatus = signedIn;
    const calls = fetchHarness((call) => {
      if (call.path.endsWith('/sign-out')) current = signedOut;
      return call.path === '/api/sync/libraries' ? [] : current;
    });
    render(<SyncWorkspace libraryId={libraryId} onBack={() => {}} />);
    fireEvent.click(
      await screen.findByRole('button', { name: 'Refresh session' }),
    );
    await waitFor(() =>
      expect(calls.some((call) => call.path.endsWith('/refresh'))).toBe(true),
    );
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: 'Sign out on this device' }),
      ).toBeEnabled(),
    );
    fireEvent.click(
      screen.getByRole('button', { name: 'Sign out on this device' }),
    );
    await screen.findByLabelText('Password');
    expect(calls.filter((call) => call.method === 'POST')).toEqual([
      { path: '/api/sync/auth/refresh', method: 'POST', body: {} },
      { path: '/api/sync/auth/sign-out', method: 'POST', body: {} },
    ]);
  });

  it('publishes the current library then polls durable progress until completion', async () => {
    let published = false,
      polls = 0;
    const calls = fetchHarness((call) => {
      if (call.path === '/api/sync/libraries') return [];
      if (call.path === '/api/sync/publish') {
        published = true;
        return { ...link, state: 'initializing', phase: 'snapshot' };
      }
      if (!published) return signedIn;
      polls++;
      return {
        ...signedIn,
        links: [
          {
            ...link,
            state: polls < 2 ? 'syncing' : 'idle',
            phase: polls < 2 ? 'upload' : null,
            progress: { completed: polls < 2 ? 1 : 2, total: 2 },
            lastSyncedAt: polls < 2 ? null : time,
          },
        ],
      };
    });
    render(<SyncWorkspace libraryId={libraryId} onBack={() => {}} />);
    fireEvent.click(
      await screen.findByRole('button', { name: 'Publish this library' }),
    );
    expect(await screen.findByRole('progressbar')).toHaveAttribute('max', '2');
    await waitFor(
      () =>
        expect(screen.getByRole('button', { name: 'Sync now' })).toBeEnabled(),
      { timeout: 3000 },
    );
    expect(
      calls.find((call) => call.path === '/api/sync/publish'),
    ).toMatchObject({ body: { libraryId } });
    expect(screen.getByText('Ready to sync')).toBeVisible();
  });

  it('joins an authorized cloud library and never opens its uncommitted bootstrap', async () => {
    let joined = false;
    const incoming = {
      ...link,
      id: id(5),
      libraryId: remoteId,
      name: 'Remote studio',
      state: 'initializing',
      materialized: false,
    };
    const calls = fetchHarness((call) => {
      if (call.path === '/api/sync/libraries')
        return [
          {
            id: remoteId,
            name: 'Remote studio',
            ownerId: accountId,
            role: 'editor',
            createdAt: time,
            updatedAt: time,
          },
        ];
      if (call.path === '/api/sync/join') {
        joined = true;
        return incoming;
      }
      return { ...signedIn, links: joined ? [incoming] : [] };
    });
    const open = vi.fn();
    render(
      <SyncWorkspace
        libraryId={libraryId}
        onBack={() => {}}
        onOpenLibrary={open}
      />,
    );
    await screen.findByRole('option', { name: 'Remote studio' });
    fireEvent.change(screen.getByLabelText('Shared library'), {
      target: { value: remoteId },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Join library' }));
    expect(
      await screen.findByRole('button', { name: 'Open library' }),
    ).toBeDisabled();
    expect(open).not.toHaveBeenCalled();
    expect(calls.find((call) => call.path === '/api/sync/join')).toMatchObject({
      body: { libraryId: remoteId },
    });
  });

  it('permits viewer downloads while preserving local edits and disables team mutations', async () => {
    const viewer = {
      ...link,
      role: 'viewer',
      pendingChanges: 2,
      lastError: {
        code: 'VIEWER_READ_ONLY',
        error: 'Local changes remain on this device.',
      },
    };
    const calls = fetchHarness((call) => {
      if (call.path === '/api/sync/libraries' || call.path.endsWith('/members'))
        return [];
      if (call.path.endsWith('/run')) return viewer;
      return { ...signedIn, links: [viewer] };
    });
    render(<SyncWorkspace libraryId={libraryId} onBack={() => {}} />);
    fireEvent.click(
      await screen.findByRole('button', { name: 'Download updates' }),
    );
    await waitFor(() =>
      expect(calls.some((call) => call.path.endsWith('/run'))).toBe(true),
    );
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'View team' })).toBeEnabled(),
    );
    fireEvent.click(screen.getByRole('button', { name: 'View team' }));
    expect(
      await screen.findByRole('dialog', { name: 'Team members' }),
    ).toBeVisible();
    expect(
      screen.queryByRole('button', { name: 'Add member' }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByText('Local changes remain on this device.'),
    ).toBeVisible();
  });

  it('pauses and resumes the selected link using its operational identity', async () => {
    let current = link;
    const calls = fetchHarness((call) => {
      if (call.path === '/api/sync/libraries') return [];
      if (call.method === 'PATCH') {
        current = {
          ...current,
          paused: Boolean((call.body as { paused: boolean }).paused),
          state: (call.body as { paused: boolean }).paused ? 'paused' : 'idle',
        };
        return current;
      }
      return { ...signedIn, links: [current] };
    });
    render(<SyncWorkspace libraryId={libraryId} onBack={() => {}} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Pause sync' }));
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Resume sync' })).toBeEnabled(),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Resume sync' }));
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Pause sync' })).toBeEnabled(),
    );
    expect(calls.filter((call) => call.method === 'PATCH')).toEqual([
      {
        path: `/api/sync/links/${linkId}`,
        method: 'PATCH',
        body: { paused: true },
      },
      {
        path: `/api/sync/links/${linkId}`,
        method: 'PATCH',
        body: { paused: false },
      },
    ]);
  });

  it('retains local-library access when the server reports cloud offline', async () => {
    fetchHarness(() => ({
      ...signedIn,
      auth: 'offline',
      links: [{ ...link, state: 'offline', pendingChanges: 3 }],
      error: { code: 'OFFLINE', error: 'Cloud connection unavailable' },
    }));
    const open = vi.fn();
    render(
      <SyncWorkspace
        libraryId={libraryId}
        onBack={() => {}}
        onOpenLibrary={open}
      />,
    );
    expect(
      await screen.findByText('Cloud connection unavailable'),
    ).toBeVisible();
    expect(screen.getByRole('button', { name: 'Sync now' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Open library' }));
    expect(open).toHaveBeenCalledWith(libraryId);
  });

  it('discards a late status response after the workspace changes libraries', async () => {
    let finish!: (value: unknown) => void;
    let count = 0;
    fetchHarness(() =>
      ++count === 1
        ? new Promise((resolve) => {
            finish = resolve;
          })
        : local,
    );
    const { rerender } = render(
      <SyncWorkspace libraryId={libraryId} onBack={() => {}} />,
    );
    rerender(<SyncWorkspace libraryId={remoteId} onBack={() => {}} />);
    expect(await screen.findByText('Local mode')).toBeVisible();
    await act(async () => {
      finish(signedIn);
    });
    expect(screen.getByText('Local mode')).toBeVisible();
    expect(screen.queryByText(accountId)).not.toBeInTheDocument();
  });

  it('lets owners add change and remove UUID members while protecting the owner', async () => {
    let members = [
      {
        libraryId,
        userId: accountId,
        role: 'owner',
        createdAt: time,
        updatedAt: time,
      },
    ];
    const calls = fetchHarness((call) => {
      if (call.path === '/api/sync/libraries') return [];
      if (call.path.endsWith('/members')) return members;
      if (call.method === 'PUT') {
        const item = {
          libraryId,
          userId: id(8),
          role: (call.body as { role: string }).role,
          createdAt: time,
          updatedAt: time,
        };
        members = [
          ...members.filter((member) => member.userId !== item.userId),
          item,
        ];
        return item;
      }
      if (call.method === 'DELETE') {
        members = members.filter((member) => member.userId !== id(8));
        return { ok: true };
      }
      return { ...signedIn, links: [link] };
    });
    render(<SyncWorkspace libraryId={libraryId} onBack={() => {}} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Manage team' }));
    const dialog = within(
      await screen.findByRole('dialog', { name: 'Team members' }),
    );
    await dialog.findByText(accountId);
    expect(
      dialog.queryByRole('button', { name: 'Remove member' }),
    ).not.toBeInTheDocument();
    fireEvent.change(dialog.getByLabelText('Member account UUID'), {
      target: { value: id(8) },
    });
    fireEvent.change(dialog.getByLabelText('Member role'), {
      target: { value: 'viewer' },
    });
    fireEvent.click(dialog.getByRole('button', { name: 'Add member' }));
    const row = within(await dialog.findByRole('group', { name: id(8) }));
    await waitFor(() =>
      expect(row.getByRole('button', { name: 'Save role' })).toBeEnabled(),
    );
    fireEvent.change(row.getByLabelText('Member role'), {
      target: { value: 'editor' },
    });
    fireEvent.click(row.getByRole('button', { name: 'Save role' }));
    await waitFor(() =>
      expect(row.getByRole('button', { name: 'Remove member' })).toBeEnabled(),
    );
    fireEvent.click(
      within(screen.getByRole('group', { name: id(8) })).getByRole('button', {
        name: 'Remove member',
      }),
    );
    fireEvent.click(dialog.getByRole('button', { name: 'Confirm removal' }));
    await waitFor(() =>
      expect(dialog.queryByText(id(8))).not.toBeInTheDocument(),
    );
    expect(
      calls.filter((call) => call.method === 'PUT').map((call) => call.body),
    ).toEqual([{ role: 'viewer' }, { role: 'editor' }]);
    expect(calls.find((call) => call.method === 'DELETE')?.path).toBe(
      `/api/sync/libraries/${libraryId}/members/${id(8)}`,
    );
  });

  it('shows retained local and remote conflict snapshots without applying either as an edit', async () => {
    const conflict = {
      id: id(9),
      linkId,
      libraryId,
      entityKind: 'tag',
      entityId: id(10),
      resolution: 'local-wins',
      changedFields: ['name'],
      createdAt: time,
      updatedAt: time,
    };
    const tag = (name: string) => ({
      kind: 'tag',
      id: id(10),
      libraryId,
      data: {
        id: id(10),
        libraryId,
        name,
        color: '#123456',
        groupId: null,
        createdAt: time,
        updatedAt: time,
      },
    });
    const calls = fetchHarness((call) => {
      if (call.path === '/api/sync/libraries') return [];
      if (call.path.endsWith(`/conflicts/${conflict.id}`))
        return {
          ...conflict,
          base: null,
          local: tag('Local name'),
          remote: tag('Remote name'),
          resolved: tag('Local name'),
          ordinalRemaps: [],
        };
      if (call.path.endsWith('/conflicts')) return [conflict];
      return { ...signedIn, links: [{ ...link, conflictCount: 1 }] };
    });
    render(<SyncWorkspace libraryId={libraryId} onBack={() => {}} />);
    fireEvent.click(
      await screen.findByRole('button', { name: 'View conflicts (1)' }),
    );
    fireEvent.click(
      await screen.findByRole('button', { name: 'Inspect conflict' }),
    );
    expect(await screen.findByText(/"Remote name"/)).toBeInTheDocument();
    expect(screen.getAllByText(/"Local name"/)).toHaveLength(2);
    expect(
      screen.getByRole('button', { name: 'Download conflict JSON' }),
    ).toBeVisible();
    expect(calls.every((call) => call.method === 'GET')).toBe(true);
  });

  it('retries a failed conflict detail request from its dialog', async () => {
    const conflict = {
      id: id(9),
      linkId,
      libraryId,
      entityKind: 'tag',
      entityId: id(10),
      resolution: 'local-wins',
      changedFields: ['name'],
      createdAt: time,
      updatedAt: time,
    };
    let attempts = 0;
    fetchHarness((call) => {
      if (call.path === '/api/sync/libraries') return [];
      if (call.path.endsWith(`/conflicts/${conflict.id}`))
        return ++attempts === 1
          ? Response.json(
              { code: 'TEMPORARY', error: 'Try again' },
              { status: 503 },
            )
          : {
              ...conflict,
              base: null,
              local: null,
              remote: null,
              resolved: null,
              ordinalRemaps: [],
            };
      if (call.path.endsWith('/conflicts')) return [conflict];
      return { ...signedIn, links: [{ ...link, conflictCount: 1 }] };
    });
    render(<SyncWorkspace libraryId={libraryId} onBack={() => {}} />);
    fireEvent.click(
      await screen.findByRole('button', { name: 'View conflicts (1)' }),
    );
    fireEvent.click(
      await screen.findByRole('button', { name: 'Inspect conflict' }),
    );
    expect(await screen.findByRole('alert')).toHaveTextContent('Try again');
    fireEvent.click(
      within(screen.getByRole('dialog')).getByRole('button', {
        name: 'Refresh status',
      }),
    );
    expect(
      await screen.findByRole('button', { name: 'Download conflict JSON' }),
    ).toBeVisible();
    expect(attempts).toBe(2);
  });

  it('keeps keyboard focus in the team dialog and restores the trigger on Escape', async () => {
    fetchHarness((call) =>
      call.path === '/api/sync/libraries' || call.path.endsWith('/members')
        ? []
        : { ...signedIn, links: [link] },
    );
    render(<SyncWorkspace libraryId={libraryId} onBack={() => {}} />);
    const trigger = await screen.findByRole('button', { name: 'Manage team' });
    trigger.focus();
    fireEvent.click(trigger);
    const dialog = await screen.findByRole('dialog', { name: 'Team members' });
    const close = within(dialog).getByRole('button', { name: 'Close' });
    expect(close).toHaveFocus();
    const last = within(dialog).getByRole('button', { name: 'Add member' });
    last.focus();
    fireEvent.keyDown(last, { key: 'Tab' });
    expect(close).toHaveFocus();
    fireEvent.keyDown(close, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });
});
