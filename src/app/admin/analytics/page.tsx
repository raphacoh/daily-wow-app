import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { requireEditor } from "@/lib/auth";
import { daily, funnel, signups, totals } from "@/lib/analytics";
import { hasDb } from "@/lib/db";

export const metadata: Metadata = { title: "מדדים", robots: { index: false } };
export const dynamic = "force-dynamic";

const pct = (a: number, b: number) => (b > 0 ? Math.round((a / b) * 100) + "%" : "—");

export default async function Analytics({ searchParams }: { searchParams: Promise<{ days?: string }> }) {
  try {
    await requireEditor();
  } catch {
    redirect("/signin");
  }
  if (!hasDb()) return <main className="page"><p className="msg info">אין מסד נתונים.</p></main>;
  const { days: d } = await searchParams;
  const days = Math.max(1, Math.min(365, Number(d) || 30));
  const [f, t, series, people] = await Promise.all([funnel(days), totals(), daily(Math.min(days, 60)), signups(200)]);
  const when = (iso: string) => new Date(iso).toLocaleString("he-IL", { timeZone: "Asia/Jerusalem", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });

  return (
    <main className="page wide">
      <h1>מדדים</h1>
      <p className="cap">
        מדידה עצמית בלבד: בלי עוגיות, בלי צד שלישי. מבקר = גיבוב יומי מתחלף של כתובת ודפדפן.{" "}
        {[7, 30, 90, 365].map((n) => (
          <a key={n} href={`/admin/analytics?days=${n}`} style={{ marginInlineStart: 10, fontWeight: n === days ? 700 : 400 }}>{n} ימים</a>
        ))}
      </p>

      <section className="panel">
        <h3>המשפך · {days} הימים האחרונים</h3>
        <div className="scroll">
          <table className="table">
            <thead><tr><th>שלב</th><th>כמה</th><th>מהשלב הקודם</th><th>מהנחיתה</th></tr></thead>
            <tbody>
              <tr><td>נחתו בעמוד הראשי</td><td className="num">{f.landed}</td><td>—</td><td>—</td></tr>
              <tr><td>התחילו את ההדגמה</td><td className="num">{f.demo_started}</td><td className="num">{pct(f.demo_started, f.landed)}</td><td className="num">{pct(f.demo_started, f.landed)}</td></tr>
              <tr><td>סיימו את ההדגמה (הכספת נפתחה)</td><td className="num">{f.demo_completed}</td><td className="num">{pct(f.demo_completed, f.demo_started)}</td><td className="num">{pct(f.demo_completed, f.landed)}</td></tr>
              <tr><td>נרשמו (משפחות)</td><td className="num">{f.signups}</td><td className="num">{pct(f.signups, f.demo_completed)}</td><td className="num">{pct(f.signups, f.landed)}</td></tr>
              <tr><td>שיעורים שהושלמו על ידי ילדים רשומים</td><td className="num">{f.lessons_completed}</td><td>—</td><td>—</td></tr>
              <tr><td>הפעילו את ארטו (מנויים חדשים)</td><td className="num">{f.subscriptions}</td><td className="num">{pct(f.subscriptions, f.signups)}</td><td className="num">{pct(f.subscriptions, f.landed)}</td></tr>
            </tbody>
          </table>
        </div>
      </section>

      <section className="panel">
        <h3>מי נרשם · {people.length} משפחות</h3>
        <div className="scroll">
          <table className="table">
            <thead><tr><th>מתי</th><th>שם</th><th>מייל</th><th>ילדים</th><th>שיעורים</th><th>ארטו</th><th>פעילות אחרונה</th></tr></thead>
            <tbody>
              {people.length === 0 ? <tr><td colSpan={7} className="small">עוד אין נרשמים.</td></tr> : null}
              {people.map((p) => (
                <tr key={p.email}>
                  <td className="num">{when(p.created_at)}</td>
                  <td>{p.name || "—"}</td>
                  <td className="ltr">{p.email}</td>
                  <td>{p.kids.map((k) => `${k.name} (${k.grade}, ${k.level === "advanced" ? "מתקדם" : k.level === "support" ? "עזרה" : "רגיל"})`).join(", ") || "—"}</td>
                  <td className="num">{p.kids.reduce((a, k) => a + k.completions, 0)}</td>
                  <td>{p.paying ? "משלם" : "חינם"}</td>
                  <td className="num">{p.last_completion ? when(p.last_completion) : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="panel">
        <h3>סך הכל, עכשיו</h3>
        <div className="scroll">
          <table className="table">
            <tbody>
              <tr><td>משפחות</td><td className="num">{t.families}</td></tr>
              <tr><td>ילדים</td><td className="num">{t.kids}</td></tr>
              <tr><td>שיעורים שהושלמו</td><td className="num">{t.lessons_completed}</td></tr>
              <tr><td>ילדים שהשלימו לפחות שיעור אחד</td><td className="num">{t.kids_who_completed}</td></tr>
              <tr><td>ילדים משלמים (מנוי פעיל)</td><td className="num">{t.paying_kids}</td></tr>
              <tr><td>משפחות משלמות</td><td className="num">{t.paying_families}</td></tr>
            </tbody>
          </table>
        </div>
      </section>

      <section className="panel">
        <h3>לפי יום</h3>
        <div className="scroll">
          <table className="table">
            <thead><tr><th>יום</th><th>נחתו</th><th>התחילו</th><th>סיימו</th><th>נרשמו</th><th>שיעורים</th><th>מנויים</th></tr></thead>
            <tbody>
              {series.length === 0 ? <tr><td colSpan={7} className="small">עוד אין נתונים.</td></tr> : null}
              {series.map((r) => (
                <tr key={r.day}>
                  <td className="num">{r.day}</td><td className="num">{r.landed}</td><td className="num">{r.demo_started}</td><td className="num">{r.demo_completed}</td><td className="num">{r.signups}</td><td className="num">{r.lessons}</td><td className="num">{r.subscriptions}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      <p className="small"><a href="/admin">› חזרה לעורך</a></p>
    </main>
  );
}
