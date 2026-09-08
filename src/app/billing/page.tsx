import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { currentParent } from "@/lib/auth";
import { db, hasDb } from "@/lib/db";
import { t } from "@/i18n";
import { billingConfigured, hebrewDate, openBooksLine, portalUrl, subscriptionStatusFor, type KidBillingStatus } from "@/lib/billing";
import { startCheckout } from "./actions";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: t("billing.title"), robots: { index: false, follow: false } };

interface Kid {
  id: string;
  name: string;
  feminine: boolean;
}

export default async function BillingPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const parent = hasDb() ? await currentParent() : null;
  if (!parent) redirect("/signin");

  const kidsRes = await db().query<Kid>("select id, name, feminine from kids where parent_id = $1 and deleted_at is null order by created_at", [parent.id]);
  const kids = kidsRes.rows;
  const statuses = await Promise.all(kids.map((k) => subscriptionStatusFor(k.id)));
  const configured = billingConfigured();
  const portal = configured ? await portalUrl(parent).catch(() => null) : null;
  const live = await openBooksLine();

  const ok = one(sp.ok) === "1";
  const err = one(sp.err) === "1" || one(sp.off) === "1";
  const highlighted = one(sp.kid);

  return (
    <main className="page">
      <h1>{t("billing.title")}</h1>
      <p className="lede">{t("billing.lede")}</p>

      {ok ? <p className="msg ok">{t("billing.thanks")}</p> : null}
      {err ? <p className="msg bad">{t("billing.error")}</p> : null}

      <section className="panel soft">
        <p>{t("billing.blurb")}</p>
        {live ? <p className="cap">{live}</p> : null}
        <p style={{ margin: 0 }}>
          <a href="/open-books">{t("billing.openBooksLink")}</a>
        </p>
      </section>

      {!configured ? <p className="msg info">{t("billing.notOn")}</p> : null}

      {kids.length === 0 ? (
        <p className="cap">{t("billing.noKids")}</p>
      ) : (
        kids.map((kid, i) => (
          <section key={kid.id} className="kidcard" id={`kid-${kid.id}`} style={highlighted === kid.id ? { borderColor: "var(--sun)" } : undefined}>
            <h3>
              {kid.name}
              <StatusPill s={statuses[i]} />
            </h3>
            <p className="cap">{statusLine(statuses[i])}</p>

            {statuses[i].status === "active" || statuses[i].status === "cancelled" || statuses[i].status === "past_due" ? null : (
              <form action={startCheckout}>
                <input type="hidden" name="kid_id" value={kid.id} />
                <button className="btn" type="submit" disabled={!configured}>
                  {t("billing.activate", { name: kid.name })}
                </button>
              </form>
            )}

            {portal && statuses[i].status !== "free" && statuses[i].status !== "granted" ? (
              <p style={{ marginTop: 12, marginBottom: 0 }}>
                <a className="btn ghost small" href="/api/billing/portal">
                  {t("billing.manage")}
                </a>
              </p>
            ) : null}
          </section>
        ))
      )}

      <p className="note">{t("billing.cancelNote")}</p>
    </main>
  );
}

function StatusPill({ s }: { s: KidBillingStatus }) {
  const cls = s.status === "past_due" ? "pill bad" : s.status === "free" || s.status === "ended" ? "pill" : "pill ok";
  const label =
    s.status === "active" ? "פעיל" : s.status === "cancelled" ? "עד סוף התקופה" : s.status === "past_due" ? "תשלום נכשל" : s.status === "granted" ? "מתנה" : s.status === "ended" ? t("billing.ended") : "חינם";
  return (
    <span className={cls} style={{ marginInlineStart: "auto" }}>
      {label}
    </span>
  );
}

/** The one status line the PRD asks for, per kid, in the editor's plain voice. */
function statusLine(s: KidBillingStatus): string {
  const date = s.until ? hebrewDate(s.until) : "";
  switch (s.status) {
    case "active":
      return date ? t("billing.active", { date }) : "פעיל";
    case "cancelled":
      return t("billing.cancelled", { date });
    case "past_due":
      return t("billing.pastDue");
    case "granted":
      return t("billing.granted", { date });
    case "ended":
      return t("billing.free");
    default:
      return t("billing.free");
  }
}

function one(v: string | string[] | undefined): string {
  return Array.isArray(v) ? (v[0] ?? "") : (v ?? "");
}
