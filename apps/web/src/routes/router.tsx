import { Navigate, Outlet, Route, Routes, useLocation } from 'react-router';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../client/auth-context';
import { useSyncRuntime, useToastMessage } from '../client/use-sync';
import { SyncStatusContext } from '../client/sync-status-context';
import { Toast } from '../components/ui';
import { AppLayout } from '../components/layout/AppLayout';
import { SignInPage } from './auth/SignInPage';
import { SignUpPage } from './auth/SignUpPage';
import { VerifyEmailPage } from './auth/VerifyEmailPage';
import { ResetPasswordPage } from './auth/ResetPasswordPage';
import { DashboardPage, HomePage, PathPage } from './Placeholders';
import { DeckListPage } from './decks/DeckListPage';
import { SessionPage } from './session/SessionPage';
import { SettingsPage } from './settings/SettingsPage';

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
  return (
    <SyncStatusContext.Provider value={status}>
      <Outlet />
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
          <Route path="/decks" element={<DeckListPage />} />
          <Route path="/path" element={<PathPage />} />
          <Route path="/dashboard" element={<DashboardPage />} />
          <Route path="/settings" element={<SettingsPage />} />
        </Route>
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
