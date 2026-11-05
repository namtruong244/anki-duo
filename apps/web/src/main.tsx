import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router';
import { I18nextProvider } from 'react-i18next';
import './styles/app.css';
import { initI18n } from './i18n';
import { AuthProvider } from './client/auth';
import { AppRoutes } from './routes/router';
import { installGlobalErrorReporting } from './client/report';

const i18n = initI18n();
installGlobalErrorReporting();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <I18nextProvider i18n={i18n}>
      <AuthProvider>
        <BrowserRouter>
          <AppRoutes />
        </BrowserRouter>
      </AuthProvider>
    </I18nextProvider>
  </StrictMode>,
);
