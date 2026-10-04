import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ReviewPanel } from './ReviewPanel';
import { ArchiveRulesPanel } from './ArchiveRulesPanel';
import { ScriptsPanel } from './ScriptsPanel';
import { DocumentsPanel } from './DocumentsPanel';
import './i18n';
import './automation.css';
const tabs = ['review', 'rules', 'scripts', 'documents'] as const;
type Tab = (typeof tabs)[number];
function readTab(): Tab {
  const value = new URLSearchParams(window.location.search).get(
    'automationTab',
  );
  return tabs.find((tab) => tab === value) ?? 'review';
}
export function AutomationWorkspace({
  libraryId,
  onBack,
}: {
  libraryId: string;
  onBack: () => void;
}) {
  const { t } = useTranslation('automation');
  const [tab, setTab] = useState<Tab>(readTab);
  useEffect(() => {
    const restore = () => setTab(readTab());
    window.addEventListener('popstate', restore);
    return () => window.removeEventListener('popstate', restore);
  }, []);
  const chooseTab = (value: Tab) => {
    const url = new URL(window.location.href);
    url.searchParams.set('automationTab', value);
    window.history.replaceState({}, '', url);
    setTab(value);
  };
  return (
    <main className="automation-workspace" aria-label={t('title')}>
      <header className="automation-header">
        <button onClick={onBack}>
          <span aria-hidden="true">← </span>
          {t('back')}
        </button>
        <div className="automation-heading">
          <span className="automation-mark" aria-hidden="true">
            ✧
          </span>
          <div>
            <h1>{t('title')}</h1>
            <p>{t('subtitle')}</p>
          </div>
        </div>
      </header>
      <nav className="automation-tabs" aria-label={t('title')}>
        {tabs.map((value, index) => (
          <button
            key={value}
            aria-current={value === tab ? 'page' : undefined}
            onClick={() => chooseTab(value)}
          >
            <span aria-hidden="true">0{index + 1}</span>
            {t(value)}
          </button>
        ))}
      </nav>
      <div className="automation-body" key={`${libraryId}:${tab}`}>
        {tab === 'review' ? (
          <ReviewPanel libraryId={libraryId} />
        ) : tab === 'rules' ? (
          <ArchiveRulesPanel libraryId={libraryId} />
        ) : tab === 'scripts' ? (
          <ScriptsPanel libraryId={libraryId} />
        ) : (
          <DocumentsPanel libraryId={libraryId} />
        )}
      </div>
    </main>
  );
}
