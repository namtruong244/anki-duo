import i18next from 'i18next';
import ICU from 'i18next-icu';
import { initReactI18next } from 'react-i18next';
import en from './messages/en.json';
import vi from './messages/vi.json';

export type Locale = 'vi' | 'en';

/** `vi*` becomes `vi`, everything else `en`. A saved setting overrides this. */
export function detectLocale(languages: readonly string[]): Locale {
  return languages.some((l) => l.toLowerCase().startsWith('vi')) ? 'vi' : 'en';
}

export function initI18n(locale?: Locale) {
  const lng =
    locale ?? detectLocale(typeof navigator === 'undefined' ? [] : (navigator.languages ?? []));
  void i18next
    .use(new ICU())
    .use(initReactI18next)
    .init({
      lng,
      fallbackLng: 'en',
      resources: { en: { translation: en }, vi: { translation: vi } },
      interpolation: { escapeValue: false },
      initAsync: false,
    });
  return i18next;
}

export function setLocale(locale: Locale) {
  return i18next.changeLanguage(locale);
}

export { i18next };
