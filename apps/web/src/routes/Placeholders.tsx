import { useTranslation } from 'react-i18next';

/** Screens delivered by later stories; they keep the shell and routing complete. */
function Page({ titleKey }: { titleKey: string }) {
  const { t } = useTranslation();
  return (
    <section className="py-4">
      <h1 className="mb-4 text-2xl font-bold">{t(titleKey)}</h1>
    </section>
  );
}

export const HomePage = () => <Page titleKey="nav.home" />;
export const DashboardPage = () => <Page titleKey="nav.dashboard" />;
