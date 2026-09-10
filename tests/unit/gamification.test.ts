import { beforeAll, describe, expect, it } from "vitest";
import { PROGRESS_V, deriveProgress, medalFor, progressFor, rebuildProgress, type Facts } from "@/lib/gamification";
import { computeStreakDetail } from "@/lib/progress";
import { rootForTopic, rootWeightsFor, splitXp } from "@/lib/roots";
import { freshDb, seedEdition, seedParent } from "./setup";
import { createKid, kidByToken, recordCompletion } from "@/lib/kids";
import type { Db } from "@/lib/db";

const day = (i: number) => `2026-09-${String(i).padStart(2, "0")}`;
const ed = (n: number, topics: string[] = ["מתמטיקה", "גאוגרפיה"], extra: Partial<Facts["editions"][number]> = {}) => ({ n, date: day(n), released_at: `${day(n)}T08:00:00Z`, title: `גיליון ${n}`, teaser: "שאלה גדולה. ועוד משפט.", topics, wow_meta: null, ...extra });
const done = (n: number, o: Partial<Facts["completions"][number]> = {}) => ({ edition_n: n, score: 9, max: 11, complete: true, late: false, challenge: false, xp_awarded: 115, completed_at: `${day(n)}T10:00:00Z`, updated_at: `${day(n)}T10:00:00Z`, ...o });
const facts = (o: Partial<Facts>): Facts => ({ today: day(10), feminine: false, level: "standard", timezone: "Asia/Jerusalem", editions: [], completions: [], grades: {}, questions: {}, items: [], itemStats: {}, ...o });

describe("roots", () => {
  it("maps topic words to roots, tolerantly", () => {
    expect(rootForTopic("מתמטיקה")).toBe("math");
    expect(rootForTopic("אסטרונומיה")).toBe("space");
    expect(rootForTopic("טבע")).toBe("biology");
    expect(rootForTopic("תקשורת")).toBe("engineering");
    expect(rootForTopic("פילוסופיה")).toBeNull();
  });
  it("prefers WOW_META weights, falls back to topics", () => {
    expect(rootWeightsFor(["מתמטיקה", "היסטוריה"], { roots: [{ id: "math", w: 2 }, { id: "space", w: 1 }, { id: "nope", w: 9 }] })).toEqual({ math: 2, space: 1 });
    expect(rootWeightsFor(["מתמטיקה", "היסטוריה", "פילוסופיה"], null)).toEqual({ math: 1, history: 1 });
    expect(rootWeightsFor(["x"], { roots: [{ id: "bad" }] })).toEqual({});
  });
  it("splits XP exactly", () => {
    const s = splitXp(115, { math: 2, earth: 2, history: 1, space: 1 });
    expect(Object.values(s).reduce((a, b) => a + (b ?? 0), 0)).toBe(115);
    expect(Math.abs((s.math ?? 0) - (s.earth ?? 0))).toBeLessThanOrEqual(1);
    expect(splitXp(120, { math: 2, earth: 2, history: 1, space: 1 })).toEqual({ math: 40, earth: 40, history: 20, space: 20 });
    expect(splitXp(100, {})).toEqual({});
  });
});

describe("streak shields", () => {
  const rel = Array.from({ length: 20 }, (_, i) => day(i + 1));
  it("earns a shield at 7 and spends it on a missed day", () => {
    const on = [1, 2, 3, 4, 5, 6, 7, 9].map(day); // day 8 missed
    expect(computeStreakDetail(rel.slice(0, 9), on, day(9))).toEqual({ streak: 8, shields: 0, shieldsUsed: 1 });
  });
  it("breaks without a shield, holds at most two", () => {
    expect(computeStreakDetail(rel.slice(0, 5), [1, 2, 3, 5].map(day), day(5)).streak).toBe(1);
    const on = Array.from({ length: 20 }, (_, i) => day(i + 1)).filter((d) => d !== day(20));
    const d = computeStreakDetail(rel, on, day(20));
    expect(d.shields).toBe(2); // 7 and 14 earned, 19 days on time, day 20 open
    expect(d.streak).toBe(19);
  });
});

describe("medals", () => {
  it("bronze → silver → gold → diamond", () => {
    expect(medalFor({ score: 5, max: 11, complete: true, challenge: false }, undefined)).toBe("bronze");
    expect(medalFor({ score: 8, max: 11, complete: true, challenge: false }, undefined)).toBe("silver");
    expect(medalFor({ score: 10, max: 11, complete: true, challenge: false }, 2)).toBe("silver");
    expect(medalFor({ score: 10, max: 11, complete: true, challenge: false }, 3)).toBe("gold");
    expect(medalFor({ score: 11, max: 11, complete: true, challenge: false }, undefined)).toBe("gold");
    expect(medalFor({ score: 11, max: 11, complete: true, challenge: true }, undefined)).toBe("diamond");
    expect(medalFor({ score: 11, max: 11, complete: false, challenge: true }, 3)).toBeNull();
  });
});

describe("deriveProgress", () => {
  it("grows roots, collects cards, lists missing editions", () => {
    const p = deriveProgress(facts({ editions: [ed(1), ed(2, ["ביולוגיה"]), ed(3)], completions: [done(1), done(2, { score: 11, challenge: true })] }));
    expect(p.roots.math.xp + p.roots.earth.xp).toBe(115);
    expect(p.roots.biology.xp).toBe(115);
    expect(p.roots.biology.stage_name).toBe("נבט");
    expect(p.cards.map((c) => c.n)).toEqual([2, 1]);
    expect(p.cards[0].medal).toBe("diamond");
    expect(p.cards[0].fact).toBe("שאלה גדולה.");
    expect(p.missing.map((m) => m.n)).toEqual([3]);
    expect(p.badges.map((b) => b.id)).toEqual(expect.arrayContaining(["first_day", "no_mistakes", "challenge", "beyond_level", "first_diamond"]));
    expect(p.badges.find((b) => b.id === "first_day")?.edition_n).toBe(1);
    expect(p.counts).toMatchObject({ bronze: 0, silver: 1, gold: 0, diamond: 1, challenges: 1 });
  });
  it("uses the hero card and root weights from WOW_META", () => {
    const meta = { roots: [{ id: "space", w: 3 }, { id: "math", w: 1 }], hero: { name: "ארטוסתנס", fact: "מדד את כדור הארץ עם מקל" } };
    const p = deriveProgress(facts({ editions: [ed(1, ["x"], { wow_meta: meta })], completions: [done(1, { xp_awarded: 100 })] }));
    expect(p.roots.space.xp).toBe(75);
    expect(p.roots.math.xp).toBe(25);
    expect(p.cards[0]).toMatchObject({ hero: "ארטוסתנס", fact: "מדד את כדור הארץ עם מקל", roots: ["space", "math"] });
  });
  it("streak, full week, comeback, teacher, library, asker — and feminine names", () => {
    const editions = Array.from({ length: 20 }, (_, i) => ed(i + 1));
    const completions = [1, 2, 3, 4, 5, 6, 7].map((n) => done(n, n === 3 ? { score: 10 } : {})); // Sep 1–7 2026 = Tue…Mon; week of Sun Aug 30 has Sep 1–5
    completions.push(done(13)); // days 8–12 missed → comeback
    completions.push(done(9, { late: true, completed_at: `${day(18)}T10:00:00Z` })); // ≥ 7 days after → from_library
    const p = deriveProgress(facts({ today: day(20), feminine: true, editions, completions, grades: { 3: 3 }, questions: { 4: 3 } }));
    const ids = p.badges.map((b) => b.id);
    expect(ids).toEqual(expect.arrayContaining(["streak_3", "streak_7", "full_week", "comeback", "teacher", "from_library", "asker"]));
    expect(ids).not.toContain("streak_14");
    expect(p.badges.find((b) => b.id === "teacher")?.name).toBe("המורָה");
    expect(p.badges.find((b) => b.id === "asker")?.name).toBe("שואלת שאלות");
    expect(p.medals[3]).toBe("gold");
    expect(p.shields).toBe(0); // the shield from day 7 was spent on day 8
    expect(p.shields_used).toBe(1);
  });
  it("keeps every grade, medal or not, and hangs the score on the card", () => {
    const p = deriveProgress(
      facts({
        editions: [ed(1), ed(2), ed(3), ed(4)],
        // 1: gold; 2: left half-done, so no medal and no card; 3: silver, graded three stars
        completions: [done(1, { score: 11, max: 11 }), done(2, { score: 4, max: 11, complete: false }), done(3, { score: 8, max: 11 })],
        grades: { 3: 3 },
      }),
    );
    expect(p.results.map((r) => r.n)).toEqual([3, 2, 1]);
    expect(p.results.find((r) => r.n === 2)).toMatchObject({ score: 4, max: 11, pct: 36, complete: false, medal: null });
    expect(p.results.find((r) => r.n === 3)).toMatchObject({ score: 8, max: 11, pct: 73, medal: "silver", stars: 3 });
    // the album still holds only the medals, but each card now carries the grade behind it
    expect(p.cards.map((c) => c.n)).toEqual([3, 1]);
    expect(p.cards[0]).toMatchObject({ score: 8, max: 11, pct: 73 });
    expect(p.cards[1]).toMatchObject({ score: 11, max: 11, pct: 100 });
    // an edition that was never opened has no grade at all
    expect(p.results.some((r) => r.n === 4)).toBe(false);
  });
  it("is deterministic regardless of input order", () => {
    const a = facts({ editions: [ed(1), ed(2), ed(3)], completions: [done(3), done(1), done(2)] });
    const b = facts({ editions: [ed(3), ed(1), ed(2)], completions: [done(1), done(2), done(3)] });
    expect(JSON.stringify(deriveProgress(a))).toBe(JSON.stringify(deriveProgress(b)));
  });
});

describe("rebuildProgress on the database", () => {
  let db: Db;
  let token: string;
  beforeAll(async () => {
    db = (await freshDb()).db;
    const parent = await seedParent(db);
    for (let i = 1; i <= 3; i++) await seedEdition(db, i, day(i));
    await db.query("update editions set topics = $1::text[] where n = 1", [["מתמטיקה", "חלל"]]);
    token = (await createKid(parent, { name: "אמה", feminine: true, age: 11, grade: "ו", level: "standard" })).token;
  });
  it("the completion response carries the replayed progress, and a rebuild reproduces it", async () => {
    const kid = (await kidByToken(token))!;
    const r = await recordCompletion(kid, { edition_n: 1, score: 11, max: 11, complete: true, challenge: false, now: new Date(`${day(1)}T10:00:00+03:00`) });
    expect(r.ok && r.progress?.medals[1]).toBe("gold");
    expect(r.ok && r.progress?.roots.math.xp).toBe(68);
    expect(r.ok && r.progress?.roots.space.xp).toBe(67);
    expect(r.ok && r.progress?.cards[0].title).toBe("גיליון 1");
    const again = await rebuildProgress(kid, "Asia/Jerusalem", new Date(`${day(1)}T12:00:00+03:00`));
    expect(JSON.stringify(again)).toBe(JSON.stringify(r.ok ? r.progress : null));
    const row = await db.query<{ data: unknown }>("select data from kid_progress where kid_id = $1", [kid.id]);
    expect(row.rows.length).toBe(1);
  });
  it("rebuilds a document written by an older rules version instead of returning it", async () => {
    const kid = (await kidByToken(token))!;
    // an old document: the shape a previous deploy wrote, with no grades in it at all
    await db.query("update kid_progress set data = $2::jsonb where kid_id = $1", [kid.id, JSON.stringify({ v: 1, cards: [], results: undefined })]);
    const p = await progressFor(kid.id);
    expect(p?.v).toBe(PROGRESS_V);
    expect(p?.results.map((r) => r.n)).toEqual([1]);
    expect(p?.results[0]).toMatchObject({ score: 11, max: 11, medal: "gold" });
    const stored = await db.query<{ data: { v: number } }>("select data from kid_progress where kid_id = $1", [kid.id]);
    expect(stored.rows[0].data.v).toBe(PROGRESS_V);
  });
});

/* ---------- P1: items → wings, rarity, journeys ---------- */
import { closeDay, deriveJourney, itemOutcomes, recordItemEvents, type FactItem } from "@/lib/gamification";

const item = (n: number, id: string, kind: string, o: Partial<FactItem> = {}): FactItem => ({ edition_n: n, item_id: id, kind, attempt: 1, correct: null, partial: null, stars: null, graded: null, value: null, target: null, ...o });

describe("wings", () => {
  it("folds attempts into feathers per the table", () => {
    const out = itemOutcomes([
      item(1, "mcq:shared:0", "mcq", { correct: true }),
      item(1, "num:older", "num", { correct: false }),
      item(1, "num:older", "num", { correct: true, attempt: 2 }),
      item(1, "order", "order", { correct: false, partial: 1 }),
      item(1, "challenge", "challenge", { correct: true }),
      item(1, "explain", "explain", { stars: 2, graded: "rubric" }),
      item(1, "explain", "explain", { stars: 3, graded: "ai", attempt: 2 }),
      item(1, "predict", "predict", { value: 38000, target: 40075 }),
      item(1, "open:bonus", "open"),
    ]);
    const by = Object.fromEntries(out.map((o) => [o.item_id, o]));
    expect(by["mcq:shared:0"]).toMatchObject({ wing: "understand", feathers: 3, firstTryCorrect: true });
    expect(by["num:older"]).toMatchObject({ wing: "calculate", feathers: 2, firstTryCorrect: false, everCorrect: true, attempts: 2 });
    expect(by["order"]).toMatchObject({ wing: "sequence", feathers: 1 });
    expect(by["challenge"]).toMatchObject({ wing: "reason", feathers: 5 });
    expect(by["explain"]).toMatchObject({ wing: "explain", feathers: 3 });
    expect(by["predict"]).toMatchObject({ wing: "predict", feathers: 3 });
    expect(by["open:bonus"]).toMatchObject({ wing: "curious", feathers: 1 });
  });
  it("levels wings and awards grit, curiosity and rarity badges from items", () => {
    const items: FactItem[] = [];
    for (let i = 0; i < 4; i++) { items.push(item(1, `mcq:shared:${i}`, "mcq", { correct: false })); items.push(item(1, `mcq:shared:${i}`, "mcq", { correct: true, attempt: 2 })); }
    items.push(item(1, "num:older", "num", { correct: true }));
    items.push(item(1, "open:bonus", "open"), item(1, "open:sources", "open"));
    const p = deriveProgress(facts({ editions: [ed(1)], completions: [done(1)], items, itemStats: { "1:num:older": { n: 10, correct: 3 }, "1:mcq:shared:0": { n: 10, correct: 1 } } }));
    expect(p.wings.understand.feathers).toBe(8);
    expect(p.wings.calculate).toMatchObject({ feathers: 3, level: 1, next: 10 });
    expect(p.feathers_by_edition[1]).toEqual({ understand: 8, calculate: 3, curious: 2 });
    const ids = p.badges.map((b) => b.id);
    expect(ids).toEqual(expect.arrayContaining(["second_try", "after_bell", "no_hints", "rare_success"]));
    expect(ids).not.toContain("no_quit"); // 4 retries < 5
    expect(ids.filter((x) => x === "rare_success").length).toBe(1); // idempotent even though one of the rare items was a retry
  });
  it("awards the hardest question of a closed week, not of the open one", () => {
    const editions = [ed(1), ed(2), ed(3), ed(8)]; // Sep 1–3 (week of Aug 30, closed by Sep 10); Sep 8 (week of Sep 6, open)
    const items = [item(1, "num:older", "num", { correct: true }), item(2, "order", "order", { correct: true }), item(8, "challenge", "challenge", { correct: true })];
    const itemStats = { "1:num:older": { n: 12, correct: 4 }, "2:order": { n: 12, correct: 2 }, "8:challenge": { n: 12, correct: 1 } };
    const p = deriveProgress(facts({ today: day(10), editions, completions: [done(1), done(2), done(8)], items, itemStats }));
    const hard = p.badges.filter((b) => b.id === "hard_of_week");
    expect(hard.map((b) => b.edition_n)).toEqual([2]);
    // still open on the 12th (Saturday): nothing for week 2 yet; closed on the 13th
    expect(deriveProgress(facts({ today: day(12), editions, completions: [done(1), done(2), done(8)], items, itemStats })).badges.filter((b) => b.id === "hard_of_week").length).toBe(1);
    expect(deriveProgress(facts({ today: day(13), editions, completions: [done(1), done(2), done(8)], items, itemStats })).badges.filter((b) => b.id === "hard_of_week").length).toBe(1); // one badge id, earned once
  });
  it("rarity needs n ≥ 8", () => {
    const p = deriveProgress(facts({ editions: [ed(1)], completions: [done(1)], items: [item(1, "num:older", "num", { correct: true })], itemStats: { "1:num:older": { n: 5, correct: 1 } } }));
    expect(p.badges.map((b) => b.id)).not.toContain("rare_success");
  });
});

describe("journeys", () => {
  it("adapts the rhythm target and targets the weakest wing", () => {
    const editions = Array.from({ length: 20 }, (_, i) => ed(i + 1));
    // week of Sun 2026-09-13 … Sat 19; prior fortnight: 2 completions → target 3
    const completions = [done(3), done(5), done(14), done(15)];
    const f = facts({ today: day(16), editions, completions, items: [item(14, "num:older", "num", { correct: true }), item(15, "num:older", "num", { correct: true })] });
    const p = deriveProgress(f);
    expect(p.journey.week_start).toBe("2026-09-13");
    expect(p.journey.goals[0]).toMatchObject({ id: "rhythm", target: 3, progress: 2, done: false });
    expect(p.journey.goals[1].id).toBe("wing_predict"); // every wing but calculate is at 0; predict sorts first
    expect(p.journey.goals[2]).toMatchObject({ id: "roots", progress: 2 });
    expect(p.journey.complete).toBe(false);
    const j = deriveJourney({ ...f, feminine: true }, p.wings, editions, completions, itemOutcomes(f.items));
    expect(j.goals[1].text).toBe("לנחש קרוב למציאות פעמיים");
  });
});

describe("item events on the database", () => {
  let db: Db;
  let tokens: string[] = [];
  beforeAll(async () => {
    db = (await freshDb()).db;
    const parent = await seedParent(db);
    await seedEdition(db, 1, day(1));
    await seedEdition(db, 9, day(9), { status: "staged" });
    tokens = [];
    for (let i = 0; i < 9; i++) tokens.push((await createKid(parent, { name: `ילד${i}`, feminine: false, age: 10, grade: "ה", level: "standard" })).token);
  });
  it("stores events once, ignores junk, rejects unreleased editions, caps the batch", async () => {
    const kid = (await kidByToken(tokens[0]))!;
    const r = await recordItemEvents(kid, 1, [
      { id: "mcq:shared:0", kind: "mcq", correct: true },
      { id: "mcq:shared:0", kind: "mcq", correct: false }, // duplicate (kid, edition, item, attempt 1) → ignored
      { id: "num:older", kind: "num", correct: false, attempt: 1 },
      { id: "num:older", kind: "num", correct: true, attempt: 2 },
      { id: "<script>", kind: "mcq", correct: true },
      { id: "order", kind: "nope" },
      { id: "predict", kind: "predict", value: 39000, target: 40075 },
    ], "Asia/Jerusalem");
    expect(r.accepted).toBe(4);
    expect((await recordItemEvents(kid, 9, [{ id: "order", kind: "order", correct: true }], "Asia/Jerusalem")).error).toBe("edition_not_released");
    const p = (await db.query<{ data: { wings: { calculate: { feathers: number } } } }>("select data from kid_progress where kid_id = $1", [kid.id])).rows[0].data;
    expect(p.wings.calculate.feathers).toBe(0); // no completion yet → no feathers counted
    await recordCompletion(kid, { edition_n: 1, score: 9, max: 11, complete: true, challenge: false, now: new Date(`${day(1)}T10:00:00+03:00`) });
    const p2 = (await db.query<{ data: { wings: { calculate: { feathers: number }; understand: { feathers: number }; predict: { feathers: number } } } }>("select data from kid_progress where kid_id = $1", [kid.id])).rows[0].data;
    expect(p2.wings.calculate.feathers).toBe(2);
    expect(p2.wings.understand.feathers).toBe(3);
    expect(p2.wings.predict.feathers).toBe(3);
  });
  it("the close job computes community stats and notifies the rare successes", async () => {
    // 8 more kids answer num:older on the first try: only kid 1 gets it right → rate 1/9 ≤ 35 %, n = 9
    for (let i = 1; i < 9; i++) {
      const k = (await kidByToken(tokens[i]))!;
      await recordItemEvents(k, 1, [{ id: "num:older", kind: "num", correct: i === 1, attempt: 1 }], "Asia/Jerusalem");
      await recordCompletion(k, { edition_n: 1, score: 6, max: 11, complete: true, challenge: false, now: new Date(`${day(1)}T11:00:00+03:00`) });
    }
    const r = await closeDay(new Date(`${day(1)}T23:30:00+03:00`));
    expect(r.editions).toEqual([1]);
    expect(r.kids).toBe(9);
    expect(r.notices).toBe(1);
    const st = await db.query<{ n: number; first_try_correct: number }>("select n, first_try_correct from item_stats where edition_n = 1 and item_id = 'num:older'");
    expect(st.rows[0]).toMatchObject({ n: 9, first_try_correct: 1 });
    const k1 = (await kidByToken(tokens[1]))!;
    const notes = await db.query<{ payload: { name: string; n: number } }>("select payload from kid_notices where kid_id = $1 and shown_at is null", [k1.id]);
    expect(notes.rows[0].payload).toMatchObject({ name: "מעטים הצליחו", n: 9 });
    // kid 0 got num:older right only on the second try → no rarity badge
    const p0 = (await db.query<{ data: { badges: { id: string }[] } }>("select data from kid_progress where kid_id = $1", [(await kidByToken(tokens[0]))!.id])).rows[0].data;
    expect(p0.badges.map((b) => b.id)).not.toContain("rare_success");
    expect((await closeDay(new Date(`${day(1)}T23:40:00+03:00`))).notices).toBe(0); // idempotent
  });
});
