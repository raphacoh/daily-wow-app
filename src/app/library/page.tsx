/**
 * The library (PRD §5.7). Public: every released edition, newest first. A signed-in parent gets one
 * button per kid (their personal link, so a late completion still counts); anonymous visitors get the
 * plain link, which opens the lesson in demo mode. Works with no database — `listEditions` falls back
 * to the local `editions/` folder.
 */
import type { Metadata } from "next";
import { t } from "@/i18n";
import { APP } from "@/lib/config";
import { listEditions } from "@/lib/editions";
import { currentParent } from "@/lib/auth";
import { rememberedKidToken } from "@/lib/kidSession";
import { db, hasDb } from "@/lib/db";
import { kidByToken, kidLink, type KidRow, type ParentRow } from "@/lib/kids";
import { DEMO_EDITION_N } from "@/lib/editions";
import { heDate } from "@/lib/format";
import { MEDAL_NAMES, progressFor, type Result } from "@/lib/gamification";

export const metadata: Metadata = { title: "כל הגיליונות", description: "כל גיליון של שורשים וכנפיים, מהחדש לישן. אפשר להשלים כל אחד מהם מתי שרוצים." };

/** The signed-in parent's kids, or none. Never let a signed-out visitor (or a missing DB) break the page. */
async function myKids(parent: ParentRow | null): Promise<KidRow[]> {
  try {
    if (!parent || !hasDb()) return [];
    const r = await db().query<KidRow>("select * from kids where parent_id = $1 and deleted_at is null", [parent.id]);
    return r.rows;
  } catch {
    return [];
  }
}

/** kidLink decrypts the token; without LINK_KEY it throws, and then there is simply no personal link. */
function safeKidLink(kid: KidRow, n: number): string | null {
  try {
    return kidLink(kid, APP.url, n);
  } catch {
    return null;
  }
}

export default async function Library({ searchParams }: { searchParams: Promise<{ k?: string }> }) {
  const { k: fromLink } = await searchParams;
  // a kid's personal token (from the emails, or remembered on their device) scopes the page to that kid,
  // no sign-in needed. A signed-in parent is a parent, never the kid.
  const parent = await currentParent().catch(() => null);
  const remembered = fromLink || parent ? "" : await rememberedKidToken();
  const k = fromLink || remembered;
  const tokenKid = k && hasDb() ? await kidByToken(k).catch(() => null) : null;
  const [editions, kids] = await Promise.all([listEditions(), tokenKid ? Promise.resolve([tokenKid as KidRow]) : myKids(parent)]);
  const signedIn = !!tokenKid || !!parent;
  // A kid reading their own library wants one thing above all: what did I get last time? The grade of every
  // edition they answered travels with the list, medal or not.
  const grades = await gradesFor(tokenKid);
  // the remembered kid needs no token in the URL — one less thing to share by accident
  const linkFor = (kid: KidRow, n: number) => (tokenKid ? (fromLink ? `/l/${n}?k=${encodeURIComponent(fromLink)}` : `/l/${n}`) : safeKidLink(kid, n));

  return (
    <main className="page">
      <h1>{t("library.title")}</h1>
      <p className="lede cap">{tokenKid ? t("library.forKid", { name: tokenKid.name }) : t("library.intro")}</p>

      {editions.length === 0 ? (
        <p className="note">{t("library.empty")}</p>
      ) : (
        <div className="grid">
          {editions.map((e, i) => {
            const links = kids.map((kid) => ({ name: kid.name, href: linkFor(kid, e.n) })).filter((x) => x.href);
            return (
              <article className="step" key={e.n}>
                <div className="n num" aria-label={`גיליון מספר ${e.n}`}>
                  {e.n}
                </div>
                <h2>{e.title}</h2>
                <p className="cap">{heDate(e.date)}</p>
                <div className="eyebrow">
                  {i === 0 ? <span className="tag">{t("library.latest")}</span> : null}
                  {tokenKid ? <Grade result={grades[e.n] ?? null} /> : null}
                  {e.topics.map((topic) => (
                    <span className="tag" key={topic}>
                      {topic}
                    </span>
                  ))}
                  <span className="tag">{t("library.reviewed")}</span>
                </div>
                {e.editor_note ? <p className="cap">{e.editor_note}</p> : null}
                <div className="controls">
                  {links.length ? (
                    links.map((l) => (
                      <a className="btn small" href={l.href!} key={l.name}>
                        {t("library.openFor", { name: l.name })}
                      </a>
                    ))
                  ) : e.n === DEMO_EDITION_N || signedIn ? (
                    <a className="btn small" href={`/l/${e.n}`}>
                      {t("library.open")}
                    </a>
                  ) : (
                    <a className="btn small ghost" href="/join">
                      {t("library.followers")}
                    </a>
                  )}
                </div>
              </article>
            );
          })}
        </div>
      )}

      <p className="note">{t("library.lede")}</p>
    </main>
  );
}

/** The kid's grade per edition, keyed by edition number. Never let a missing document break the page. */
async function gradesFor(kid: KidRow | null): Promise<Record<number, Result>> {
  try {
    if (!kid || !hasDb()) return {};
    const p = await progressFor(kid.id);
    return Object.fromEntries((p?.results ?? []).map((r) => [r.n, r]));
  } catch {
    return {};
  }
}

/** One edition's grade, as the kid sees it in the list: the medal, then the score behind it. */
function Grade({ result }: { result: Result | null }) {
  if (!result) return <span className="tag ghost">{t("library.noGrade")}</span>;
  return (
    <span className="tag">
      {result.medal ? `${MEDAL_NAMES[result.medal]} · ` : ""}
      {t("library.grade", { score: result.score, max: result.max })}
      {result.complete ? "" : ` · ${t("library.partial")}`}
    </span>
  );
}

export const dynamic = "force-dynamic";
