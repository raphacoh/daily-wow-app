import { describe, expect, it, beforeAll } from "vitest";
import { readFileSync } from "node:fs";
import { extractEngineVersion, extractWowMeta, readWowMetaSource } from "@/lib/wow-meta";
import { deriveProgress, type Facts } from "@/lib/gamification";
import { gamificationOf, stageEdition } from "@/lib/admin";
import { freshDb } from "./setup";

const good = `<title>x</title><script>const ENGINE_VERSION = '2';
const WOW_META = {
  v: 1,
  roots: [ { id:'math', w:2 }, { id:'space', w:1 }, { id:'magic', w:1 } ],
  hero: { name:'ארטוסתנס', fact:'מדד את כדור הארץ עם מקל ו"צל"' },
  items: { 'num:older': { skill:'proportion', d:3 }, 'bogus': { skill:'x', d:1 }, 'explain': { skill:'Explaining Mechanism', d:9 } }
};
const LESSON_CONTEXT = 'y';</script>`;

describe("WOW_META extraction", () => {
  it("reads the balanced literal, validates each field, warns on the rest", () => {
    expect(readWowMetaSource(good)).toMatch(/^\{[\s\S]*\}$/);
    const { meta, warnings } = extractWowMeta(good);
    expect(meta).toMatchObject({ v: 1, roots: [{ id: "math", w: 2 }, { id: "space", w: 1 }], hero: { name: "ארטוסתנס" } });
    expect(meta?.items["num:older"]).toEqual({ skill: "proportion", d: 3 });
    expect(meta?.items["explain"]).toEqual({ skill: null, d: 0 });
    expect(meta?.items["bogus"]).toBeUndefined();
    expect(warnings.join("\n")).toMatch(/magic/);
    expect(warnings.join("\n")).toMatch(/bogus/);
    expect(warnings.join("\n")).toMatch(/Explaining Mechanism/);
    expect(extractEngineVersion(good)).toBe("2");
  });
  it("missing or hostile literals produce a warning, never a throw", () => {
    expect(extractWowMeta("<title>x</title>")).toEqual({ meta: null, warnings: [expect.stringMatching(/WOW_META חסר/)] });
    const evil = "const WOW_META = { get v(){ while(true){} } };";
    const r = extractWowMeta(evil);
    expect(r.meta).toBeNull();
    expect(r.warnings[0]).toMatch(/לא תקין/);
    const escape = "const WOW_META = { v: (function(){ return process.env.HOME; })() };";
    const e = extractWowMeta(escape);
    expect(e.meta).toBeNull(); // `process` does not exist in the empty context → error → warning
    expect(gamificationOf("<title>x</title>").warnings.join()).toMatch(/ENGINE_VERSION/);
  });
  it("the kit template and edition 1 carry a clean WOW_META", () => {
    for (const f of ["kit/template/edition-template.html", "editions/e/001/edition.html"]) {
      const { meta, warnings } = extractWowMeta(readFileSync(f, "utf8"));
      expect(warnings, f).toEqual([]);
      expect(meta?.roots.map((r) => r.id)).toEqual(["math", "earth", "history", "space"]);
      expect(Object.keys(meta?.items ?? {}).length).toBe(13);
    }
  });
});

describe("skills (Tier 2)", () => {
  it("masters a skill after 3 first-try successes across 2 editions", () => {
    const meta = { roots: [{ id: "math", w: 1 }], items: { "num:older": { skill: "proportion", d: 3 }, "mcq:shared:1": { skill: "proportion", d: 2 } } };
    const ed = (n: number) => ({ n, date: `2026-09-0${n}`, released_at: null, title: `t${n}`, teaser: null, topics: [], wow_meta: meta });
    const done = (n: number) => ({ edition_n: n, score: 9, max: 11, complete: true, late: false, challenge: false, xp_awarded: 100, completed_at: `2026-09-0${n}T10:00:00Z`, updated_at: `2026-09-0${n}T10:00:00Z` });
    const it_ = (n: number, id: string, kind: string, correct: boolean, attempt = 1) => ({ edition_n: n, item_id: id, kind, attempt, correct, partial: null, stars: null, graded: null, value: null, target: null });
    const f: Facts = { today: "2026-09-09", feminine: false, level: "standard", timezone: "Asia/Jerusalem", editions: [ed(1), ed(2)], completions: [done(1), done(2)], grades: {}, questions: {}, itemStats: {},
      items: [it_(1, "num:older", "num", true), it_(1, "mcq:shared:1", "mcq", true), it_(2, "num:older", "num", false), it_(2, "num:older", "num", true, 2), it_(2, "mcq:shared:1", "mcq", true)] };
    const p = deriveProgress(f);
    expect(p.skills.proportion).toEqual({ name: "proportion", touched: 4, first_try: 3, editions: 2, mastered: true });
    const single = deriveProgress({ ...f, completions: [done(1)], items: f.items.filter((i) => i.edition_n === 1) });
    expect(single.skills.proportion.mastered).toBe(false);
    // the editor's registry: a Hebrew name, a merge, and a topic alias
    const reg = deriveProgress({ ...f, editions: [{ ...ed(1), topics: ["פילוסופיה"] }, ed(2)], aliases: { "פילוסופיה": "history" }, skillRegistry: { proportion: { name_he: "יחס ופרופורציה", canonical_slug: "ratios" }, ratios: { name_he: "יחסים", canonical_slug: null } } });
    expect(reg.skills.proportion).toBeUndefined();
    expect(reg.skills.ratios).toMatchObject({ name: "יחסים", mastered: true });
    expect(reg.roots.history.xp).toBe(0); // edition 1 declares math in WOW_META, which wins over topics
    const noMeta = deriveProgress({ ...f, editions: [{ ...ed(1), topics: ["פילוסופיה"], wow_meta: null }, ed(2)], aliases: { "פילוסופיה": "history" } });
    expect(noMeta.roots.history.xp).toBe(100);
  });
});

describe("registries", () => {
  beforeAll(async () => {
    await freshDb();
  });
  it("aliases and skills round-trip through the readout", async () => {
    const { gamificationReadout, setRootAlias, saveSkill } = await import("@/lib/admin");
    const { db } = await import("@/lib/db");
    await db().query("insert into editions (n, code, date, title, password, status, html, topics) values (1,'WOW-001','2026-09-01','t','pw','released','',$1::text[])", [["מתמטיקה", "פילוסופיה"]]);
    let r = await gamificationReadout();
    expect(r.unmapped_topics).toEqual([{ topic: "פילוסופיה", editions: [1] }]);
    expect(r.editions[0].warnings.join()).toMatch(/WOW_META/);
    await setRootAlias("פילוסופיה", "history");
    await saveSkill("proportion", "יחס", "");
    await expect(saveSkill("Bad Slug", "", "")).rejects.toThrow();
    await expect(setRootAlias("x", "magic")).rejects.toThrow();
    r = await gamificationReadout();
    expect(r.unmapped_topics).toEqual([]);
    expect(r.aliases).toEqual([{ topic: "פילוסופיה", root: "history" }]);
    expect(r.skills.find((s) => s.slug === "proportion")?.name_he).toBe("יחס");
  });
});

describe("staging stores WOW_META and reports warnings", () => {
  beforeAll(async () => {
    await freshDb();
  });
  it("accepts a fragment without WOW_META and says so", async () => {
    const frag = `<title>x</title><script>window.RUNTIME;</script><div data-track="younger"></div><div data-track="older"></div><div data-level="advanced"></div><script>function checkChallenge(){}</script>`;
    const r = await stageEdition({ n: 5, date: "2026-09-05", html: frag, topics: ["מתמטיקה"] });
    expect(r.warnings.join()).toMatch(/WOW_META חסר/);
    expect(r.warnings.join()).toMatch(/ENGINE_VERSION/);
    const r2 = await stageEdition({ n: 6, date: "2026-09-06", html: frag + good.replace("<title>x</title>", ""), topics: [] });
    expect(r2.warnings.join()).not.toMatch(/WOW_META חסר/);
    const { db } = await import("@/lib/db");
    const row = await db().query<{ wow_meta: { hero: { name: string } }; engine_version: string }>("select wow_meta, engine_version from editions where n = 6");
    expect(row.rows[0].wow_meta.hero.name).toBe("ארטוסתנס");
    expect(row.rows[0].engine_version).toBe("2");
  });
});
