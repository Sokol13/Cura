import { useTranslation } from 'react-i18next';

export function App() {
  const { t } = useTranslation();

  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col justify-center px-6 py-16">
      <p className="text-sm font-medium tracking-widest text-orange-400">
        {t('environment')}
      </p>
      <h1 className="mt-4 text-5xl font-semibold tracking-tight text-zinc-50">
        Cura
      </h1>
      <p className="mt-6 text-lg leading-relaxed text-zinc-400">{t('ready')}</p>
    </main>
  );
}
