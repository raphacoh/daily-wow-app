import { beforeAll, describe, expect, it } from "vitest";
import { freshDb, seedEdition, seedParent } from "./setup";
import { createKid, kidByToken, liveStreak, rebuildStats, recordCompletion } from "@/lib/kids";
import type { Db } from "@/lib/db";

let db: Db;
let token: string;
const at = (d: string, h = 10) => new Date(`${d}T${String(h).padStart(2, "0")}:00:00+03:00`);

describe("completions → streak / XP / badges", () => {
  beforeAll(async () => {
    db = (await freshDb()).db;
    const parent = await seedParent(db);
    for (let i = 1; i <= 6; i++) await seedEdition(db, i, `2026-09-0${i}`);
    await seedEdition(db, 7, "2026-09-07", { status: "staged" });
    token = (await createKid(parent, { name: "אמה", feminine: true, age: 11, grade: "ו", level: "on_track" })).token;
  });

  it("rejects an unreleased edition and unknown tokens", async () => {
    const kid = (await kidByToken(token))!;
    expect(kid).toBeTruthy();
    expect(await kidByToken("nope")).toBeNull();
    const r = await recordCompletion(kid, { edition_n: 7, score: 11, max: 11, complete: true, challenge: false, now: at("2026-09-07") });
    expect(r.ok).toBe(false);
  });

  it("awards XP with the streak bonus on the first complete day", async () => {
    const kid = (await kidByToken(token))!;
    const r = await recordCompletion(kid, { edition_n: 1, score: 9, max: 11, complete: true, challenge: false, now: at("2026-09-01") });
    expect(r.ok && r.stats.streak).toBe(1);
    expect(r.ok && r.xp_awarded).toBe(9 * 10 + 20 + 5);
    expect(r.ok && r.new_badges).toEqual(["היום הראשון"]);
    expect(r.ok && r.password).toBe("pw1");
  });

  it("keeps the best score on a retry, never double-awards", async () => {
    const kid = (await kidByToken(token))!;
    const worse = await recordCompletion(kid, { edition_n: 1, score: 5, max: 11, complete: true, challenge: false, now: at("2026-09-01", 12) });
    expect(worse.ok && worse.improved).toBe(false);
    expect(worse.ok && worse.stats.xp).toBe(115);
    const better = await recordCompletion(kid, { edition_n: 1, score: 11, max: 11, complete: true, challenge: true, now: at("2026-09-01", 13) });
    expect(better.ok && better.improved).toBe(true);
    expect(better.ok && better.xp_awarded).toBe(110 + 20 + 5);
    expect(better.ok && better.stats.xp).toBe(135);
    expect(better.ok && better.new_badges).toEqual(["בלי טעויות", "האתגר"]);
    const first = await db.query<{ completed_at: Date }>("select completed_at from completions where edition_n = 1");
    expect(new Date(first.rows[0].completed_at).toISOString()).toBe(at("2026-09-01").toISOString());
  });

  it("partial (incomplete) results store the score but no streak", async () => {
    const kid = (await kidByToken(token))!;
    const r = await recordCompletion(kid, { edition_n: 2, score: 6, max: 11, complete: false, challenge: false, now: at("2026-09-02") });
    expect(r.ok && r.stats.streak).toBe(1);
    expect(r.ok && r.xp_awarded).toBe(60);
    const done = await recordCompletion(kid, { edition_n: 2, score: 8, max: 11, complete: true, challenge: false, now: at("2026-09-02", 18) });
    expect(done.ok && done.stats.streak).toBe(2);
    expect(done.ok && done.xp_awarded).toBe(80 + 20 + 10);
  });

  it("builds a streak day by day and awards the milestone badge", async () => {
    const kid = (await kidByToken(token))!;
    const r3 = await recordCompletion(kid, { edition_n: 3, score: 10, max: 11, complete: true, challenge: false, now: at("2026-09-03") });
    expect(r3.ok && r3.stats.streak).toBe(3);
    expect(r3.ok && r3.new_badges).toEqual(["רצף 3"]);
    expect(r3.ok && r3.stats.best).toBe(3);
  });

  it("a late completion gives XP but no streak; a missed day resets the live streak", async () => {
    const kid = (await kidByToken(token))!;
    // day 4 missed, day 5 done on time → streak 1; then day 4 finished late on the 6th
    const r5 = await recordCompletion(kid, { edition_n: 5, score: 11, max: 11, complete: true, challenge: false, now: at("2026-09-05") });
    expect(r5.ok && r5.stats.streak).toBe(1);
    expect(r5.ok && r5.stats.best).toBe(3);
    const late4 = await recordCompletion(kid, { edition_n: 4, score: 11, max: 11, complete: true, challenge: false, now: at("2026-09-06") });
    expect(late4.ok && late4.late).toBe(true);
    expect(late4.ok && late4.xp_awarded).toBe(130);
    expect(late4.ok && late4.new_badges).toEqual(["בלי טעויות"].filter((b) => !(r5.ok && r5.stats.badges.includes(b))));
    expect(late4.ok && late4.stats.streak).toBe(1);
    // on the 6th, before doing edition 6, the live streak is still 1 (yesterday done, today open)
    expect(await liveStreak(kid.id, "Asia/Jerusalem", at("2026-09-06"))).toBe(1);
    // on the 7th with edition 6 missed, the live streak is 0
    await seedEdition(db, 7, "2026-09-07");
    expect(await liveStreak(kid.id, "Asia/Jerusalem", at("2026-09-07"))).toBe(0);
  });

  it("rebuildStats reproduces the cached stats from the completions table", async () => {
    const kid = (await kidByToken(token))!;
    const cached = await db.query("select streak, best, xp, badges from kid_stats where kid_id = $1", [kid.id]);
    const rebuilt = await rebuildStats(kid.id, "Asia/Jerusalem", at("2026-09-06"));
    expect(rebuilt.xp).toBe((cached.rows[0] as { xp: number }).xp);
    expect(rebuilt.best).toBe(3);
    expect(new Set(rebuilt.badges)).toEqual(new Set((cached.rows[0] as { badges: string[] }).badges));
  });
});
