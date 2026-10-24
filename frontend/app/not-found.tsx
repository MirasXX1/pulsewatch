"use client";
import Link from "next/link";
import { useLocale } from "@/i18n/LocaleProvider";
export default function NotFound() {
  const { t } = useLocale();
  return (
    <section className="panel empty">
      <h1>{t("notFoundTitle")}</h1>
      <p>{t("notFoundDescription")}</p>
      <Link href="/" className="primary">
        ← {t("backToMonitors")}
      </Link>
    </section>
  );
}
