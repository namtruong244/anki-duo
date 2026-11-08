import { NavLink, Outlet, useLocation } from 'react-router';
import { useTranslation } from 'react-i18next';
import { Icon, type IconName } from '../ui';
import { RightRail, StatusRow, SyncIcon, useRailData } from './RightRail';

interface NavDef {
  to: string;
  key: string;
  icon: IconName;
  iconColor: string;
  end?: boolean;
  /** Extra path prefixes that keep this item active. */
  match?: string[];
}

const links: NavDef[] = [
  { to: '/', key: 'nav.home', icon: 'm-home', iconColor: 'text-primary', end: true },
  { to: '/cards', key: 'nav.decks', icon: 'm-style', iconColor: 'text-secondary', match: ['/decks'] },
  { to: '/dashboard', key: 'nav.dashboard', icon: 'm-leaderboard', iconColor: 'text-orange' },
  { to: '/settings', key: 'nav.settings', icon: 'm-settings', iconColor: 'text-purple' },
];

function useIsActive(l: NavDef, routerActive: boolean) {
  const { pathname } = useLocation();
  return (
    routerActive || (l.match?.some((m) => pathname === m || pathname.startsWith(`${m}/`)) ?? false)
  );
}

function SidebarItem({ l }: { l: NavDef }) {
  const { t } = useTranslation();
  return (
    <NavLink to={l.to} end={l.end ?? false} className="block rounded-2xl">
      {({ isActive }) => <SidebarItemBody l={l} active={isActive} label={t(l.key)} />}
    </NavLink>
  );
}

function SidebarItemBody({ l, active, label }: { l: NavDef; active: boolean; label: string }) {
  const on = useIsActive(l, active);
  return (
    <span
      aria-current={on ? 'page' : undefined}
      className={`flex h-12 items-center gap-4 rounded-2xl border-2 px-4 text-sm font-extrabold uppercase tracking-[0.08em] transition-colors ${
        on
          ? 'border-nav-active-border bg-nav-active-bg text-nav-active-text'
          : 'border-transparent text-text hover:bg-surface'
      }`}
    >
      <Icon name={l.icon} size={28} className={l.iconColor} />
      <span>{label}</span>
    </span>
  );
}

function TabItemBody({ l, active, label }: { l: NavDef; active: boolean; label: string }) {
  const on = useIsActive(l, active);
  return (
    <span
      aria-current={on ? 'page' : undefined}
      className={`flex flex-col items-center justify-center gap-0.5 rounded-xl border-2 px-1 py-1.5 text-[10px] font-extrabold uppercase leading-tight tracking-wide ${
        on
          ? 'border-nav-active-border bg-nav-active-bg text-nav-active-text'
          : 'border-transparent text-text-muted'
      }`}
    >
      <Icon name={l.icon} size={26} className={l.iconColor} />
      <span className="max-w-full truncate">{label}</span>
    </span>
  );
}

/** Card editor and CSV import use a wide content area without the right rail. */
const WIDE_ROUTE = /^\/decks\/[^/]+\/(import|cards\/[^/]+)\/?$/;

export function AppLayout() {
  const { t } = useTranslation();
  const rail = useRailData();
  const wide = WIDE_ROUTE.test(useLocation().pathname);

  return (
    <div className="min-h-dvh bg-bg text-text md:flex">
      {/* Desktop sidebar (256px) */}
      <nav
        aria-label={t('app.name')}
        className="sticky top-0 hidden h-dvh w-64 shrink-0 flex-col gap-4 border-r-2 border-border bg-[var(--color-card)] p-4 md:flex"
      >
        <div className="px-4 pb-4 pt-2">
          <span className="text-[32px] font-black lowercase leading-none tracking-tight text-primary">
            anki duo
          </span>
        </div>
        <ul className="flex flex-col gap-2">
          {links.map((l) => (
            <li key={l.to}>
              <SidebarItem l={l} />
            </li>
          ))}
        </ul>
      </nav>

      <div className="flex min-w-0 flex-1 flex-col">
        {/* Mobile top stat bar */}
        <header className="sticky top-0 z-20 flex items-center justify-between border-b-2 border-border bg-[var(--color-card)] px-4 py-3 md:hidden">
          <span className="text-2xl font-black lowercase tracking-tight text-primary">
            anki duo
          </span>
          <MobileStats streak={rail.streak} xp={rail.totalXp} />
        </header>

        <div className="flex flex-1 justify-center gap-8 px-4 md:px-8 xl:px-16">
          <main
            className={`w-full min-w-0 flex-1 pb-28 pt-6 md:pb-10 md:pt-8 ${wide ? 'max-w-[1000px]' : 'max-w-[640px]'}`}
          >
            {/* Medium desktops hide the rail but keep the status row */}
            {!wide && <StatusRow data={rail} className="mb-6 hidden md:flex xl:hidden" />}
            <Outlet />
          </main>
          {!wide && (
            <aside className="hidden w-[368px] shrink-0 pt-8 xl:block">
              <RightRail data={rail} />
            </aside>
          )}
        </div>

        {/* Mobile bottom tab bar */}
        <nav
          aria-label={t('app.name')}
          className="fixed inset-x-0 bottom-0 z-30 border-t-2 border-border bg-[var(--color-card)] px-3 pb-[max(0.5rem,env(safe-area-inset-bottom))] pt-2 md:hidden"
        >
          <ul className="flex items-stretch gap-1">
            {links.map((l) => (
              <li key={l.to} className="min-w-0 flex-1">
                <NavLink to={l.to} end={l.end ?? false} className="block">
                  {({ isActive }) => <TabItemBody l={l} active={isActive} label={t(l.key)} />}
                </NavLink>
              </li>
            ))}
          </ul>
        </nav>
      </div>
    </div>
  );
}

function MobileStats({ streak, xp }: { streak: number; xp: number }) {
  return (
    <div className="flex items-center gap-3 text-sm font-extrabold">
      <SyncIcon />
      <span className="flex items-center gap-1 text-orange">
        <Icon name="flame" size={20} />
        {streak}
      </span>
      <span className="flex items-center gap-1 text-gold-depth">
        <Icon name="zap" size={20} />
        {xp}
      </span>
    </div>
  );
}
