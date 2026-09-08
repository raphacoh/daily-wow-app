import { beforeAll, describe, expect, it } from "vitest";
import { freshDb, seedEdition, seedParent } from "./setup";
import { createKid } from "@/lib/kids";
import { chat, openSession, setModel } from "@/lib/arto";
import { setMailer, type Mail } from "@/lib/emails";
import type { Db } from "@/lib/db";

let db: Db;
let token: string;
const sent: Mail[] = [];

describe("free cap → one parent notice; demo → per-session gate", () => {
  beforeAll(async () => {
    db = (await freshDb()).db;
    const parent = await seedParent(db, { email: "mum@example.com" });
    await seedEdition(db, 1, "2026-09-08", { html: "<title>x</title><script>const LESSON_CONTEXT='ctx';</script>" });
    token = (await createKid(parent, { name: "יואב", feminine: false, age: 12, grade: "ז", level: "standard" })).token;
    setModel(async () => ({ text: JSON.stringify({ scope: "lesson", reply: "כן" }), input_tokens: 1, output_tokens: 1 }));
    setMailer(async (m) => { sent.push(m); return { id: "m" + sent.length }; });
  });

  it("emails the parent once when the 4th message is refused, never the kid", async () => {
    const s = await openSession(token, 1);
    if ("error" in s) throw new Error(s.error);
    for (let i = 0; i < 3; i++) expect((await chat(s.token, [{ role: "user", content: "שאלה " + i }])).ok).toBe(true);
    const r = await chat(s.token, [{ role: "user", content: "רביעית" }]);
    expect(r).toMatchObject({ ok: false, error: "cap", status: 429, subscribed: false, cap: 3, demo: false });
    await new Promise((r) => setTimeout(r, 50));
    expect(sent.length).toBe(1);
    expect(sent[0].to).toEqual(["mum@example.com"]);
    expect(sent[0].subject).toContain("יואב");
    expect(sent[0].html).toContain("/billing?kid=");
    // a second refusal the same day sends nothing more
    await chat(s.token, [{ role: "user", content: "חמישית" }]);
    await new Promise((r) => setTimeout(r, 50));
    expect(sent.length).toBe(1);
    const rows = await db.query("select count(*)::int as n from sends where kind = 'cap'");
    expect((rows.rows[0] as { n: number }).n).toBe(1);
  });

  it("a demo visitor gets 3 answers per session, then the demo gate, and the pool stays shared", async () => {
    const a = await openSession("", 1);
    if ("error" in a) throw new Error(a.error);
    expect(a).toMatchObject({ demo: true, cap: 3, remaining: 3 });
    for (let i = 0; i < 3; i++) expect((await chat(a.token, [{ role: "user", content: "q" + i }])).ok).toBe(true);
    expect(await chat(a.token, [{ role: "user", content: "q4" }])).toMatchObject({ ok: false, error: "cap", demo: true, cap: 3 });
    const b = await openSession("", 1); // another visitor, same day: their own 3
    if ("error" in b) throw new Error(b.error);
    expect(b.remaining).toBe(3);
    expect((await chat(b.token, [{ role: "user", content: "q" }])).ok).toBe(true);
    const pool = await db.query("select messages from arto_counters where key = 'demo'");
    expect((pool.rows[0] as { messages: number }).messages).toBe(4);
    expect(sent.length).toBe(1); // no parent to notify in the demo
  });
});
