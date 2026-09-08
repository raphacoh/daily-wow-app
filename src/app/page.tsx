import { APP, DEMO_URL, X_HANDLE, X_URL } from "@/lib/config";
import { t } from "@/i18n";
import { nums } from "@/lib/format";
import { XIcon } from "@/lib/icons";

export const dynamic = "force-static";

/**
 * The landing. One page, one idea: this is what my kids learn every morning — follow along if you like.
 * No pitch, no screenshots, no prices. The manifesto, the FAQ and the open repos live behind the header links.
 */
export default async function Landing({ searchParams }: { searchParams: Promise<{ lang?: string }> }) {
  const { lang } = await searchParams;
  const en = lang === "en";
  const L = (k: string) => t(k, {}, en ? "en" : "he");
  return (
    <main className="mini" dir={en ? "ltr" : "rtl"} lang={en ? "en" : "he"}>
      <p className="small">
        <a href={en ? "/" : "/?lang=en"}>{en ? "עברית" : "English"}</a>
      </p>
      <h1>{L("landing.h1")}</h1>
      <p className="lede">{nums(L("landing.p1"))}</p>
      <p>{nums(L("landing.p2"))}</p>
      <p>{L("landing.p3")}</p>
      <div className="acts">
        <a className="btn" href="/join">{L("landing.follow")}</a>
        <a href={DEMO_URL} rel="noopener">{L("landing.demo")}</a>
      </div>
      <p className="small">{L("landing.demoNote")}</p>
      <p className="by">
        {L("landing.by")}{" "}
        <a href={`mailto:${APP.editorEmail}`}>{APP.editorEmail}</a>
        {" · "}
        <a href={X_URL} rel="me noopener">
          <XIcon size={13} /> <span className="ltr">{X_HANDLE}</span>
        </a>
      </p>
    </main>
  );
}
