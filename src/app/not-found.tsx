/** 404, in the same voice as everything else: say what happened, then offer the two doors that matter. */
import { t } from "@/i18n";

export default function NotFound() {
  return (
    <main className="page">
      <h1>{t("notfound.title")}</h1>
      <p className="lede cap">{t("notfound.lede")}</p>
      <div className="controls">
        <a className="btn" href="/l/today">
          {t("notfound.today")}
        </a>
        <a className="btn ghost" href="/library">
          {t("nav.library")}
        </a>
        <a className="btn ghost" href="/">
          {t("notfound.home")}
        </a>
      </div>
    </main>
  );
}
