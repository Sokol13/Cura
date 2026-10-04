import { useEffect, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import {
  CloudLibrariesSchema,
  SyncSignInSchema,
  SyncStatusSchema,
  SyncLinkSchema,
  type CloudLibrary,
  type SyncLink,
} from '@cura/shared';
import {
  isActiveSync,
  syncError,
  useSyncClient,
  syncRequest as request,
} from './client';
import { SyncDialogs } from './SyncDialogs';
import './i18n';
import './sync.css';

export function SyncWorkspace({
  libraryId,
  onBack,
  onOpenLibrary,
}: {
  libraryId: string;
  onBack: () => void;
  onOpenLibrary?: (id: string) => void;
}) {
  const { t, i18n } = useTranslation('sync');
  const { status, error, busy, revision, mutate } = useSyncClient(
    libraryId,
    t('failed'),
  );
  const [email, setEmail] = useState(''),
    [password, setPassword] = useState('');
  const [cloud, setCloud] = useState<{
    accountId: string;
    libraries: CloudLibrary[];
  }>();
  const [cloudError, setCloudError] = useState('');
  const [joinId, setJoinId] = useState('');
  const [dialog, setDialog] = useState<{
    kind: 'team' | 'conflicts';
    link: SyncLink;
  } | null>(null);
  const accountId =
    status?.auth === 'signed-in' ? status.account?.id : undefined;
  useEffect(() => {
    if (!accountId) return;
    const controller = new AbortController();
    void request('/api/sync/libraries', { signal: controller.signal })
      .then((value) => {
        const libraries = CloudLibrariesSchema.parse(value);
        if (!controller.signal.aborted) {
          setCloud({ accountId, libraries });
          setCloudError('');
        }
      })
      .catch((reason: unknown) => {
        if (!controller.signal.aborted)
          setCloudError(syncError(reason, t('failed')));
      });
    return () => controller.abort();
  }, [accountId, revision, t]);
  const libraries =
    cloud?.accountId === accountId ? (cloud?.libraries ?? []) : [];
  const signedIn = status?.auth === 'signed-in';
  const locked = busy || Boolean(dialog);
  const signIn = (event: FormEvent) => {
    event.preventDefault();
    const body = { email: email.trim(), password };
    setPassword('');
    void mutate(async (signal) =>
      SyncStatusSchema.parse(
        await request('/api/sync/auth/sign-in', {
          method: 'POST',
          body: SyncSignInSchema.parse(body),
          signal,
        }),
      ),
    );
  };
  const auth = (operation: 'refresh' | 'sign-out') =>
    void mutate(async (signal) =>
      SyncStatusSchema.parse(
        await request(`/api/sync/auth/${operation}`, {
          method: 'POST',
          body: {},
          signal,
        }),
      ),
    );
  const connect = (operation: 'publish' | 'join', id: string) =>
    void mutate(async (signal) => {
      SyncLinkSchema.parse(
        await request(`/api/sync/${operation}`, {
          method: 'POST',
          body: { libraryId: id },
          signal,
        }),
      );
    });
  const updateLink = (link: SyncLink, operation: 'run' | 'pause') =>
    void mutate(async (signal) => {
      SyncLinkSchema.parse(
        await request(
          `/api/sync/links/${link.id}${operation === 'run' ? '/run' : ''}`,
          {
            method: operation === 'run' ? 'POST' : 'PATCH',
            body: operation === 'run' ? {} : { paused: !link.paused },
            signal,
          },
        ),
      );
    });
  return (
    <main className="sync-workspace">
      <header className="sync-header">
        <button disabled={locked} onClick={onBack}>
          ← {t('back')}
        </button>
        <h1>{t('title')}</h1>
        <button disabled={locked} onClick={() => void mutate(async () => {})}>
          {t('refresh')}
        </button>
      </header>
      {error && !dialog && (
        <p role="alert" className="error-banner">
          {error}
        </p>
      )}
      {busy && <p role="status">{t('working')}</p>}
      {!status ? (
        <p role="status">{t('loading')}</p>
      ) : (
        <>
          {!status.configured ? (
            <section className="sync-panel" aria-labelledby="sync-local-title">
              <h2 id="sync-local-title">{t('localMode')}</h2>
              <p>{t('localHint')}</p>
              <p>{t('configuration')}</p>
            </section>
          ) : (
            <section
              className="sync-panel"
              aria-labelledby="sync-account-title"
            >
              <h2 id="sync-account-title">{t('account')}</h2>
              <p className="sync-badge">{t(`auth.${status.auth}`)}</p>
              {status.account && (
                <>
                  <p>{status.account.email}</p>
                  <dl>
                    <dt>{t('userId')}</dt>
                    <dd>
                      <code>{status.account.id}</code>
                    </dd>
                  </dl>
                </>
              )}
              {(!status.account || status.auth === 'expired') && (
                <form onSubmit={signIn}>
                  <fieldset disabled={locked} className="sync-inline-form">
                    <label>
                      {t('email')}
                      <input
                        type="email"
                        autoComplete="username"
                        required
                        maxLength={320}
                        value={email}
                        onChange={(event) => setEmail(event.target.value)}
                      />
                    </label>
                    <label>
                      {t('password')}
                      <input
                        type="password"
                        autoComplete="current-password"
                        required
                        maxLength={10000}
                        value={password}
                        onChange={(event) => setPassword(event.target.value)}
                      />
                    </label>
                    <button className="button-primary" type="submit">
                      {t('signIn')}
                    </button>
                  </fieldset>
                </form>
              )}
              {status.account && (
                <div className="sync-actions">
                  <button disabled={locked} onClick={() => auth('refresh')}>
                    {t('sessionRefresh')}
                  </button>
                  <button disabled={locked} onClick={() => auth('sign-out')}>
                    {t('signOut')}
                  </button>
                </div>
              )}
              <p className="sync-muted">{t('privacy')}</p>
              {status.error && (
                <p role="alert" className="error-banner">
                  {status.error.error}
                </p>
              )}
              {(status.auth === 'offline' || status.auth === 'expired') && (
                <p>{t('localWork')}</p>
              )}
            </section>
          )}
          {status.configured && signedIn && (
            <section
              className="sync-panel"
              aria-labelledby="sync-connect-title"
            >
              <h2 id="sync-connect-title">{t('connect')}</h2>
              {!status.links.some((link) => link.libraryId === libraryId) && (
                <>
                  <p>{t('publishHint')}</p>
                  <button
                    className="button-primary"
                    disabled={locked}
                    onClick={() => connect('publish', libraryId)}
                  >
                    {t('publish')}
                  </button>
                </>
              )}
              {cloudError && (
                <p role="alert" className="error-banner">
                  {cloudError}
                </p>
              )}
              {libraries.some(
                (library) =>
                  !status.links.some((link) => link.libraryId === library.id),
              ) ? (
                <form
                  onSubmit={(event) => {
                    event.preventDefault();
                    if (joinId) connect('join', joinId);
                  }}
                >
                  <fieldset disabled={locked} className="sync-inline-form">
                    <label>
                      {t('sharedLibrary')}
                      <select
                        required
                        value={joinId}
                        onChange={(event) => setJoinId(event.target.value)}
                      >
                        <option value="">{t('chooseLibrary')}</option>
                        {libraries
                          .filter(
                            (library) =>
                              !status.links.some(
                                (link) => link.libraryId === library.id,
                              ),
                          )
                          .map((library) => (
                            <option key={library.id} value={library.id}>
                              {library.name}
                            </option>
                          ))}
                      </select>
                    </label>
                    <button type="submit" disabled={!joinId}>
                      {t('join')}
                    </button>
                  </fieldset>
                </form>
              ) : (
                <p className="sync-muted">{t('noLibraries')}</p>
              )}
            </section>
          )}
          {status.configured && (
            <section aria-labelledby="sync-links-title">
              <h2 id="sync-links-title">{t('linked')}</h2>
              {!status.links.length && (
                <p className="empty-state">{t('noLinks')}</p>
              )}
              <div className="sync-links">
                {status.links.map((link) => (
                  <article
                    key={link.id}
                    className="sync-panel"
                    aria-label={link.name}
                  >
                    <div className="sync-link-heading">
                      <h3>{link.name}</h3>
                      <span className="sync-badge">
                        {t(`role.${link.role}`)}
                      </span>
                    </div>
                    <p>{t(`state.${link.state}`)}</p>
                    <dl>
                      <dt>{t('libraryId')}</dt>
                      <dd>
                        <code>{link.libraryId}</code>
                      </dd>
                    </dl>
                    {link.phase && <p>{t(`phase.${link.phase}`)}</p>}
                    {isActiveSync(link.state) && (
                      <div className="sync-progress">
                        <progress
                          aria-label={link.name}
                          {...(link.progress.total === null
                            ? {}
                            : {
                                value: link.progress.completed,
                                max: Math.max(1, link.progress.total),
                              })}
                        />
                        <p>
                          {t(
                            link.progress.total === null
                              ? 'unknownProgress'
                              : 'progress',
                            link.progress,
                          )}
                        </p>
                      </div>
                    )}
                    <p>{t('pending', { count: link.pendingChanges })}</p>
                    <p className="sync-muted">
                      {link.lastSyncedAt
                        ? t('lastSynced', {
                            time: new Date(link.lastSyncedAt).toLocaleString(
                              i18n.language,
                            ),
                          })
                        : t('neverSynced')}
                    </p>
                    {link.lastError && (
                      <p role="alert" className="error-banner">
                        {link.lastError.error}
                      </p>
                    )}
                    {link.role === 'viewer' && <p>{t('viewerHint')}</p>}
                    {!link.materialized && <p>{t('staged')}</p>}
                    <div className="sync-actions">
                      <button
                        disabled={
                          locked ||
                          !signedIn ||
                          link.paused ||
                          isActiveSync(link.state)
                        }
                        onClick={() => updateLink(link, 'run')}
                      >
                        {t(link.role === 'viewer' ? 'download' : 'run')}
                      </button>
                      <button
                        disabled={locked}
                        onClick={() => updateLink(link, 'pause')}
                      >
                        {t(link.paused ? 'resume' : 'pause')}
                      </button>
                      {onOpenLibrary && (
                        <button
                          disabled={locked || !link.materialized}
                          onClick={() => onOpenLibrary(link.libraryId)}
                        >
                          {t('open')}
                        </button>
                      )}
                      <button
                        disabled={locked || !signedIn}
                        onClick={() => setDialog({ kind: 'team', link })}
                      >
                        {t(link.role === 'owner' ? 'manageTeam' : 'viewTeam')}
                      </button>
                      <button
                        disabled={locked}
                        onClick={() => setDialog({ kind: 'conflicts', link })}
                      >
                        {t('inspectConflicts', { count: link.conflictCount })}
                      </button>
                    </div>
                  </article>
                ))}
              </div>
            </section>
          )}
        </>
      )}
      {dialog && (
        <SyncDialogs
          key={`${dialog.kind}:${dialog.link.id}`}
          kind={dialog.kind}
          link={
            status?.links.find((item) => item.id === dialog.link.id) ??
            dialog.link
          }
          busy={busy}
          error={error}
          mutate={mutate}
          onClose={() => setDialog(null)}
        />
      )}
    </main>
  );
}
