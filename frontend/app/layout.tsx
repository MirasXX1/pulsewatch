import type { Metadata } from "next";
import AppShell from "@/components/AppShell";
import { LocaleProvider } from "@/i18n/LocaleProvider";
import { ru } from "@/i18n/messages";
import "./globals.css";

export const metadata: Metadata = {
  title: ru.pageTitle,
  description: ru.pageDescription,
};

export default function Layout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ru">
      <body className="antialiased selection:bg-emerald-100">
        <LocaleProvider>
          <AppShell>{children}</AppShell>
        </LocaleProvider>
      </body>
    </html>
  );
}
