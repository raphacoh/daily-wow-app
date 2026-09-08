import type { Metadata } from "next";
import { t } from "@/i18n";
import { nums } from "@/lib/format";

export const metadata: Metadata = { title: "שאלות", description: t("meta.faq"), openGraph: { title: "שאלות", description: t("meta.faq") } };
export const dynamic = "force-static";

export default function Faq() {
  return (
    <main className="prose">
      <h1>{t("landing.faqTitle")}</h1>
      <p className="kicker">מה שהורים שואלים אותי, בסדר שהם שואלים.</p>
      {[1, 2, 3, 4, 5, 6, 7].map((i) => (
        <section key={i}>
          <h2>{nums(t(`landing.faq${i}q`))}</h2>
          <p>{nums(t(`landing.faq${i}a`))}</p>
        </section>
      ))}
      <section>
        <h2>מה זה עולה?</h2>
        <p>{nums(t("landing.cost"))} <a href="/open-books">{t("landing.costLink")}</a></p>
      </section>
      <p className="sig">לא מצאתם תשובה? <a href="mailto:raphco@gmail.com">כתבו לי</a>.</p>
    </main>
  );
}
