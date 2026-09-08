import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { NotSignedIn, requireEditor } from "@/lib/auth";
import { hasDb } from "@/lib/db";
import { APP, getConfig } from "@/lib/config";
import {
  adminStats,
  findParentByEmail,
  listAdminEditions,
  listMenus,
  listTopicIdeas,
  recentFamilies,
  type AdminEdition,
} from "@/lib/admin";
import { grantAssistantAction, holdAction, releaseAction, republishAction, saveConfigAction, testMailAction } from "./actions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "עורך", robots: { index: false, follow: false } };

const CONFIG_FIELDS: { key: string; label: string; hint?: string }[] = [
  { key: "assistant_daily_cap", label: "תקרת הודעות למנוי (ליום)" },
  { key: "free_messages_per_day", label: "הודעות חינם ליום (על חשבון העורך)" },
  { key: "demo_pool_per_day", label: "מאגר הדגמה יומי (אנונימיים)" },
  { key: "model", label: "מודל" },
  { key: "send_time", label: "שעת השליחה", hint: `${APP.timezone}` },
  { key: "resend_daily_limit", label: "תקרת Resend ליום" },
];

const STATUS_UI: Record<string, { label: string; cls: string }> = {
  released: { label: "שוחרר", cls: "pill ok" },
  staged: { label: "ממתין", cls: "pill sun" },
  held: { label: "מוחזק", cls: "pill bad" },
};

function one(v: string | string[] | undefined): string {
  return Array.isArray(v) ? (v[0] ?? "") : (v ?? "");
}

function shortDate(iso: string | null): string {
  return iso ? iso.slice(0, 10) : "—";
}

export default async function AdminPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  let me;
  try {
    me = await requireEditor();
  } catch (e) {
    if (e instanceof NotSignedIn) redirect("/signin?next=/admin");
    throw e;
  }

  const sp = await searchParams;
  const msg = one(sp.msg);
  const err = one(sp.err);
  const q = one(sp.q).trim();

  if (!hasDb()) {
    return (
      <main className="page wide">
        <h1>עורך</h1>
        <div className="msg bad">אין מסד נתונים מוגדר בשרת הזה.</div>
      </main>
    );
  }

  const [editions, stats, families, menus, ideas, found, config] = await Promise.all([
    listAdminEditions(40),
    adminStats(),
    recentFamilies(20),
    listMenus(10),
    listTopicIdeas(20),
    q ? findParentByEmail(q) : Promise.resolve(null),
    Promise.all(CONFIG_FIELDS.map(async (f) => [f.key, await getConfig(f.key)] as const)).then((pairs) => Object.fromEntries(pairs)),
  ]);

  return (
    <main className="page wide">
      <h1>עורך</h1>
      <p className="cap">
        {APP.name} · {me.email}
      </p>

      {msg ? <div className="msg ok">{msg}</div> : null}
      {err ? <div className="msg bad">{err}</div> : null}

      {/* ---------- numbers ---------- */}
      <section className="grid three">
        <div className="panel">
          <p className="cap">משפחות / ילדים</p>
          <h2 className="num">
            {stats.families} / {stats.kids}
          </h2>
          <p className="small">{stats.activeSubs} מנויים פעילים</p>
        </div>
        <div className="panel">
          <p className="cap">הודעות החודש ({stats.month.label})</p>
          <h2 className="num">{stats.month.messages}</h2>
          <p className="small">
            שיחה {stats.month.chat} · בדיקה {stats.month.grade} · הדגמה {stats.month.demo}
          </p>
        </div>
        <div className="panel">
          <p className="cap">עלות טוקנים החודש</p>
          <h2 className="num">${stats.month.cost.toFixed(2)}</h2>
          <p className="small num">
            {stats.month.input_tokens.toLocaleString("en-US")} in · {stats.month.output_tokens.toLocaleString("en-US")} out
          </p>
        </div>
      </section>

      {/* ---------- editions ---------- */}
      <section className="panel">
        <h3>גיליונות</h3>
        <p className="cap">40 האחרונים, בכל הסטטוסים. שחרור שולח מיד לכל המשפחות.</p>
        <div className="scroll">
          <table className="table">
            <thead>
              <tr>
                <th>#</th>
                <th>תאריך</th>
                <th>כותרת</th>
                <th>סטטוס</th>
                <th>ביקורת</th>
                <th>קישורים</th>
                <th>פעולות</th>
              </tr>
            </thead>
            <tbody>
              {editions.map((e) => (
                <EditionRow key={e.n} e={e} />
              ))}
              {editions.length === 0 ? (
                <tr>
                  <td colSpan={7} className="small">
                    עוד אין גיליונות. הבנאי הלילי יעלה את הראשון.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>

      {/* ---------- scope audit ---------- */}
      <section className="panel">
        <h3>ארטו — ביקורת נושא</h3>
        <p className="cap">14 הימים האחרונים. התראה מעל {stats.alertPct}% הודעות מחוץ לנושא.</p>
        <div className="scroll">
          <table className="table">
            <thead>
              <tr>
                <th>גיליון</th>
                <th>הודעות</th>
                <th>מחוץ לנושא</th>
                <th>שיעור</th>
              </tr>
            </thead>
            <tbody>
              {stats.scope.map((s) => (
                <tr key={s.edition_n}>
                  <td className="num">#{s.edition_n}</td>
                  <td className="num">{s.messages}</td>
                  <td className="num">{s.off}</td>
                  <td>
                    <span className={s.alert ? "pill bad" : "pill"}>
                      <span className="num">{s.pct}%</span>
                      {s.alert ? " גבוה" : ""}
                    </span>
                  </td>
                </tr>
              ))}
              {stats.scope.length === 0 ? (
                <tr>
                  <td colSpan={4} className="small">
                    עוד אין שימוש בעוזר בשבועיים האחרונים.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
        <details className="sheet">
          <summary>20 הפניות האחרונות מחוץ לנושא (אנונימי, נמחק אחרי 7 ימים)</summary>
          {stats.offPrompts.length ? (
            <ul className="small">
              {stats.offPrompts.map((o, i) => (
                <li key={i}>
                  <span className="num">#{o.edition_n ?? "?"}</span> · {shortDate(o.at)} · {o.text}
                </li>
              ))}
            </ul>
          ) : (
            <p className="small">אין. יפה.</p>
          )}
        </details>
      </section>

      {/* ---------- families ---------- */}
      <section className="panel">
        <h3>משפחות</h3>
        <p className="cap">
          <span className="num">{stats.families}</span> משפחות, <span className="num">{stats.kids}</span> ילדים. כאן רק מה שצריך כדי לענות למייל תמיכה.
        </p>

        <form method="get" className="controls">
          <div className="field" style={{ flex: "1 1 260px", margin: 0 }}>
            <label htmlFor="q">חיפוש לפי מייל</label>
            <input id="q" name="q" type="email" defaultValue={q} placeholder="parent@example.com" dir="ltr" />
          </div>
          <button className="btn small" type="submit">
            חיפוש
          </button>
        </form>

        {q && !found ? <div className="msg info">לא נמצאה משפחה עם המייל הזה.</div> : null}
        {found ? (
          <div className="panel soft">
            <h3>
              {found.name || "—"} <span className="small ltr">{found.email}</span>
            </h3>
            <p className="small">נרשמו ב-{shortDate(found.created_at)}</p>
            <div className="scroll">
              <table className="table">
                <thead>
                  <tr>
                    <th>ילד/ה</th>
                    <th>גיל / כיתה</th>
                    <th>רמה</th>
                    <th>רצף / XP</th>
                    <th>ארטו</th>
                    <th>מתנה עד</th>
                  </tr>
                </thead>
                <tbody>
                  {found.children.map((k) => (
                    <tr key={k.id}>
                      <td>
                        {k.name}
                        {k.paused ? <span className="pill"> מושהה</span> : null}
                      </td>
                      <td className="num">
                        {k.age} / {k.grade}
                      </td>
                      <td>{k.level}</td>
                      <td className="num">
                        {k.streak} / {k.xp}
                      </td>
                      <td>{k.subscription ?? "—"}</td>
                      <td>
                        <form action={grantAssistantAction} className="controls" style={{ margin: 0 }}>
                          <input type="hidden" name="kid_id" value={k.id} />
                          <input type="date" name="until" defaultValue={shortDate(k.free_assistant_until)} required aria-label={`ארטו חינם ל${k.name} עד`} />
                          <button className="btn small ghost" type="submit">
                            שמירה
                          </button>
                        </form>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ) : null}

        <details className="sheet">
          <summary>20 ההרשמות האחרונות</summary>
          <div className="scroll">
            <table className="table">
              <thead>
                <tr>
                  <th>שם</th>
                  <th>מייל</th>
                  <th>ילדים</th>
                  <th>תאריך</th>
                </tr>
              </thead>
              <tbody>
                {families.map((f) => (
                  <tr key={f.id}>
                    <td>
                      {f.name || "—"}
                      {f.is_editor ? <span className="pill sun"> עורך</span> : null}
                    </td>
                    <td className="ltr">{f.email}</td>
                    <td className="num">{f.kids}</td>
                    <td className="num">{shortDate(f.created_at)}</td>
                  </tr>
                ))}
                {families.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="small">
                      עוד אין משפחות.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </details>
      </section>

      {/* ---------- menus + ideas ---------- */}
      <section className="panel">
        <h3>תפריטי נושאים</h3>
        <p className="cap">מה הוצע לכל גיליון ומה נבחר.</p>
        <div className="scroll">
          <table className="table">
            <thead>
              <tr>
                <th>גיליון</th>
                <th>לתאריך</th>
                <th>ברירת מחדל</th>
                <th>נבחר</th>
                <th>מי החליט</th>
              </tr>
            </thead>
            <tbody>
              {menus.map((m) => (
                <tr key={m.n}>
                  <td className="num">#{m.n}</td>
                  <td className="num">{m.for_date ?? "—"}</td>
                  <td className="num">{m.default_k ?? "—"}</td>
                  <td>{m.chosen_title ?? m.chosen ?? "—"}</td>
                  <td>{m.decided_by ?? "—"}</td>
                </tr>
              ))}
              {menus.length === 0 ? (
                <tr>
                  <td colSpan={5} className="small">
                    עוד אין תפריטים.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
        <details className="sheet">
          <summary>רעיונות מהורים שעוד לא נוצלו ({ideas.length})</summary>
          {ideas.length ? (
            <ul className="small">
              {ideas.map((i) => (
                <li key={i.id}>
                  {i.text} <span className="cap">— {i.from || "אנונימי"}, {shortDate(i.created_at)}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="small">אין רעיונות פתוחים.</p>
          )}
        </details>
      </section>

      {/* ---------- jobs + sends ---------- */}
      <section className="grid two">
        <div className="panel">
          <h3>ריצות</h3>
          <div className="scroll">
            <table className="table">
              <thead>
                <tr>
                  <th>עבודה</th>
                  <th>התחילה</th>
                  <th>תוצאה</th>
                </tr>
              </thead>
              <tbody>
                {stats.jobs.map((j) => (
                  <tr key={j.id}>
                    <td>{j.job}</td>
                    <td className="num">{j.started_at.slice(0, 16).replace("T", " ")}</td>
                    <td>
                      <span className={j.ok === null ? "pill" : j.ok ? "pill ok" : "pill bad"}>{j.ok === null ? "רצה" : j.ok ? "תקין" : "נכשל"}</span>
                      {j.detail ? <div className="small">{j.detail}</div> : null}
                    </td>
                  </tr>
                ))}
                {stats.jobs.length === 0 ? (
                  <tr>
                    <td colSpan={3} className="small">
                      עוד לא רצה כלום.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </div>
        <div className="panel">
          <h3>שליחות אחרונות</h3>
          <div className="scroll">
            <table className="table">
              <thead>
                <tr>
                  <th>סוג</th>
                  <th>גיליון</th>
                  <th>נמענים</th>
                  <th>מתי</th>
                </tr>
              </thead>
              <tbody>
                {stats.sends.map((s, i) => (
                  <tr key={i}>
                    <td>{s.kind}</td>
                    <td className="num">{s.edition_n === null ? "—" : `#${s.edition_n}`}</td>
                    <td className="num">{s.recipients}</td>
                    <td className="num">{s.sent_at.slice(0, 16).replace("T", " ")}</td>
                  </tr>
                ))}
                {stats.sends.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="small">
                      עוד לא נשלח כלום.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      {/* ---------- config ---------- */}
      <section className="panel">
        <h3>הגדרות</h3>
        <p className="cap">משתנה סביבה גובר על מה שנשמר כאן. השינוי נכנס לתוקף מיד.</p>
        <form action={saveConfigAction}>
          <div className="grid two">
            {CONFIG_FIELDS.map((f) => (
              <div className="field" key={f.key}>
                <label htmlFor={f.key}>{f.label}</label>
                <input id={f.key} name={f.key} defaultValue={config[f.key] ?? ""} dir="ltr" />
                {f.hint ? <span className="hint">{f.hint}</span> : null}
              </div>
            ))}
          </div>
          <button className="btn" type="submit">
            שמירה
          </button>
        </form>
      </section>
    </main>
  );
}

/* ------------------------------------------------------------------ *
 * One edition row: the status at a glance, the actions behind a fold.
 * ------------------------------------------------------------------ */

function EditionRow({ e }: { e: AdminEdition }) {
  const ui = STATUS_UI[e.status] ?? { label: e.status, cls: "pill" };
  const released = e.status === "released";
  return (
    <tr>
      <td className="num">{e.n}</td>
      <td className="num">{e.date}</td>
      <td>
        {e.title}
        {e.edited_by_editor ? <span className="pill nile"> נגע בו עורך</span> : null}
        {e.topics.length ? <div className="small">{e.topics.join(" · ")}</div> : null}
      </td>
      <td>
        <span className={ui.cls}>{ui.label}</span>
        {!e.has_html ? <div className="small">אין פראגמנט</div> : null}
      </td>
      <td className="small">{e.reviewer_verdict ?? "—"}</td>
      <td className="small">
        {e.review_url ? (
          <a href={e.review_url} rel="noopener">
            ביקורת
          </a>
        ) : null}
        {e.review_url ? " · " : null}
        <a href={`/l/${e.n}`}>השיעור</a>
      </td>
      <td>
        <div className="controls" style={{ margin: 0 }}>
          {!released ? (
            <form action={holdAction}>
              <input type="hidden" name="n" value={e.n} />
              <button className="btn small ghost" type="submit" disabled={e.status === "held"}>
                החזקה
              </button>
            </form>
          ) : (
            <form action={republishAction}>
              <input type="hidden" name="n" value={e.n} />
              <button className="btn small ghost" type="submit">
                שליחה מחדש
              </button>
            </form>
          )}
          <form action={testMailAction}>
            <input type="hidden" name="n" value={e.n} />
            <button className="btn small ghost" type="submit">
              מייל בדיקה אליי
            </button>
          </form>
        </div>
        {!released ? (
          <details className="sheet">
            <summary>שחרור</summary>
            <form action={releaseAction}>
              <input type="hidden" name="n" value={e.n} />
              <div className="field">
                <label htmlFor={`note-${e.n}`}>הערה מרף (נכנסת למייל היומי)</label>
                <textarea id={`note-${e.n}`} name="editor_note" rows={2} defaultValue={e.editor_note ?? ""} />
              </div>
              <div className="field inline">
                <input id={`edited-${e.n}`} type="checkbox" name="edited_by_editor" defaultChecked={e.edited_by_editor} />
                <label htmlFor={`edited-${e.n}`}>ערכתי אותו ביד</label>
              </div>
              <div className="field inline">
                <input id={`send-${e.n}`} type="checkbox" name="send" defaultChecked />
                <label htmlFor={`send-${e.n}`}>לשלוח לכל המשפחות עכשיו</label>
              </div>
              <button className="btn small" type="submit">
                שחרור #{e.n}
              </button>
            </form>
          </details>
        ) : null}
      </td>
    </tr>
  );
}
