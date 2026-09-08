import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { freshDb, seedEdition, seedParent } from "./setup";
import { createKid, kidByToken, recordCompletion } from "@/lib/kids";
import { setMailer, type Mail } from "@/lib/emails";
import { invalidateConfigCache } from "@/lib/config";
import { addDays, isoWeekKey, nightly, sendDaily, sendStreakRisk, sendWeekly } from "@/lib/jobs";
import { GET as sendDailyRoute } from "@/app/api/jobs/send-daily/route";
import type { Db } from "@/lib/db";

const YESTERDAY = "2026-09-07";
const TODAY = "2026-09-08";
/** Asia/Jerusalem is UTC+3 in September (IDT). */
const at = (d: string, h: number, m = 0) => new Date(`${d}T${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:00+03:00`);

const PASSWORD = "SECRET-OF-THE-SKY";

let db: Db;
let parentA: string;
let kid1: { id: string; token: string };
let kid2: { id: string; token: string };
const mails: Mail[] = [];

async function sendsOf(kind: string) {
  const r = await db.query<{ n: number }>("select count(*)::int as n from sends where kind = $1", [kind]);
  return r.rows[0].n;
}

describe("scheduled jobs", () => {
  beforeAll(async () => {
    db = (await freshDb()).db;
    invalidateConfigCache();
    setMailer(async (m) => {
      mails.push(m);
      return { id: `re_${mails.length}` };
    });

    // --- family A: two kids (one with an email), one extra adult, one contact that opted out ---
    parentA = await seedParent(db, { email: "parent@example.com", name: "רף" });
    kid1 = await createKid(parentA, { name: "אמה", feminine: true, age: 11, grade: "ו", level: "on_track", email: "emma@example.com" });
    kid2 = await createKid(parentA, { name: "נועם", feminine: false, age: 9, grade: "ד", level: "standard" });
    await db.query("insert into kid_contacts (kid_id, name, email, notify_daily) values ($1,'סבתא','savta@example.com',true)", [kid1.id]);
    await db.query("insert into kid_contacts (kid_id, name, email, notify_daily) values ($1,'דוד','quiet@example.com',false)", [kid1.id]);
    // the same address as the parent, differently cased — must collapse to one recipient
    await db.query("insert into kid_contacts (kid_id, name, email, notify_daily) values ($1,'אבא','PARENT@Example.com',true)", [kid2.id]);

    // --- family B: its only kid is paused → not an active family ---
    const parentB = await seedParent(db, { email: "paused@example.com" });
    const kidB = await createKid(parentB, { name: "יונתן", feminine: false, age: 10, grade: "ה", level: "standard" });
    await db.query("update kids set paused = true where id = $1", [kidB.id]);

    await seedEdition(db, 1, YESTERDAY, { title: "גיליון אתמול", password: "pw1" });
    await seedEdition(db, 2, TODAY, { title: "למה השמיים כחולים", password: PASSWORD });
    await db.query("update editions set teaser = $2, editor_note = $3 where n = $1", [
      2,
      "אם האוויר שקוף, למה השמיים כחולים ולא שקופים?",
      "הגיליון הזה יצא קצת ארוך — שווה את זה.",
    ]);

    // kid1 finished yesterday's edition on time → a live streak of 1 today
    const k1 = (await kidByToken(kid1.token))!;
    await recordCompletion(k1, { edition_n: 1, score: 10, max: 11, complete: true, challenge: false, now: at(YESTERDAY, 16) });
  });

  afterAll(() => setMailer(null));

  /* ---------------- daily ---------------- */

  it("sends exactly one mail per active family, with deduped recipients", async () => {
    const r = await sendDaily(2, { now: at(TODAY, 11, 10) });
    expect(r.errors).toEqual([]);
    expect(r.sent).toBe(1);
    expect(mails).toHaveLength(1);

    // parent + kid email + the opted-in extra adult; the opted-out contact and the duplicate are gone
    expect(mails[0].to).toEqual(["parent@example.com", "emma@example.com", "savta@example.com"]);
    expect(mails[0].subject).toContain("#2");
    expect(mails[0].replyTo).toBeTruthy();
    // the paused-only family was never a candidate
    expect(await sendsOf("daily")).toBe(1);
  });

  it("puts each kid's personal link in the mail and never the password", async () => {
    const html = mails[0].html;
    for (const kid of [kid1, kid2]) {
      expect(html).toContain(`/l/2?k=${encodeURIComponent(kid.token)}`);
    }
    expect(html).toContain("?k=");
    expect(html).not.toContain(PASSWORD);
    expect(mails[0].text).not.toContain(PASSWORD);
    // the teaser and the editor's note travel with it
    expect(html).toContain("למה השמיים כחולים");
    expect(html).toContain("שווה את זה");
    // kid1's live streak, derived from yesterday's completion
    expect(mails[0].text).toContain("רצף של 1 ימים");
  });

  it("is idempotent: a second run skips, force resends without duplicating the claim", async () => {
    const again = await sendDaily(2, { now: at(TODAY, 11, 20) });
    expect(again.sent).toBe(0);
    expect(again.skipped).toBe(1);
    expect(mails).toHaveLength(1);

    const forced = await sendDaily(2, { now: at(TODAY, 11, 30), force: true });
    expect(forced.sent).toBe(1);
    expect(mails).toHaveLength(2);
    expect(await sendsOf("daily")).toBe(1); // still one row: force replaced it
  });

  it("refuses an edition that is not released", async () => {
    await seedEdition(db, 3, "2026-09-09", { status: "staged" });
    const r = await sendDaily(3, { now: at("2026-09-09", 11, 10) });
    expect(r.errors).toContain("edition_not_released");
    expect(r.sent).toBe(0);
  });

  /* ---------------- weekly ---------------- */

  it("sends one weekly recap per parent per ISO week", async () => {
    const before = mails.length;
    const r = await sendWeekly(at(TODAY, 18, 5));
    expect(r.errors).toEqual([]);
    expect(r.sent).toBe(1);
    expect(mails).toHaveLength(before + 1);
    const weekly = mails[mails.length - 1];
    expect(weekly.to).toEqual(["parent@example.com"]);
    expect(weekly.subject).toContain("השבוע שהיה");
    expect(weekly.text).toContain("אמה — 1 מתוך 7"); // yesterday's completion, six empty days

    const key = await db.query<{ week_key: string }>("select week_key from sends where kind = 'weekly'");
    expect(key.rows[0].week_key).toBe(isoWeekKey(TODAY));

    const again = await sendWeekly(at(TODAY, 19));
    expect(again.sent).toBe(0);
    expect(again.skipped).toBe(1);
    expect(mails).toHaveLength(before + 1);
  });

  it("holds the weekly mail until 18:00 in the family's own timezone", async () => {
    // a fresh week so idempotency is not what stops it
    const early = await sendWeekly(at(addDays(TODAY, 7), 9));
    expect(early.sent).toBe(0);
    expect(early.skipped).toBe(1);
    const late = await sendWeekly(at(addDays(TODAY, 7), 18, 5));
    expect(late.sent).toBe(1);
  });

  /* ---------------- streak risk ---------------- */

  it("nudges only kids with a live streak and today's edition still open, once per (kid, edition)", async () => {
    const before = mails.length;
    // default is off — nothing goes out
    expect((await sendStreakRisk(at(TODAY, 19, 30))).sent).toBe(0);
    await db.query("update parents set notify_streak_risk = true where id = $1", [parentA]);

    const r = await sendStreakRisk(at(TODAY, 19, 30));
    expect(r.errors).toEqual([]);
    expect(r.sent).toBe(1); // kid1 has a streak of 1; kid2 has none
    const risk = mails[mails.length - 1];
    expect(risk.to).toEqual(["parent@example.com"]);
    expect(risk.subject).toContain("אמה");
    expect(mails).toHaveLength(before + 1);

    expect((await sendStreakRisk(at(TODAY, 20))).sent).toBe(0);
    expect(mails).toHaveLength(before + 1);
    expect(await sendsOf("risk")).toBe(1);

    // and once the kid finishes, the nudge is moot even for a fresh (kid, edition) pair
    const k1 = (await kidByToken(kid1.token))!;
    await recordCompletion(k1, { edition_n: 2, score: 11, max: 11, complete: true, challenge: false, now: at(TODAY, 20, 30) });
    await db.query("delete from sends where kind = 'risk'");
    expect((await sendStreakRisk(at(TODAY, 21))).sent).toBe(0);
  });

  it("stays quiet before 19:00 local", async () => {
    await db.query("delete from sends where kind = 'risk'");
    await db.query("delete from completions where kid_id = $1 and edition_n = 2", [kid1.id]);
    expect((await sendStreakRisk(at(TODAY, 17))).sent).toBe(0);
    expect((await sendStreakRisk(at(TODAY, 19))).sent).toBe(1);
  });

  /* ---------------- nightly ---------------- */

  it("nightly drops expired assistant sessions and leaves streaks alone", async () => {
    await db.query("insert into arto_sessions (key, edition_n, expires_at) values ('demo', 2, now() - interval '1 hour')");
    await db.query("insert into arto_sessions (key, edition_n, expires_at) values ('demo', 2, now() + interval '1 hour')");
    const statsBefore = await db.query("select streak, xp from kid_stats where kid_id = $1", [kid1.id]);
    const r = await nightly(at(TODAY, 1));
    expect(r.errors).toEqual([]);
    expect(r.sessions).toBe(1);
    const left = await db.query<{ n: number }>("select count(*)::int as n from arto_sessions");
    expect(left.rows[0].n).toBe(1);
    const statsAfter = await db.query("select streak, xp from kid_stats where kid_id = $1", [kid1.id]);
    expect(statsAfter.rows[0]).toEqual(statsBefore.rows[0]);
  });

  /* ---------------- the route + send-time gate ---------------- */

  describe("POST/GET /api/jobs/send-daily", () => {
    const url = (q: string) => `http://localhost:3000/api/jobs/send-daily${q}`;
    const auth = { authorization: "Bearer test-cron-secret" };

    beforeAll(() => {
      process.env.CRON_SECRET = "test-cron-secret";
    });

    it("401s without the cron bearer, 503s when CRON_SECRET is unset", async () => {
      expect((await sendDailyRoute(new Request(url("")))).status).toBe(401);
      expect((await sendDailyRoute(new Request(url(""), { headers: { authorization: "Bearer wrong" } }))).status).toBe(401);
      const saved = process.env.CRON_SECRET;
      delete process.env.CRON_SECRET;
      expect((await sendDailyRoute(new Request(url("")))).status).toBe(503);
      process.env.CRON_SECRET = saved;
    });

    it("does nothing before send_time in the editor's timezone", async () => {
      // 02:00Z = 05:00 Asia/Jerusalem, well before 11:05
      const res = await sendDailyRoute(new Request(url("?now=2026-09-08T02:00:00Z"), { headers: auth }));
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toMatchObject({ sent: 0, reason: "too_early", local_time: "05:00", send_time: "11:05" });
    });

    it("picks today's released edition once the gate opens", async () => {
      // 09:00Z = 12:00 Asia/Jerusalem
      const res = await sendDailyRoute(new Request(url("?now=2026-09-08T09:00:00Z"), { headers: auth }));
      const body = await res.json();
      expect(body.edition_n).toBe(2);
      expect(body.reason).toBeUndefined();
      expect(body.sent).toBe(0); // already sent above — idempotent
    });

    it("force bypasses the gate", async () => {
      const before = mails.length;
      const res = await sendDailyRoute(new Request(url("?now=2026-09-08T02:00:00Z&force=1&n=2"), { headers: auth }));
      const body = await res.json();
      expect(body).toMatchObject({ edition_n: 2, sent: 1 });
      expect(mails).toHaveLength(before + 1);
    });

    it("reports no_edition_today when nothing is released for today", async () => {
      const res = await sendDailyRoute(new Request(url("?now=2026-09-20T09:00:00Z"), { headers: auth }));
      expect(await res.json()).toMatchObject({ sent: 0, reason: "no_edition_today" });
    });
  });
});
