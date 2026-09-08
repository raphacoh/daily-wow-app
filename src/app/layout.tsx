import type { Metadata, Viewport } from "next";
import "./globals.css";
import { APP, X_HANDLE, X_URL } from "@/lib/config";
import { currentParent } from "@/lib/auth";
import { t } from "@/i18n";
import { XIcon } from "@/lib/icons";

export const metadata: Metadata = {
  title: { default: APP.name, template: `%s · ${APP.name}` },
  description: "שיעור אחד ביום, מהורים לילדים. פתוח, חינמי, קהילתי.",
  robots: { index: true, follow: true },
};
export const viewport: Viewport = { width: "device-width", initialScale: 1, themeColor: "#FAF8F3" };

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  let parent = null;
  try {
    parent = await currentParent();
  } catch {
    parent = null;
  }
  return (
    <html lang="he" dir="rtl">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Frank+Ruhl+Libre:wght@400;500&family=Rubik:wght@400;500&display=swap" />
      </head>
      <body>
        <header className="topbar">
          <div className="topbar-in">
            <a className="brand" href="/">
              <span className="disc" aria-hidden="true" />
              <span>{APP.name}</span>
            </a>
            <nav className="nav" aria-label="ניווט">
              <a href="/manifesto">{t("nav.manifesto")}</a>
              <a href="/faq">{t("nav.faq")}</a>
              <a href="/open">{t("nav.open")}</a>
              <a href={X_URL} rel="me noopener" aria-label={`${APP.editorName} ב-X, ${X_HANDLE}`}>
                <XIcon />
              </a>
              {parent ? (
                <>
                  <a href="/home">{t("nav.home")}</a>
                  {parent.is_editor ? <a href="/admin">{t("nav.admin")}</a> : null}
                </>
              ) : (
                <a href="/signin">{t("nav.signin")}</a>
              )}
            </nav>
          </div>
        </header>
        {children}
        <footer className="site">
          <div className="in">
            <span>{t("footer.byline")}</span>
            <a href="/library">{t("nav.library")}</a>
            <a href="/open-books">{t("nav.openBooks")}</a>
            <a href="/privacy">{t("footer.privacy")}</a>
            <a href="/terms">{t("footer.terms")}</a>
            <a href={`mailto:${APP.editorEmail}`}>{t("footer.contact")}</a>
          </div>
        </footer>
      </body>
    </html>
  );
}
