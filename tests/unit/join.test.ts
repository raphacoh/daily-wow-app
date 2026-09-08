/**
 * Registration (PRD §5.2): the form-data parser, the validator, and `registerFamily` against a real
 * Postgres (PGlite) running the real migration.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { freshDb } from "./setup";
import { parseJoinForm } from "@/app/join/parse";
import { gradeForAge, registerFamily, validateRegistration, type KidInput, type RegistrationInput } from "@/lib/family";
import type { Db } from "@/lib/db";

const kid = (o: Partial<KidInput> = {}): KidInput => ({
  name: "אמה",
  feminine: true,
  age: 10,
  grade: "ה",
  level: "standard",
  email: null,
  extra: null,
  ...o,
});

const reg = (o: Partial<RegistrationInput> = {}): RegistrationInput => ({
  parentName: "רף",
  email: "parent@example.com",
  consent: true,
  kids: [kid()],
  ...o,
});

const fields = (errs: { field: string }[]) => errs.map((e) => e.field);

describe("validateRegistration", () => {
  it("accepts a complete registration", () => {
    expect(validateRegistration(reg())).toEqual([]);
  });

  it("rejects a malformed email", () => {
    expect(fields(validateRegistration(reg({ email: "not-an-email" })))).toContain("email");
    expect(fields(validateRegistration(reg({ email: "a@b" })))).toContain("email");
  });

  it("rejects a missing consent checkbox", () => {
    const errs = validateRegistration(reg({ consent: false }));
    expect(fields(errs)).toContain("consent");
    expect(errs.find((e) => e.field === "consent")!.message).toMatch(/פרטיות/);
  });

  it("rejects an age outside 7–13", () => {
    expect(fields(validateRegistration(reg({ kids: [kid({ age: 14 })] })))).toContain("kids.0.age");
    expect(fields(validateRegistration(reg({ kids: [kid({ age: 6 })] })))).toContain("kids.0.age");
    expect(fields(validateRegistration(reg({ kids: [kid({ age: NaN })] })))).toContain("kids.0.age");
  });

  it("rejects a registration with no kids, and one with too many", () => {
    expect(fields(validateRegistration(reg({ kids: [] })))).toContain("kids");
    expect(fields(validateRegistration(reg({ kids: Array.from({ length: 7 }, () => kid()) })))).toContain("kids");
  });

  it("reports the kid that is wrong, by index", () => {
    const errs = validateRegistration(reg({ kids: [kid(), kid({ name: "  ", email: "nope" })] }));
    expect(fields(errs).sort()).toEqual(["kids.1.email", "kids.1.name"]);
  });
});

describe("parseJoinForm", () => {
  it("reads a two-kid form, trims, lower-cases the emails and folds the extra adult", () => {
    const fd = new FormData();
    fd.set("parentName", "  רף  ");
    fd.set("email", "  Parent@Example.COM ");
    fd.set("consent", "1");

    fd.set("kid_0_name", " אמה ");
    fd.set("kid_0_feminine", "1");
    fd.set("kid_0_age", "10");
    fd.set("kid_0_grade", "ה");
    fd.set("kid_0_level", "advanced");
    fd.set("kid_0_email", "Emma@Example.com");
    fd.set("kid_0_extraName", "דנה");
    fd.set("kid_0_extraEmail", "Dana@Example.com");

    fd.set("kid_1_name", "אדם");
    fd.set("kid_1_feminine", "0");
    fd.set("kid_1_age", "8");
    fd.set("kid_1_grade", "ג");
    fd.set("kid_1_level", "standard");
    fd.set("kid_1_email", "");
    fd.set("kid_1_extraName", "");
    fd.set("kid_1_extraEmail", "");

    expect(parseJoinForm(fd)).toEqual({
      parentName: "רף",
      email: "parent@example.com",
      consent: true,
      kids: [
        { name: "אמה", feminine: true, age: 10, grade: "ה", level: "advanced", email: "emma@example.com", extra: { name: "דנה", email: "dana@example.com" } },
        { name: "אדם", feminine: false, age: 8, grade: "ג", level: "standard", email: null, extra: null },
      ],
    });
    expect(validateRegistration(parseJoinForm(fd))).toEqual([]);
  });

  it("leaves blanks blank so the validator produces the messages", () => {
    const fd = new FormData();
    fd.set("kid_0_name", "");
    fd.set("kid_0_age", "");
    const parsed = parseJoinForm(fd);
    expect(parsed).toMatchObject({ parentName: "", email: "", consent: false });
    expect(parsed.kids).toHaveLength(1);
    expect(parsed.kids[0].feminine).toBeUndefined();
    expect(Number.isNaN(parsed.kids[0].age)).toBe(true);
    expect(fields(validateRegistration(parsed)).sort()).toEqual(
      ["consent", "email", "kids.0.age", "kids.0.feminine", "kids.0.grade", "kids.0.level", "kids.0.name", "parentName"],
    );
  });

  it("survives non-contiguous kid indices", () => {
    const fd = new FormData();
    fd.set("kid_0_name", "א");
    fd.set("kid_2_name", "ב");
    expect(parseJoinForm(fd).kids.map((k) => k.name)).toEqual(["א", "ב"]);
  });
});

describe("gradeForAge", () => {
  it("maps 7→ב … 13→ח and clamps outside", () => {
    expect([7, 8, 9, 10, 11, 12, 13].map(gradeForAge)).toEqual(["ב", "ג", "ד", "ה", "ו", "ז", "ח"]);
    expect(gradeForAge(5)).toBe("ב");
    expect(gradeForAge(20)).toBe("ח");
  });
});

describe("registerFamily", () => {
  let db: Db;
  beforeEach(async () => {
    ({ db } = await freshDb());
  });

  it("creates the parent, the kids, their stats rows and the extra-adult contact", async () => {
    const res = await registerFamily(
      reg({
        email: "Parent@Example.com",
        kids: [
          kid({ name: "אמה", email: "emma@example.com", extra: { name: "דנה", email: "dana@example.com" } }),
          kid({ name: "אדם", feminine: false, age: 8, grade: "ג", level: "advanced" }),
        ],
      }),
    );

    expect(res.existed).toBe(false);
    expect(res.kids).toHaveLength(2);
    expect(res.kids.map((k) => k.name)).toEqual(["אמה", "אדם"]);
    for (const k of res.kids) expect(k.token.length).toBeGreaterThan(20);
    expect(new Set(res.kids.map((k) => k.token)).size).toBe(2);

    const parents = await db.query<{ id: string; email: string; name: string }>("select id, email, name from parents");
    expect(parents.rows).toHaveLength(1);
    expect(parents.rows[0].email).toBe("parent@example.com"); // normalised
    expect(parents.rows[0].name).toBe("רף");
    expect(parents.rows[0].id).toBe(res.parentId);

    const kids = await db.query<{ name: string; feminine: boolean; age: number; grade: string; level: string; email: string | null }>(
      "select name, feminine, age, grade, level, email from kids where parent_id = $1 order by created_at",
      [res.parentId],
    );
    expect(kids.rows).toEqual([
      { name: "אמה", feminine: true, age: 10, grade: "ה", level: "standard", email: "emma@example.com" },
      { name: "אדם", feminine: false, age: 8, grade: "ג", level: "advanced", email: null },
    ]);

    const stats = await db.query("select kid_id from kid_stats");
    expect(stats.rows).toHaveLength(2);

    const contacts = await db.query<{ name: string; email: string; role: string }>("select name, email, role from kid_contacts");
    expect(contacts.rows).toEqual([{ name: "דנה", email: "dana@example.com", role: "relative" }]);
  });

  it("uses the Supabase auth uid for the parents row when one is given", async () => {
    const parentId = crypto.randomUUID();
    const res = await registerFamily(reg({ email: "signed-in@example.com" }), { parentId });
    expect(res.parentId).toBe(parentId);
    const r = await db.query("select id from parents where id = $1", [parentId]);
    expect(r.rows).toHaveLength(1);
  });

  it("skips a kid email that is the parent's own address", async () => {
    const res = await registerFamily(
      reg({ email: "shared@example.com", kids: [kid({ name: "אמה", email: "Shared@Example.com" }), kid({ name: "אדם", email: "adam@example.com" })] }),
    );
    const rows = await db.query<{ name: string; email: string | null }>("select name, email from kids where parent_id = $1 order by created_at", [res.parentId]);
    expect(rows.rows).toEqual([
      { name: "אמה", email: null },
      { name: "אדם", email: "adam@example.com" },
    ]);
  });

  it("returns existed=true on a second registration with the same email, and creates nothing new", async () => {
    const first = await registerFamily(reg({ email: "twice@example.com" }));
    const second = await registerFamily(reg({ email: "TWICE@example.com", kids: [kid({ name: "מישהו אחר" })] }));

    expect(second.existed).toBe(true);
    expect(second.parentId).toBe(first.parentId);
    expect(second.kids).toEqual([]);

    expect((await db.query("select id from parents")).rows).toHaveLength(1);
    expect((await db.query("select id from kids")).rows).toHaveLength(1);
  });
});
