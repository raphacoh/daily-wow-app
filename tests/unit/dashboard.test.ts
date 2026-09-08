import { beforeAll, describe, expect, it } from "vitest";
import { freshDb, seedEdition, seedParent } from "./setup";
import { createKid, kidByToken, recordCompletion } from "@/lib/kids";
import { dashboardFor, deleteFamily, exportFamily, setKidLevel } from "@/lib/family";
import type { Db } from "@/lib/db";
import type { ParentRow } from "@/lib/kids";

const APP_URL = "https://wow.example.com";
const at = (d: string, h = 10) => new Date(`${d}T${String(h).padStart(2, "0")}:00:00+03:00`);

let db: Db;
let parentId: string;
let parent: ParentRow;
let emmaId: string;
let emmaToken: string;
let adamId: string;

describe("parent dashboard", () => {
  beforeAll(async () => {
    db = (await freshDb()).db;
    parentId = await seedParent(db, { name: "רף", email: "raph@example.com" });
    for (const [n, d] of [[1, "2026-09-01"], [2, "2026-09-02"], [3, "2026-09-03"]] as const) {
      await seedEdition(db, n, d, { password: `סוד${n}`, title: `גיליון ${n}` });
    }
    const emma = await createKid(parentId, { name: "אמה", feminine: true, age: 11, grade: "ו", level: "standard" });
    emmaId = emma.id;
    emmaToken = emma.token;
    adamId = (await createKid(parentId, { name: "אדם", feminine: false, age: 9, grade: "ד", level: "advanced" })).id;
    // Emma finished edition 2 on its own day, 9/11
    const kid = (await kidByToken(emmaToken))!;
    const r = await recordCompletion(kid, { edition_n: 2, score: 9, max: 11, complete: true, challenge: false, now: at("2026-09-02") });
    expect(r.ok).toBe(true);
    parent = (await db.query<ParentRow>("select * from parents where id = $1", [parentId])).rows[0];
  });

  it("returns both kids with personal links", async () => {
    const dash = await dashboardFor(parent, APP_URL, at("2026-09-03"));
    expect(dash.kids.map((k) => k.kid.name)).toEqual(["אמה", "אדם"]);
    for (const k of dash.kids) {
      expect(k.link).toContain("?k=");
      expect(k.link!.startsWith(`${APP_URL}/l/3?k=`)).toBe(true);
    }
    expect(dash.today?.n).toBe(3);
    expect(dash.todaySent).toBe(false);
  });

  it("gives 14-day squares with the right `done` per edition", async () => {
    const dash = await dashboardFor(parent, APP_URL, at("2026-09-03"));
    const emma = dash.kids.find((k) => k.kid.id === emmaId)!;
    const adam = dash.kids.find((k) => k.kid.id === adamId)!;
    expect(emma.days).toHaveLength(3);
    expect(emma.days.map((d) => d.date)).toEqual(["2026-09-01", "2026-09-02", "2026-09-03"]);
    expect(emma.days.map((d) => d.done)).toEqual([false, true, false]);
    expect(emma.days[1].score).toBe(9);
    expect(emma.days[1].late).toBe(false);
    expect(adam.days.every((d) => !d.done)).toBe(true);
    expect(emma.todayResult).toBeNull();
    expect(emma.liveStreak).toBe(1);
  });

  it("shows the password of a past edition in the history", async () => {
    const dash = await dashboardFor(parent, APP_URL, at("2026-09-03"));
    expect(dash.history.map((h) => h.edition.n)).toEqual([3, 2, 1]);
    const past = dash.history.find((h) => h.edition.n === 2)!;
    expect(past.password).toBe("סוד2");
    expect(past.results[emmaId]).toMatchObject({ score: 9, max: 11, complete: true, late: false });
    expect(past.results[adamId]).toBeNull();
  });

  it("setKidLevel changes the level and refuses another parent's kid", async () => {
    await setKidLevel(parentId, adamId, "support");
    const dash = await dashboardFor(parent, APP_URL, at("2026-09-03"));
    expect(dash.kids.find((k) => k.kid.id === adamId)!.kid.level).toBe("support");
    const stranger = await seedParent(db, { email: "other@example.com" });
    await expect(setKidLevel(stranger, adamId, "advanced")).rejects.toThrow("not_your_kid");
    const still = await db.query<{ level: string }>("select level from kids where id = $1", [adamId]);
    expect(still.rows[0].level).toBe("support");
  });

  it("exportFamily contains the kids and the completions", async () => {
    const out = await exportFamily(parentId);
    expect((out.parent as { email: string }).email).toBe("raph@example.com");
    expect((out.kids as { name: string }[]).map((k) => k.name).sort()).toEqual(["אדם", "אמה"]);
    const comps = out.completions as { kid_id: string; edition_n: number; score: number }[];
    expect(comps).toHaveLength(1);
    expect(comps[0]).toMatchObject({ kid_id: emmaId, edition_n: 2, score: 9 });
    expect(out.exported_at).toBeTruthy();
  });

  it("deleteFamily removes everything for that parent", async () => {
    await deleteFamily(parentId);
    const kids = await db.query("select id from kids where parent_id = $1", [parentId]);
    expect(kids.rows).toHaveLength(0);
    const comps = await db.query("select id from completions where kid_id = any($1::uuid[])", [[emmaId, adamId]]);
    expect(comps.rows).toHaveLength(0);
    const parents = await db.query("select id from parents where id = $1", [parentId]);
    expect(parents.rows).toHaveLength(0);
  });
});
