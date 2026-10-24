"use client";

import Link from "next/link";
import { useLocale } from "@/i18n/LocaleProvider";
import type { Locale } from "@/i18n/messages";

const languages: { locale: Locale; label: string; name: string }[] = [
  { locale: "ru", label: "RU", name: "Русский" },
  { locale: "kk", label: "KZ", name: "Қазақша" },
  { locale: "en", label: "EN", name: "English" },
];

export default function AppShell({ children }: { children: React.ReactNode }) {
  const { locale, setLocale, t } = useLocale();
  return (
    <div className="shell">
      <aside className="sidebar">
        <Link href="/" className="brand">
          <span className="brand-icon">ϟ</span>PulseWatch
          <span className="brand-dot">.</span>
        </Link>
        <p className="nav-label">{t("workspace")}</p>
        <Link href="/" className="nav-item">
          <span>▦</span> {t("overview")} <span className="nav-arrow">↗</span>
        </Link>
        <div className="sidebar-bottom">
          <div className="local-dot" />
          <div>
            <strong>{t("localWorkspace")}</strong>
            <small>{t("singleUser")}</small>
          </div>
        </div>
      </aside>
      <div className="main">
        <header className="topbar">
          <span className="breadcrumbs">
            {t("workspace")} <span className="crumb">/</span> {t("monitoring")}
          </span>
          <div className="topbar-controls">
            <span className="local-tag">{t("localInstance")}</span>
            <div
              className="language-switch"
              role="group"
              aria-label={t("language")}
            >
              {languages.map((language) => (
                <button
                  key={language.locale}
                  type="button"
                  lang={language.locale}
                  title={language.name}
                  aria-label={language.name}
                  aria-pressed={locale === language.locale}
                  onClick={() => setLocale(language.locale)}
                >
                  {language.label}
                </button>
              ))}
            </div>
          </div>
        </header>
        <main>{children}</main>
        <footer>
          PulseWatch <span>{t("peaceOfMind")}</span>
          <span>{t("everyMinute")}</span>
        </footer>
      </div>
    </div>
  );
}
