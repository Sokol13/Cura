import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  IdSchema,
  SyncMembersSchema,
  SyncMemberSchema,
  SyncConflictsSchema,
  SyncConflictDetailSchema,
  type SyncLink,
  type SyncMember,
  type SyncConflictSummary,
  type SyncConflictDetail,
} from '@cura/shared';
import { syncError, syncRequest as request, type SyncMutation } from './client';

function MemberRow({
  member,
  canEdit,
  busy,
  save,
  remove,
}: {
  member: SyncMember;
  canEdit: boolean;
  busy: boolean;
  save: (id: string, role: 'editor' | 'viewer') => void;
  remove: (id: string) => void;
}) {
  const { t } = useTranslation('sync');
  const [role, setRole] = useState<'editor' | 'viewer'>(
    member.role === 'viewer' ? 'viewer' : 'editor',
  );
  return (
    <fieldset
      className="sync-member"
      disabled={busy}
      role="group"
      aria-label={member.userId}
    >
      <code>{member.userId}</code>
      {member.role === 'owner' || !canEdit ? (
        <span>{t(`role.${member.role}`)}</span>
      ) : (
        <>
          <label>
            {t('memberRole')}
            <select
              value={role}
              onChange={(event) =>
                setRole(event.target.value as 'editor' | 'viewer')
              }
            >
              <option value="editor">{t('role.editor')}</option>
              <option value="viewer">{t('role.viewer')}</option>
            </select>
          </label>
          <button onClick={() => save(member.userId, role)}>
            {t('saveRole')}
          </button>
          <button onClick={() => remove(member.userId)}>
            {t('removeMember')}
          </button>
        </>
      )}
    </fieldset>
  );
}

export function SyncDialogs({
  kind,
  link,
  busy,
  error,
  mutate,
  onClose,
}: {
  kind: 'team' | 'conflicts';
  link: SyncLink;
  busy: boolean;
  error: string;
  mutate: SyncMutation;
  onClose: () => void;
}) {
  const { t } = useTranslation('sync');
  const [members, setMembers] = useState<SyncMember[]>();
  const dialog = useRef<HTMLElement>(null);
  useEffect(() => {
    const previous = document.activeElement;
    dialog.current?.querySelector<HTMLElement>('button')?.focus();
    return () => {
      if (previous instanceof HTMLElement && previous.isConnected)
        previous.focus();
    };
  }, []);
  const [conflicts, setConflicts] = useState<SyncConflictSummary[]>();
  const [details, setDetails] = useState<SyncConflictDetail>();
  const [selected, setSelected] = useState('');
  const [readError, setReadError] = useState('');
  const [revision, setRevision] = useState(0);
  const [userId, setUserId] = useState(''),
    [role, setRole] = useState<'editor' | 'viewer'>('viewer');
  const [removing, setRemoving] = useState('');
  useEffect(() => {
    const controller = new AbortController();
    void request(
      kind === 'team'
        ? `/api/sync/libraries/${link.libraryId}/members`
        : `/api/sync/links/${link.id}/conflicts`,
      { signal: controller.signal },
    )
      .then((value) => {
        if (controller.signal.aborted) return;
        if (kind === 'team') setMembers(SyncMembersSchema.parse(value));
        else setConflicts(SyncConflictsSchema.parse(value));
        setReadError('');
      })
      .catch((reason: unknown) => {
        if (!controller.signal.aborted)
          setReadError(syncError(reason, t('failed')));
      });
    return () => controller.abort();
  }, [kind, link.id, link.libraryId, revision, t]);
  useEffect(() => {
    if (!selected) return;
    const controller = new AbortController();
    void request(`/api/sync/links/${link.id}/conflicts/${selected}`, {
      signal: controller.signal,
    })
      .then((value) => {
        const result = SyncConflictDetailSchema.parse(value);
        if (!controller.signal.aborted) {
          setDetails(result);
          setReadError('');
        }
      })
      .catch((reason: unknown) => {
        if (!controller.signal.aborted)
          setReadError(syncError(reason, t('failed')));
      });
    return () => controller.abort();
  }, [selected, link.id, revision, t]);
  const saveMember = (id: string, nextRole: 'editor' | 'viewer') =>
    void mutate(async (signal) => {
      SyncMemberSchema.parse(
        await request(
          `/api/sync/libraries/${link.libraryId}/members/${IdSchema.parse(id.trim())}`,
          { method: 'PUT', body: { role: nextRole }, signal },
        ),
      );
    }).then((success) => {
      if (success) {
        setUserId('');
        setRevision((value) => value + 1);
      }
    });
  const remove = () =>
    void mutate(async (signal) => {
      await request(
        `/api/sync/libraries/${link.libraryId}/members/${removing}`,
        { method: 'DELETE', signal },
      );
    }).then((success) => {
      if (success) {
        setRemoving('');
        setRevision((value) => value + 1);
      }
    });
  const detail = details?.id === selected ? details : undefined;
  const download = () => {
    if (!detail) return;
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(detail, null, 2)], {
        type: 'application/json;charset=utf-8',
      }),
    );
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `cura-conflict-${detail.id}.json`;
    anchor.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  return (
    <div className="sync-modal-backdrop">
      <section
        ref={dialog}
        className="sync-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={t(kind === 'team' ? 'team' : 'conflicts')}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.preventDefault();
            event.stopPropagation();
            if (!busy) onClose();
          }
          if (event.key === 'Tab') {
            const controls = [
              ...event.currentTarget.querySelectorAll<HTMLElement>(
                ':is(button, input, select, summary):not(:disabled)',
              ),
            ];
            const first = controls[0],
              last = controls.at(-1);
            if (event.shiftKey && document.activeElement === first) {
              event.preventDefault();
              last?.focus();
            } else if (!event.shiftKey && document.activeElement === last) {
              event.preventDefault();
              first?.focus();
            }
          }
        }}
      >
        <header className="sync-header">
          <h2>
            {t(kind === 'team' ? 'team' : 'conflicts')} · {link.name}
          </h2>
          <button disabled={busy} onClick={onClose}>
            {t('close')}
          </button>
        </header>
        {(error || readError) && (
          <p role="alert" className="error-banner">
            {error || readError}
          </p>
        )}
        {readError && (
          <button
            disabled={busy}
            onClick={() => setRevision((value) => value + 1)}
          >
            {t('refresh')}
          </button>
        )}
        {kind === 'team' ? (
          <>
            {!members ? (
              !readError && <p role="status">{t('loading')}</p>
            ) : (
              <>
                {!members.length && <p>{t('noMembers')}</p>}
                {members.map((member) => (
                  <MemberRow
                    key={`${member.userId}:${member.role}`}
                    member={member}
                    canEdit={link.role === 'owner'}
                    busy={busy || Boolean(removing)}
                    save={saveMember}
                    remove={setRemoving}
                  />
                ))}
              </>
            )}
            <p>{t('immutableOwner')}</p>
            {removing && (
              <div className="sync-confirm">
                <p>{t('confirmRemove')}</p>
                <code>{removing}</code>
                <div className="sync-actions">
                  <button disabled={busy} onClick={remove}>
                    {t('confirm')}
                  </button>
                  <button disabled={busy} onClick={() => setRemoving('')}>
                    {t('cancel')}
                  </button>
                </div>
              </div>
            )}
            {link.role === 'owner' && (
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  saveMember(userId, role);
                }}
              >
                <p>{t('memberHint')}</p>
                <fieldset
                  disabled={busy || Boolean(removing)}
                  className="sync-inline-form"
                >
                  <label>
                    {t('memberId')}
                    <input
                      required
                      pattern="[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}"
                      value={userId}
                      onChange={(event) => setUserId(event.target.value)}
                    />
                  </label>
                  <label>
                    {t('memberRole')}
                    <select
                      value={role}
                      onChange={(event) =>
                        setRole(event.target.value as 'editor' | 'viewer')
                      }
                    >
                      <option value="viewer">{t('role.viewer')}</option>
                      <option value="editor">{t('role.editor')}</option>
                    </select>
                  </label>
                  <button type="submit">{t('addMember')}</button>
                </fieldset>
              </form>
            )}
          </>
        ) : (
          <>
            <p>{t('conflictHint')}</p>
            {!conflicts ? (
              !readError && <p role="status">{t('loading')}</p>
            ) : !conflicts.length ? (
              <p>{t('noConflicts')}</p>
            ) : (
              <ul className="sync-conflicts">
                {conflicts.map((conflict) => (
                  <li key={conflict.id}>
                    <p>
                      {conflict.entityKind} · <code>{conflict.entityId}</code>
                    </p>
                    <p>{t(`resolution.${conflict.resolution}`)}</p>
                    <button
                      disabled={busy}
                      onClick={() => setSelected(conflict.id)}
                    >
                      {t('inspect')}
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {selected && !detail && !readError && (
              <p role="status">{t('loading')}</p>
            )}
            {detail && (
              <section className="sync-conflict-detail">
                <h3>{t(`resolution.${detail.resolution}`)}</h3>
                <p>
                  {t('changedFields')}: {detail.changedFields.join(', ')}
                </p>
                <button onClick={download}>{t('downloadConflict')}</button>
                {(['base', 'local', 'remote', 'resolved'] as const).map(
                  (key) => {
                    const text = detail[key]
                      ? JSON.stringify(detail[key], null, 2)
                      : t('absent');
                    return (
                      <details key={key}>
                        <summary>{t(key)}</summary>
                        <pre>{text.slice(0, 20000)}</pre>
                        {text.length > 20000 && <p>{t('snapshotLimit')}</p>}
                      </details>
                    );
                  },
                )}
                {!!detail.ordinalRemaps.length && (
                  <details>
                    <summary>{t('remaps')}</summary>
                    <ul>
                      {detail.ordinalRemaps.map((item) => (
                        <li key={`${item.kind}:${item.id}`}>
                          {item.kind} · {item.id} · {item.from} → {item.to}
                        </li>
                      ))}
                    </ul>
                  </details>
                )}
              </section>
            )}
          </>
        )}
      </section>
    </div>
  );
}
