import { lazy, Suspense } from 'react';
import { Navigate, Outlet, Route, Routes, useLocation } from 'react-router';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../client/auth-context';
import { useSettingsEffects } from '../client/settings-effects';
import { useSyncRuntime, useToastMessage } from '../client/use-sync';
import { SyncStatusContext } from '../client/sync-status-context';
import { Toast } from '../components/ui';
import { AppLayout } from '../components/layout/AppLayout';
import { SignInPage } from './auth/SignInPage';
import { SignUpPage } from './auth/SignUpPage';
import { VerifyEmailPage } from './auth/VerifyEmailPage';
import { ResetPasswordPage } from './auth/ResetPasswordPage';
import { HomePage } from './home/HomePage';
import { DashboardPage } from './dashboard/DashboardPage';
import { SessionPage } from './session/SessionPage';

// Heavier screens load on demand so the review session stays light (SC-001).
const CardEditorPage = lazy(() =>
  import('./cards/CardEditorPage').then((m) => ({ default: m.CardEditorPage })),
);
const CardListPage = lazy(() =>
  import('./cards/CardListPage').then((m) => ({ default: m.CardListPage })),
);
const ImportPage = lazy(() =>
  import('./import/ImportPage').then((m) => ({ default: m.ImportPage })),
);
const SettingsPage = lazy(() =>
  import('./settings/SettingsPage').then((m) => ({ default: m.SettingsPage })),
);

function Loading() {
  const { t } = useTranslation();
  return (
    <p role="status" className="p-6">
      {t('common.loading')}
    </p>
  );
}

function Runtime({ userId }: { userId: string }) {
  const status = useSyncRuntime(userId);
  const [message, dismiss] = useToastMessage();
  useSettingsEffects();
  return (
    <SyncStatusContext.Provider value={status}>
      <Suspense fallback={<Loading />}>
        <Outlet />
      </Suspense>
      {message && <Toast message={message} onDismiss={dismiss} />}
    </SyncStatusContext.Provider>
  );
}

/** Only a signed-in, email-verified user passes. */
function RequireVerifiedSession() {
  const { status, user } = useAuth();
  const location = useLocation();
  if (status === 'loading') return <Loading />;
  if (!user) return <Navigate to="/sign-in" replace state={{ from: location.pathname }} />;
  if (!user.emailVerified) {
    return <Navigate to={`/verify-email?email=${encodeURIComponent(user.email)}`} replace />;
  }
  return <Runtime userId={user.id} />;
}

/** Auth pages are for signed-out visitors; a verified user goes home. */
function PublicOnly() {
  const { status, user } = useAuth();
  if (status === 'loading') return <Loading />;
  if (user?.emailVerified) return <Navigate to="/" replace />;
  return <Outlet />;
}

export function AppRoutes() {
  return (
    <Routes>
      <Route element={<PublicOnly />}>
        <Route path="/sign-in" element={<SignInPage />} />
        <Route path="/sign-up" element={<SignUpPage />} />
        <Route path="/reset-password" element={<ResetPasswordPage />} />
      </Route>
      <Route path="/verify-email" element={<VerifyEmailPage />} />
      <Route element={<RequireVerifiedSession />}>
        <Route path="/session/:deckId" element={<SessionPage />} />
        <Route element={<AppLayout />}>
          <Route index element={<HomePage />} />
          <Route path="/decks" element={<Navigate to="/" replace />} />
          <Route path="/cards" element={<CardListPage />} />
          <Route path="/decks/:deckId/cards" element={<CardListPage />} />
          <Route path="/decks/:deckId/cards/new" element={<CardEditorPage />} />
          <Route path="/decks/:deckId/cards/:cardId" element={<CardEditorPage />} />
          <Route path="/decks/:deckId/import" element={<ImportPage />} />
          <Route path="/dashboard" element={<DashboardPage />} />
          <Route path="/settings" element={<SettingsPage />} />
        </Route>
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
