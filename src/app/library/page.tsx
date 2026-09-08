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
import { db, hasDb } from "@/lib/db";
import { kidLink, type KidRow } from "@/lib/kids";
import { heDate } from "@/lib/format";

export const metadata: Metadata = { title: "כל הגיליונות", description: "כל גיליון של שורשים וכנפיים, מהחדש לישן. אפשר להשלים כל אחד מהם מתי שרוצים." };

/** The signed-in parent's kids, or none. Never let a signed-out visitor (or a missing DB) break the page. */
async function myKids(): Promise<KidRow[]> {
  try {
    const parent = await currentParent();
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

export default async function Library() {
  const [editions, kids] = await Promise.all([listEditions(), myKids()]);

  return (
    <main className="page">
      <h1>{t("library.title")}</h1>
      <p className="lede cap">{t("library.intro")}</p>

      {editions.length === 0 ? (
        <p className="note">{t("library.empty")}</p>
      ) : (
        <div className="grid">
          {editions.map((e, i) => {
            const links = kids.map((k) => ({ name: k.name, href: safeKidLink(k, e.n) })).filter((x) => x.href);
            return (
              <article className="step" key={e.n}>
                <div className="n num" aria-label={`גיליון מספר ${e.n}`}>
                  {e.n}
                </div>
                <h2>{e.title}</h2>
                <p className="cap">{heDate(e.date)}</p>
                <div className="eyebrow">
                  {i === 0 ? <span className="tag">{t("library.latest")}</span> : null}
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
                  ) : (
                    <a className="btn small" href={`/l/${e.n}`}>
                      {t("library.open")}
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

export const dynamic = "force-dynamic";
