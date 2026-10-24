"use client";

import {
  createContext,
  useContext,
  useEffect,
  useState,
  useCallback,
  useMemo,
} from "react";
import {
  isLocale,
  localeTags,
  storageKey,
  translate,
  type Locale,
  type MessageKey,
  type Params,
} from "./messages";

type LocaleContextValue = {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  t: (key: MessageKey, params?: Params) => string;
  formatDate: (value: string) => string;
  formatNumber: (value: number) => string;
  formatPercent: (value: number) => string;
};
const LocaleContext = createContext<LocaleContextValue | null>(null);

export function LocaleProvider({ children }: { children: React.ReactNode }) {
  // Russian on the server and first client render avoids hydration mismatches.
  const [locale, updateLocale] = useState<Locale>("ru");
  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(storageKey);
      if (isLocale(saved)) updateLocale(saved);
    } catch {
      /* Keep working when browser storage is unavailable. */
    }
    const sync = (event: StorageEvent) => {
      if (event.key === storageKey || event.key === null) {
        updateLocale(isLocale(event.newValue) ? event.newValue : "ru");
      }
    };
    window.addEventListener("storage", sync);
    return () => window.removeEventListener("storage", sync);
  }, []);

  const setLocale = useCallback((next: Locale) => {
    updateLocale(next);
    try {
      window.localStorage.setItem(storageKey, next);
    } catch {
      /* Session choice still works. */
    }
  }, []);

  const value = useMemo<LocaleContextValue>(() => {
    const tag = localeTags[locale];
    const dates = new Intl.DateTimeFormat(tag, {
      dateStyle: "medium",
      timeStyle: "medium",
    });
    const numbers = new Intl.NumberFormat(tag);
    const percents = new Intl.NumberFormat(tag, {
      style: "percent",
      minimumFractionDigits: 1,
      maximumFractionDigits: 1,
    });
    return {
      locale,
      setLocale,
      t: (key, params) => translate(locale, key, params),
      formatDate: (date) => dates.format(new Date(date)),
      formatNumber: (number) => numbers.format(number),
      formatPercent: (percent) => percents.format(percent / 100),
    };
  }, [locale, setLocale]);

  useEffect(() => {
    document.documentElement.lang = locale;
    document.title = translate(locale, "pageTitle");
    document
      .querySelector('meta[name="description"]')
      ?.setAttribute("content", translate(locale, "pageDescription"));
  }, [locale]);

  return (
    <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>
  );
}

export function useLocale() {
  const value = useContext(LocaleContext);
  if (!value) throw new Error("useLocale requires LocaleProvider");
  return value;
}
