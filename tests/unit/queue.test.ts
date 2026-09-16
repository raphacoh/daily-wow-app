import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { freshDb, seedEdition, seedParent } from "./setup";
import { createKid } from "@/lib/kids";
import { setMailer, type Mail } from "@/lib/emails";
import { invalidateConfigCache } from "@/lib/config";
import { approveEdition, queueState, releaseQueued, requestChanges, stageEdition } from "@/lib/admin";
import type { Db } from "@/lib/db";

/** Asia/Jerusalem is UTC+3 in September (IDT). Past `send_time` (11:05), so the gate is open. */
const at = (d: string, h: number, m = 0) => new Date(`${d}T${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:00+03:00`);
const TODAY = "2026-09-11";

/** The smallest fragment `validateFragment` accepts. */
const FRAGMENT =
  '<title>שורשים וכנפיים #9 · נושא</title><script>const RUNTIME = 1;</script>' +
  '<div data-track="younger"></div><div data-track="older"></div>' +
  '<div data-level="advanced"></div><script>function checkChallenge(){}</script>';

let db: Db;
const mails: Mail[] = [];

describe("the reviewed queue", () => {
  beforeAll(async () => {
    db = (await freshDb()).db;
    invalidateConfigCache();
    setMailer(async (m) => {
      mails.push(m);
      return { id: `re_${mails.length}` };
    });
    const parent = await seedParent(db, { email: "parent@example.com", name: "רף" });
    await createKid(parent, { name: "אמה", feminine: true, age: 11, grade: "ו", level: "standard" });
  });

  beforeEach(async () => {
    mails.length = 0;
    await db.query("delete from sends");
    await db.query("delete from editions");
  });

  it("stages a draft with no date: which day it goes out is not known yet", async () => {
    const e = await stageEdition({ n: 10, html: FRAGMENT, title: "ציפורים" });
    expect(e.status).toBe("staged");
    expect(e.date).toBeNull();
  });

  it("still rejects a date that is not a date", async () => {
    await expect(stageEdition({ n: 10, date: "11/09/2026", html: FRAGMENT })).rejects.toThrow();
  });

  it("releases the oldest approved edition and stamps today on it", async () => {
    await stageEdition({ n: 10, html: FRAGMENT, title: "הראשון בתור" });
    await stageEdition({ n: 11, html: FRAGMENT, title: "השני בתור" });
    await approveEdition(11);
    await approveEdition(10);

    const r = await releaseQueued({ now: at(TODAY, 12) });
    expect(r.released).toBe(10);
    expect(r.sent).toBe(1);

    // read them back the way the app does, not off the raw row
    const { getEdition } = await import("@/lib/editions");
    expect(await getEdition(10)).toMatchObject({ n: 10, status: "released", date: TODAY });
    // the rest of the queue is untouched and still dateless
    expect(await getEdition(11, { includeStaged: true })).toMatchObject({ n: 11, status: "approved", date: null });
  });

  it("never sends a draft the editor has not approved", async () => {
    await stageEdition({ n: 10, html: FRAGMENT, title: "טיוטה" });
    const r = await releaseQueued({ now: at(TODAY, 12) });
    expect(r.released).toBeNull();
    expect(r.reason).toBe("queue_empty");
    expect(r.sent).toBe(0);
    const still = await db.query<{ status: string }>("select status from editions where n = 10");
    expect(still.rows[0].status).toBe("staged");
  });

  it("mails the editor when the queue is empty, once, however often the cron fires", async () => {
    await stageEdition({ n: 10, html: FRAGMENT, title: "טיוטה" });
    await releaseQueued({ now: at(TODAY, 12) });
    await releaseQueued({ now: at(TODAY, 13) });
    const warnings = mails.filter((m) => m.subject.includes("אין גיליון מאושר"));
    expect(warnings).toHaveLength(1);
    // and it says plainly that nobody got a lesson
    expect(warnings[0].text).toContain("לא יצא שיעור");
    expect(await db.query("select count(*)::int as n from sends where kind = 'queue'")).toMatchObject({
      rows: [{ n: 1 }],
    });
  });

  it("warns when the queue is running low, after sending", async () => {
    await stageEdition({ n: 10, html: FRAGMENT, title: "אחד" });
    await approveEdition(10);
    const r = await releaseQueued({ now: at(TODAY, 12) });
    expect(r.released).toBe(10);
    expect(r.ready).toBe(0);
    expect(mails.some((m) => m.subject.includes("התור מתקצר"))).toBe(true);
  });

  it("is safe to run twice: the second firing releases nothing", async () => {
    await stageEdition({ n: 10, html: FRAGMENT, title: "אחד" });
    await stageEdition({ n: 11, html: FRAGMENT, title: "שניים" });
    await approveEdition(10);
    await approveEdition(11);

    const first = await releaseQueued({ now: at(TODAY, 12) });
    const second = await releaseQueued({ now: at(TODAY, 12, 30) });
    expect(first.released).toBe(10);
    expect(second.released).toBeNull();
    expect(second.reason).toBe("already_released_today");
    // and #11 is still waiting for tomorrow, not sent early
    const row = await db.query<{ status: string }>("select status from editions where n = 11");
    expect(row.rows[0].status).toBe("approved");
  });

  it("takes a draft out of the queue when changes are requested, and keeps the note", async () => {
    await stageEdition({ n: 10, html: FRAGMENT, title: "טיוטה" });
    await approveEdition(10);
    expect((await queueState()).ready).toEqual([10]);

    await requestChanges(10, "האינטראקטיב השני לא ברור בטלפון");
    const q = await queueState();
    expect(q.ready).toEqual([]);
    expect(q.next).toBeNull();

    const row = await db.query<{ status: string; revision_note: string }>("select status, revision_note from editions where n = 10");
    expect(row.rows[0].status).toBe("held");
    expect(row.rows[0].revision_note).toContain("לא ברור בטלפון");
  });

  it("clears a stale revision note when the builder restages the draft", async () => {
    await stageEdition({ n: 10, html: FRAGMENT, title: "טיוטה" });
    await requestChanges(10, "עוד מספרים אמיתיים");
    await stageEdition({ n: 10, html: FRAGMENT, title: "טיוטה מתוקנת" });
    const row = await db.query<{ status: string; revision_note: string | null }>("select status, revision_note from editions where n = 10");
    expect(row.rows[0]).toMatchObject({ status: "staged", revision_note: null });
  });

  it("refuses to approve or re-release something families already got", async () => {
    await seedEdition(db, 10, TODAY, { html: FRAGMENT, status: "released" });
    await expect(approveEdition(10)).rejects.toThrow();
  });
});
