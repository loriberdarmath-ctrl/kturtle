import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  ReactNode,
} from 'react';
import { Locale, LOCALES, translate } from './strings';

interface I18nContextValue {
  locale: Locale;
  setLocale: (l: Locale) => void;
  t: (key: string, ...args: (string | number)[]) => string;
  locales: typeof LOCALES;
}

const I18nContext = createContext<I18nContextValue | null>(null);

const STORAGE_KEY = 'kturtle.locale';

function detectInitialLocale(): Locale {
  if (typeof window === 'undefined') return 'en';
  const saved = localStorage.getItem(STORAGE_KEY) as Locale | null;
  if (saved && ['en', 'ru', 'hy'].includes(saved)) return saved;
  // Prefer browser language as a gentle default, otherwise English.
  const nav = (navigator.language || '').slice(0, 2).toLowerCase();
  if (nav === 'ru') return 'ru';
  if (nav === 'hy' || nav === 'am') return 'hy';
  return 'en';
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(() => detectInitialLocale());

  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);

  const setLocale = useCallback((l: Locale) => {
    setLocaleState(l);
    try {
      localStorage.setItem(STORAGE_KEY, l);
    } catch {
      // ignore quota / private-mode errors
    }
  }, []);

  const t = useCallback(
    (key: string, ...args: (string | number)[]) => translate(locale, key, ...args),
    [locale],
  );

  const value = useMemo(
    () => ({ locale, setLocale, t, locales: LOCALES }),
    [locale, setLocale, t],
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useT() {
  const ctx = useContext(I18nContext);
  if (!ctx) {
    throw new Error('useT must be used inside <I18nProvider>');
  }
  return ctx;
}
