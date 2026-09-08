/**
 * The parent dashboard (PRD §5.4). One stacked-card page: today's edition, a card per kid,
 * the history table with the daily passwords, the account, and the community strip.
 * Everything is server-rendered — no client JS, no third-party scripts (PRD §10).
 */
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { NotSignedIn, requireParent } from "@/lib/auth";
import { hasDb } from "@/lib/db";
import { APP } from "@/lib/config";
import { dashboardFor, kidLink, type Dashboard, type DashboardKid } from "@/lib/family";
import { GRADES, LEVELS_UI, type Level, normLevel } from "@/lib/kids";
import { LEVELS, levelFor } from "@/lib/progress";
import { t } from "@/i18n";
import { addAdult, deleteAccount, dropAdult, dropKid, newLink, saveAccount, saveKid, saveLevel, setPaused, suggestTopic } from "./actions";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: t("home.title"), robots: { index: false, follow: false } };

/** The daily email goes out at this hour (PRD §6.4); the card reports it as a fact, not a promise. */
const SEND_TIME = "11:00";

/* ---------- formatting helpers (server-side, deterministic) ---------- */

/** A YYYY-MM-DD edition date in Hebrew. Noon UTC + an explicit timezone keeps it stable everywhere. */
function heDate(iso: string, opts: Intl.DateTimeFormatOptions): string {
  return new Date(`${iso}T12:00:00Z`).toLocaleDateString("he-IL", { timeZone: "UTC", ...opts });
}
const longDate = (iso: string) => heDate(iso, { weekday: "long", day: "numeric", month: "long", year: "numeric" });
const shortDate = (iso: string) => heDate(iso, { day: "numeric", month: "numeric" });
const dayOfMonth = (iso: string) => heDate(iso, { day: "numeric" });
const num = (n: number | string) => <span className="num">{n}</span>;

function Flame() {
  return (
    <span className="flame" aria-hidden="true">
      <svg viewBox="0 0 24 24" fill="currentColor">
        <path d="M12 2c1 4 5 5 5 10a5 5 0 0 1-10 0c0-2 1-3 1-3s0 3 2 3c2 0 1-4 2-10z" />
      </svg>
    </span>
  );
}

/* ---------- page ---------- */

export default async function HomePage() {
  if (!hasDb()) {
    return (
      <main className="page">
        <h1>{t("home.title")}</h1>
        <p className="msg info">{t("home.noDb")}</p>
      </main>
    );
  }
  let dash: Dashboard;
  try {
    const parent = await requireParent();
    dash = await dashboardFor(parent, APP.url);
  } catch (e) {
    if (e instanceof NotSignedIn) redirect("/signin");
    throw e;
  }
  const { parent, today, kids, history } = dash;
  const doneToday = kids.some((k) => k.todayResult?.complete);

  return (
    <main className="page">
      <h1>{t("home.title")}</h1>
      <p className="cap">{t("home.hello", { name: parent.name || parent.email })}</p>

      <TodayCard dash={dash} />
      {kids.length ? kids.map((k) => <KidCard key={k.kid.id} k={k} todayDate={today?.date ?? null} />) : <p className="note">{t("home.noKids")}</p>}
      <History history={history} kids={kids} todayN={today?.n ?? null} doneToday={doneToday} />
      <Account dash={dash} />
      <Community />
    </main>
  );
}

/* ---------- 1. today's edition ---------- */

function TodayCard({ dash }: { dash: Dashboard }) {
  const { today, todaySent, kids } = dash;
  return (
    <section className="panel soft">
      <h2>{t("home.today")}</h2>
      {today ? (
        <>
          <h3>{today.title}</h3>
          <p className="cap">
            {longDate(today.date)}
            {" · "}
            {todaySent ? (
              <>
                {t("home.sentAtPre")}
                {num(SEND_TIME)}
              </>
            ) : (
              t("home.notYet")
            )}
          </p>
          {today.editor_note ? (
            <div className="aha">
              <b>{t("home.editorNote")}</b>
              <p style={{ margin: "4px 0 0" }}>{today.editor_note}</p>
            </div>
          ) : null}
          <div className="grid">
            {kids.map((k) => (
              <div key={k.kid.id} className="controls">
                {k.link ? (
                  <a className="btn" href={k.link}>
                    {t("home.openFor", { name: k.kid.name })}
                  </a>
                ) : (
                  <form action={newLink}>
                    <input type="hidden" name="kid" value={k.kid.id} />
                    <button className="btn ghost" type="submit">
                      {t("home.noLink")}
                    </button>
                  </form>
                )}
                <Result r={k.todayResult} />
              </div>
            ))}
          </div>
        </>
      ) : (
        <p className="cap">{t("home.noEdition")}</p>
      )}
    </section>
  );
}

/** — / ✓ 9/11 / מאוחר */
function Result({ r }: { r: DashboardKid["todayResult"] }) {
  if (!r) return <span className="pill">{t("home.none")}</span>;
  return (
    <span className={r.late ? "pill" : "pill ok"}>
      {r.complete ? "✓ " : ""}
      {num(`${r.score}/${r.max}`)}
      {r.late ? ` · ${t("home.late")}` : ""}
    </span>
  );
}

/* ---------- 2. one card per kid ---------- */

function KidCard({ k, todayDate }: { k: DashboardKid; todayDate: string | null }) {
  const { kid, stats } = k;
  const lv = levelFor(stats.xp, kid.feminine);
  const floor = LEVELS[lv.index][0];
  const pct = lv.next ? Math.min(100, Math.round(((stats.xp - floor) / (lv.next - floor)) * 100)) : 100;
  return (
    <section className="kidcard">
      <h3>
        {kid.name}
        {kid.paused ? <span className="pill bad">{t("home.paused")}</span> : null}
      </h3>

      <details className="sheet">
        <summary>
          {t("home.level")}: {LEVELS_UI[normLevel(kid.level)].label}
        </summary>
        <form action={saveLevel}>
          <input type="hidden" name="kid" value={kid.id} />
          <div className="levels">
            {(Object.keys(LEVELS_UI) as (keyof typeof LEVELS_UI)[]).map((lvl) => (
              <label key={lvl}>
                <input type="radio" name="level" value={lvl} defaultChecked={kid.level === lvl} />
                <span>
                  <b>{LEVELS_UI[lvl].label}</b>
                  <small>{LEVELS_UI[lvl].blurb}</small>
                </span>
              </label>
            ))}
          </div>
          <button className="btn small" type="submit">
            {t("home.save")}
          </button>
        </form>
      </details>

      <p className="controls">
        <span className="pill sun">
          <Flame />
          {t("home.streak")} {num(k.liveStreak)}
        </span>
        <span className="pill">
          {t("home.best")} {num(stats.best)}
        </span>
        <span className="pill nile">
          {num(stats.xp)} {t("home.xp")} · {lv.name}
        </span>
      </p>
      <div className="xpbar" role="presentation">
        <i style={{ width: `${pct}%` }} />
      </div>
      <p className="small">{lv.next ? t("home.toNext", { n: lv.next - stats.xp }) : t("home.maxLevel")}</p>

      <p className="small">{t("home.days14")}</p>
      <div className="days">
        {k.days.map((d) => (
          <span
            key={d.date}
            className={[d.done && !d.late ? "hit" : "", d.late ? "late" : "", d.date === todayDate ? "today" : ""].filter(Boolean).join(" ")}
            title={d.score === null ? `${shortDate(d.date)} — ${t("home.notDone")}` : `${shortDate(d.date)} — ${d.score}${d.late ? ` (${t("home.late")})` : ""}`}
          >
            {num(dayOfMonth(d.date))}
          </span>
        ))}
        {k.days.length === 0 ? <span>{t("home.none")}</span> : null}
      </div>

      <p className="small">{t("home.badges")}</p>
      {stats.badges.length ? (
        <p className="badges">
          {stats.badges.map((b) => (
            <span className="badge" key={b}>
              <span className="dot" aria-hidden="true">
                ★
              </span>
              {b}
            </span>
          ))}
        </p>
      ) : (
        <p className="small">{t("home.noBadges")}</p>
      )}

      <p className="small">
        {k.entitled ? (
          <>
            {t("home.artoOn")}
            {k.subscription?.current_period_end || k.freeUntil ? ` · ${t("home.until", { date: longDate((k.subscription?.current_period_end ?? k.freeUntil)!.slice(0, 10)) })}` : ""}
          </>
        ) : (
          <a href="/billing">{t("home.artoOff")}</a>
        )}
      </p>

      <KidSettings k={k} />
    </section>
  );
}

function KidSettings({ k }: { k: DashboardKid }) {
  const { kid } = k;
  return (
    <details className="sheet">
      <summary>{t("home.settings")}</summary>

      <form action={saveKid}>
        <input type="hidden" name="kid" value={kid.id} />
        <div className="field">
          <label htmlFor={`n-${kid.id}`}>{t("home.kidName")}</label>
          <input id={`n-${kid.id}`} name="name" defaultValue={kid.name} required />
        </div>
        <div className="field">
          <label htmlFor={`a-${kid.id}`}>{t("home.kidAge")}</label>
          <input id={`a-${kid.id}`} name="age" type="number" min={7} max={13} defaultValue={kid.age} className="num" />
        </div>
        <div className="field">
          <label htmlFor={`g-${kid.id}`}>{t("home.kidGrade")}</label>
          <select id={`g-${kid.id}`} name="grade" defaultValue={kid.grade}>
            {GRADES.map((g) => (
              <option key={g} value={g}>
                {g}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor={`e-${kid.id}`}>{t("home.kidEmail")}</label>
          <input id={`e-${kid.id}`} name="email" type="email" defaultValue={kid.email ?? ""} />
        </div>
        <div className="field">
          <label>{t("home.kidGender")}</label>
          <div className="seg">
            <label>
              <input type="radio" name="feminine" value="0" defaultChecked={!kid.feminine} />
              {t("join.boy")}
            </label>
            <label>
              <input type="radio" name="feminine" value="1" defaultChecked={kid.feminine} />
              {t("join.girl")}
            </label>
          </div>
        </div>
        <button className="btn small" type="submit">
          {t("home.save")}
        </button>
      </form>

      <h4>{t("home.adults")}</h4>
      <p className="small">{t("home.adultsHint")}</p>
      {k.contacts.map((c) => (
        <form key={c.id} action={dropAdult} className="controls">
          <input type="hidden" name="kid" value={kid.id} />
          <input type="hidden" name="contact" value={c.id} />
          <span>
            {c.name ? `${c.name} · ` : ""}
            <span className="ltr">{c.email}</span>
          </span>
          <button className="btn ghost small" type="submit">
            {t("home.removeAdult")}
          </button>
        </form>
      ))}
      <form action={addAdult}>
        <input type="hidden" name="kid" value={kid.id} />
        <div className="field">
          <label htmlFor={`cn-${kid.id}`}>{t("join.extraName")}</label>
          <input id={`cn-${kid.id}`} name="name" />
        </div>
        <div className="field">
          <label htmlFor={`ce-${kid.id}`}>{t("join.extraEmail")}</label>
          <input id={`ce-${kid.id}`} name="email" type="email" required />
        </div>
        <button className="btn small" type="submit">
          {t("home.addAdult")}
        </button>
      </form>

      <h4>{t("home.linkTitle")}</h4>
      <p className="small">{t("home.newLinkWarn")}</p>
      <form action={newLink}>
        <input type="hidden" name="kid" value={kid.id} />
        <button className="btn ghost small" type="submit">
          {t("home.newLink")}
        </button>
      </form>

      <h4>{t("home.pauseTitle")}</h4>
      <p className="small">{t("home.pauseHint")}</p>
      <form action={setPaused}>
        <input type="hidden" name="kid" value={kid.id} />
        <input type="hidden" name="paused" value={kid.paused ? "0" : "1"} />
        <button className="btn ghost small" type="submit">
          {kid.paused ? t("home.unpause", { name: kid.name }) : t("home.pause", { name: kid.name })}
        </button>
      </form>

      <details className="sheet">
        <summary>{t("home.removeKid", { name: kid.name })}</summary>
        <p className="small">{t("home.removeKidWarn")}</p>
        <form action={dropKid}>
          <input type="hidden" name="kid" value={kid.id} />
          <button className="btn ghost small" type="submit">
            {t("home.removeKidConfirm")}
          </button>
        </form>
      </details>
    </details>
  );
}

/* ---------- 3. history ---------- */

function History({ history, kids, todayN, doneToday }: { history: Dashboard["history"]; kids: DashboardKid[]; todayN: number | null; doneToday: boolean }) {
  return (
    <section className="panel">
      <h2>{t("home.history")}</h2>
      {history.length ? (
        <div className="scroll">
          <table className="table">
            <thead>
              <tr>
                <th>{t("home.colEdition")}</th>
                {kids.map((k) => (
                  <th key={k.kid.id}>{k.kid.name}</th>
                ))}
                <th>{t("home.colPassword")}</th>
              </tr>
            </thead>
            <tbody>
              {history.map((h) => {
                const isToday = h.edition.n === todayN;
                const first = kids[0] ? kidLink(kids[0].kid, APP.url, h.edition.n) : null;
                return (
                  <tr key={h.edition.n}>
                    <td>
                      <a href={first ?? `/l/${h.edition.n}`}>{h.edition.title}</a>
                      <br />
                      <span className="small">{num(shortDate(h.edition.date))}</span>
                    </td>
                    {kids.map((k) => {
                      const r = h.results[k.kid.id];
                      const href = kidLink(k.kid, APP.url, h.edition.n);
                      const label = r ? `${r.complete ? "✓ " : ""}${r.score}/${r.max}` : t("home.none");
                      return (
                        <td key={k.kid.id}>
                          {href ? <a href={href}>{num(label)}</a> : num(label)}
                          {r?.late ? (
                            <>
                              {" "}
                              <span className="tag">{t("home.late")}</span>
                            </>
                          ) : null}
                        </td>
                      );
                    })}
                    <td>
                      {!h.password ? (
                        t("home.none")
                      ) : !isToday || doneToday ? (
                        <b>{h.password}</b>
                      ) : (
                        <details>
                          <summary>{t("home.reveal")}</summary>
                          <b>{h.password}</b>
                        </details>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="cap">{t("home.noHistory")}</p>
      )}
    </section>
  );
}

/* ---------- 4. account ---------- */

function Account({ dash }: { dash: Dashboard }) {
  const { parent } = dash;
  return (
    <section className="panel">
      <h2>{t("home.account")}</h2>
      <p className="cap">
        {t("home.accountEmail")}: <span className="ltr">{parent.email}</span>
      </p>
      <form action={saveAccount}>
        <div className="field">
          <label htmlFor="pname">{t("home.accountName")}</label>
          <input id="pname" name="name" defaultValue={parent.name} />
        </div>
        <div className="field inline">
          <input id="nc" type="checkbox" name="notify_completion" defaultChecked={parent.notify_completion} />
          <label htmlFor="nc">{t("home.notifyCompletion")}</label>
        </div>
        <div className="field inline">
          <input id="nw" type="checkbox" name="notify_weekly" defaultChecked={parent.notify_weekly} />
          <label htmlFor="nw">{t("home.notifyWeekly")}</label>
        </div>
        <div className="field inline">
          <input id="nr" type="checkbox" name="notify_streak_risk" defaultChecked={parent.notify_streak_risk} />
          <label htmlFor="nr">{t("home.notifyStreakRisk")}</label>
        </div>
        <div className="field inline">
          <input id="ke" type="checkbox" name="keep_explanations" defaultChecked={parent.keep_explanations} />
          <label htmlFor="ke">{t("home.keepExplanations")}</label>
        </div>
        <p className="small">{t("home.keepExplanationsHint")}</p>
        <button className="btn small" type="submit">
          {t("home.save")}
        </button>
      </form>

      <p className="controls">
        <a className="btn ghost small" href="/billing">
          {t("home.billing")}
        </a>
        <a className="btn ghost small" href="/home/export">
          {t("home.export")}
        </a>
      </p>
      <p className="small">{t("home.exportHint")}</p>

      <details className="sheet">
        <summary>{t("home.deleteAccount")}</summary>
        <p className="small">{t("home.deleteWarn")}</p>
        <form action={deleteAccount}>
          <div className="field">
            <label htmlFor="confirm">{t("home.deleteConfirmLabel", { word: t("home.deleteWord") })}</label>
            <input id="confirm" name="confirm" required autoComplete="off" />
          </div>
          <button className="btn ghost small" type="submit">
            {t("home.deleteBtn")}
          </button>
        </form>
      </details>

      <form method="post" action="/auth/signout">
        <button className="btn ghost small" type="submit">
          {t("home.signout")}
        </button>
      </form>
    </section>
  );
}

/* ---------- 5. community ---------- */

function Community() {
  return (
    <section className="panel soft">
      <h2>{t("home.community")}</h2>
      <form action={suggestTopic}>
        <div className="field">
          <label htmlFor="idea">{t("home.ideaPrompt")}</label>
          <textarea id="idea" name="idea" rows={3} placeholder={t("home.ideaPlaceholder")} maxLength={500} required />
        </div>
        <button className="btn small" type="submit">
          {t("home.ideaSend")}
        </button>
      </form>
      <p className="controls">
        <a href={`mailto:${APP.editorEmail}`}>{t("home.feedback")}</a>
        <a href={APP.kitRepo} rel="noopener">
          {t("home.github")}
        </a>
        <a href="/open-books">{t("nav.openBooks")}</a>
      </p>
    </section>
  );
}
