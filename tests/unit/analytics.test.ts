import { beforeAll, describe, expect, it } from "vitest";
import { freshDb, seedEdition, seedParent } from "./setup";
import { createKid, kidByToken, recordCompletion } from "@/lib/kids";
import { daily, funnel, totals, track, visitorHash } from "@/lib/analytics";
import { registerFamily } from "@/lib/family";
import type { Db } from "@/lib/db";

let db: Db;

describe("first-party analytics", () => {
  beforeAll(async () => {
    db = (await freshDb()).db;
    await seedEdition(db, 1, "2026-09-08");
  });

  it("hashes a visitor without keeping the address, and rotates daily", () => {
    const req = new Request("http://x/", { headers: { "x-forwarded-for": "1.2.3.4", "user-agent": "UA" } });
    const a = visitorHash(req, new Date("2026-09-08T10:00:00Z"));
    const b = visitorHash(req, new Date("2026-09-09T10:00:00Z"));
    expect(a).toHaveLength(24);
    expect(a).not.toBe(b);
    expect(a).not.toContain("1.2.3.4");
  });

  it("counts the funnel by distinct visitor and business events from the real tables", async () => {
    for (const v of ["v1", "v1", "v2", "v3"]) await track("land", { visitor: v });
    for (const v of ["v1", "v2"]) await track("demo_start", { visitor: v });
    await track("demo_complete", { visitor: "v1" });
    const r = await registerFamily({ parentName: "א", email: "a@example.com", consent: true, kids: [{ name: "דן", feminine: false, age: 10, grade: "ה", level: "standard" }] });
    expect(r.existed).toBe(false);
    const p2 = await seedParent(db, { email: "b@example.com" });
    const { token } = await createKid(p2, { name: "גל", feminine: true, age: 9, grade: "ד", level: "standard" });
    const kid = (await kidByToken(token))!;
    await recordCompletion(kid, { edition_n: 1, score: 11, max: 11, complete: true, challenge: false, now: new Date("2026-09-08T09:00:00+03:00") });
    await track("subscribe", { kid_id: kid.id, parent_id: p2 });
    await db.query("insert into subscriptions (kid_id, status, provider_subscription_id) values ($1, 'active', 'sub_1')", [kid.id]);

    const f = await funnel(7, new Date("2026-09-08T12:00:00Z"));
    expect(f).toMatchObject({ landed: 3, demo_started: 2, demo_completed: 1, signups: 2, lessons_completed: 1, subscriptions: 1 });
    const t = await totals();
    expect(t).toMatchObject({ families: 2, kids: 2, lessons_completed: 1, kids_who_completed: 1, paying_kids: 1, paying_families: 1 });
    const d = await daily(7, new Date("2026-09-08T12:00:00Z"));
    expect(d[0]).toMatchObject({ landed: 3, demo_started: 2, demo_completed: 1, signups: 2, lessons: 1, subscriptions: 1 });
    // a signup event was recorded by registerFamily itself
    const ev = await db.query("select count(*)::int as n from events where name = 'signup'");
    expect((ev.rows[0] as { n: number }).n).toBe(1);
  });
});
