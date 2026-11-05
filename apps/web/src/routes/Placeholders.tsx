import { useTranslation } from 'react-i18next';
import { ChunkyButton } from '../components/ui';
import { useSignOut } from './use-sign-out';

/** Screens delivered by later stories; they keep the shell and routing complete. */
function Page({ titleKey, children }: { titleKey: string; children?: React.ReactNode }) {
  const { t } = useTranslation();
  return (
    <section className="py-4">
      <h1 className="mb-4 text-2xl font-bold">{t(titleKey)}</h1>
      {children}
    </section>
  );
}

export const HomePage = () => <Page titleKey="nav.home" />;
export const DeckListPage = () => <Page titleKey="nav.decks" />;
export const PathPage = () => <Page titleKey="nav.path" />;
export const DashboardPage = () => <Page titleKey="nav.dashboard" />;

export function SettingsPage() {
  const { t } = useTranslation();
  const signOut = useSignOut();
  return (
    <Page titleKey="nav.settings">
      <ChunkyButton variant="danger" onClick={signOut}>
        {t('auth.signOut')}
      </ChunkyButton>
    </Page>
  );
}
