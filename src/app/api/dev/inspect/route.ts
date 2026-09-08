import { NextResponse } from "next/server";
import { db, hasDb } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** POST /api/dev/inspect — development only: a small read-out for the e2e test. */
export async function POST() {
  if (process.env.NODE_ENV === "production" || process.env.DEV_SEED !== "1") return NextResponse.json({ error: "not_found" }, { status: 404 });
  if (!hasDb()) return NextResponse.json({ error: "no_db" }, { status: 503 });
  const kids = await db().query(
    `select k.name, k.level, s.streak, s.best, s.xp, s.badges, (select count(*)::int from completions c where c.kid_id = k.id) as completions
     from kids k left join kid_stats s on s.kid_id = k.id where k.deleted_at is null order by k.created_at`,
  );
  const sends = await db().query("select kind, count(*)::int as n from sends group by kind");
  const parents = await db().query("select email, name, (select count(*)::int from kids k where k.parent_id = p.id and k.deleted_at is null) as kids from parents p order by created_at");
  return NextResponse.json({ kids: kids.rows, sends: sends.rows, parents: parents.rows });
}
