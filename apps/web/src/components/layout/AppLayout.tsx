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
  {
    to: '/cards',
    key: 'nav.decks',
    icon: 'm-style',
    iconColor: 'text-secondary',
    match: ['/decks'],
  },
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
      className={`group flex h-11 items-center gap-3 rounded-xl border-2 px-3 text-[13px] font-extrabold uppercase tracking-[0.08em] transition-[transform,background-color,border-color,color] duration-[var(--duration-fast)] active:scale-[0.97] ${
        on
          ? 'border-nav-active-border bg-nav-active-bg text-nav-active-text'
          : 'border-transparent text-text hover:bg-surface'
      }`}
    >
      <Icon
        name={l.icon}
        size={24}
        className={`${l.iconColor} transition-transform duration-[var(--duration-fast)] group-hover:scale-110`}
      />
      <span>{label}</span>
    </span>
  );
}

function TabItemBody({ l, active, label }: { l: NavDef; active: boolean; label: string }) {
  const on = useIsActive(l, active);
  return (
    <span
      aria-current={on ? 'page' : undefined}
      className={`group flex flex-col items-center justify-center gap-0.5 rounded-xl border-2 px-1 py-1.5 text-[10px] font-extrabold uppercase leading-tight tracking-wide transition-[transform,background-color,border-color,color] duration-[var(--duration-fast)] active:scale-[0.97] ${
        on
          ? 'border-nav-active-border bg-nav-active-bg text-nav-active-text'
          : 'border-transparent text-text-muted'
      }`}
    >
      <Icon
        name={l.icon}
        size={26}
        className={`${l.iconColor} transition-transform duration-[var(--duration-fast)] group-hover:scale-110`}
      />
      <span className="max-w-full truncate">{label}</span>
    </span>
  );
}

/** Card editor and CSV import use a wide content area without the right rail. */
const WIDE_ROUTE = /^\/decks\/[^/]+\/(import|cards\/[^/]+)\/?$/;

/** Dashboard column is 680px (per design) so the 12-month heatmap (633px) fits without scrolling. */
const DASHBOARD_ROUTE = /^\/dashboard\/?$/;

export function AppLayout() {
  const { t } = useTranslation();
  const rail = useRailData();
  const { pathname } = useLocation();
  const wide = WIDE_ROUTE.test(pathname);
  const maxW = wide
    ? 'max-w-[1000px]'
    : DASHBOARD_ROUTE.test(pathname)
      ? 'max-w-[680px]'
      : 'max-w-[640px]';

  return (
    <div className="min-h-dvh bg-bg text-text md:flex">
      {/* Desktop sidebar (224px) */}
      <nav
        aria-label={t('app.name')}
        className="sticky top-0 hidden h-dvh w-56 shrink-0 flex-col gap-3 border-r-2 border-border bg-[var(--color-card)] p-4 md:flex"
      >
        <div className="px-3 pb-3 pt-2">
          <span className="text-[26px] font-black lowercase leading-none tracking-tight text-primary">
            anki duo
          </span>
        </div>
        <ul className="flex flex-col gap-1.5">
          {links.map((l) => (
            <li key={l.to}>
              <SidebarItem l={l} />
            </li>
          ))}
        </ul>
      </nav>

      <div className="flex min-w-0 flex-1 flex-col">
        {/* Mobile top stat bar */}
        <header className="sticky top-0 z-20 flex items-center justify-between border-b-2 border-border bg-[var(--color-card)] px-4 py-2.5 md:hidden">
          <span className="text-xl font-black lowercase tracking-tight text-primary">anki duo</span>
          <MobileStats streak={rail.streak} xp={rail.totalXp} />
        </header>

        <div className="flex flex-1 justify-center gap-6 px-4 md:px-6 xl:gap-10 xl:px-8">
          <main className={`w-full min-w-0 flex-1 pb-24 pt-4 md:pb-10 md:pt-6 ${maxW}`}>
            {/* Medium desktops hide the rail but keep the status row */}
            {!wide && <StatusRow data={rail} className="mb-4 hidden md:flex xl:hidden" />}
            <Outlet />
          </main>
          {!wide && (
            <aside className="hidden w-[320px] shrink-0 pt-6 xl:block">
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
