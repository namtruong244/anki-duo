import { useSyncExternalStore } from 'react';
import { NavLink, Outlet } from 'react-router';
import { useTranslation } from 'react-i18next';
import { connectivity } from '../../client/connectivity';

const links = [
  { to: '/', key: 'nav.home', end: true },
  { to: '/decks', key: 'nav.decks' },
  { to: '/path', key: 'nav.path' },
  { to: '/dashboard', key: 'nav.dashboard' },
  { to: '/settings', key: 'nav.settings' },
];

function useOnline() {
  return useSyncExternalStore(
    (cb) => connectivity.subscribe(cb),
    () => connectivity.isOnline(),
    () => true,
  );
}

export function AppLayout() {
  const { t } = useTranslation();
  const online = useOnline();
  const nav = (
    <ul className="flex gap-1 md:flex-col">
      {links.map((l) => (
        <li key={l.to} className="flex-1">
          <NavLink
            to={l.to}
            end={l.end ?? false}
            className={({ isActive }) =>
              `block min-h-11 rounded-[var(--radius-button)] px-3 py-2 text-center font-semibold md:text-left ${isActive ? 'bg-neutral text-on-neutral' : 'text-text'}`
            }
          >
            {t(l.key)}
          </NavLink>
        </li>
      ))}
    </ul>
  );
  return (
    <div className="min-h-dvh bg-bg text-text md:flex">
      <nav
        aria-label={t('app.name')}
        className="hidden w-56 shrink-0 border-r border-border p-4 md:block"
      >
        {nav}
      </nav>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex justify-end p-3">
          <span role="status" className="text-sm text-text-muted">
            {online ? t('sync.online') : t('sync.offline')}
          </span>
        </header>
        <main className="mx-auto w-full max-w-3xl flex-1 px-4 pb-24 md:pb-8">
          <Outlet />
        </main>
        <nav
          aria-label={t('app.name')}
          className="fixed inset-x-0 bottom-0 border-t border-border bg-bg p-2 md:hidden"
        >
          {nav}
        </nav>
      </div>
    </div>
  );
}
