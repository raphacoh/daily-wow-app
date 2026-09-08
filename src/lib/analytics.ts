/**
 * First-party analytics. No cookies, no third-party script, no PII: a visitor is a salted hash of
 * (IP, user agent, day) that rotates every day. Enough for a funnel, useless for tracking a person.
 */
import { createHash } from "node:crypto";
import { db, hasDb } from "./db";
import { localDate } from "./progress";
import { APP } from "./config";

export type EventName = "land" | "demo_start" | "demo_complete" | "signup" | "lesson_complete" | "subscribe";

export function visitorHash(req: Request, now = new Date()): string {
  const ip = (req.headers.get("x-forwarded-for") || req.headers.get("x-real-ip") || "").split(",")[0].trim();
  const ua = req.headers.get("user-agent") || "";
  const day = localDate(now, APP.timezone);
  const salt = process.env.SESSION_SECRET || "dev";
  return createHash("sha256").update(`${salt}|${day}|${ip}|${ua}`).digest("hex").slice(0, 24);
}

export async function track(name: EventName, o: { visitor?: string | null; parent_id?: string | null; kid_id?: string | null; edition_n?: number | null; props?: Record<string, unknown> } = {}): Promise<void> {
  if (!hasDb()) return;
  try {
    await db().query("insert into events (name, visitor, parent_id, kid_id, edition_n, props) values ($1,$2,$3,$4,$5,$6)", [
      name,
      o.visitor ?? null,
      o.parent_id ?? null,
      o.kid_id ?? null,
      o.edition_n ?? null,
      JSON.stringify(o.props ?? {}),
    ]);
  } catch (e) {
    console.warn("[analytics]", name, String((e as Error).message).slice(0, 80));
  }
}

export interface Funnel {
  since: string;
  landed: number;           // distinct visitors who got the front page
  demo_started: number;     // distinct visitors who pressed start on the demo
  demo_completed: number;   // distinct visitors who opened the vault in the demo
  signups: number;          // families registered in the period
  lessons_completed: number;// complete lessons by signed-up kids in the period
  subscriptions: number;    // subscriptions activated in the period
}

export interface Totals {
  families: number;
  kids: number;
  lessons_completed: number;
  kids_who_completed: number;
  paying_kids: number;      // active or past_due subscriptions right now
  paying_families: number;
}

export async function funnel(days: number, now = new Date()): Promise<Funnel> {
  const since = new Date(now.getTime() - days * 86400e3);
  const q = db();
  const distinct = async (name: string) => Number(((await q.query<{ n: number }>("select count(distinct visitor)::int as n from events where name = $1 and created_at >= $2", [name, since])).rows[0] ?? { n: 0 }).n);
  const count = async (sql: string, params: unknown[]) => Number(((await q.query<{ n: number }>(sql, params)).rows[0] ?? { n: 0 }).n);
  return {
    since: since.toISOString(),
    landed: await distinct("land"),
    demo_started: await distinct("demo_start"),
    demo_completed: await distinct("demo_complete"),
    signups: await count("select count(*)::int as n from parents where created_at >= $1", [since]),
    lessons_completed: await count("select count(*)::int as n from completions where complete and completed_at >= $1", [since]),
    subscriptions: await count("select count(*)::int as n from events where name = 'subscribe' and created_at >= $1", [since]),
  };
}

export async function totals(): Promise<Totals> {
  const q = db();
  const one = async (sql: string) => Number(((await q.query<{ n: number }>(sql)).rows[0] ?? { n: 0 }).n);
  return {
    families: await one("select count(*)::int as n from parents where deleted_at is null"),
    kids: await one("select count(*)::int as n from kids where deleted_at is null"),
    lessons_completed: await one("select count(*)::int as n from completions where complete"),
    kids_who_completed: await one("select count(distinct kid_id)::int as n from completions where complete"),
    paying_kids: await one("select count(distinct kid_id)::int as n from subscriptions where status in ('active','past_due')"),
    paying_families: await one("select count(distinct k.parent_id)::int as n from subscriptions s join kids k on k.id = s.kid_id where s.status in ('active','past_due')"),
  };
}

/** Daily series for the last N days: landed / demo_started / demo_completed / signups / lessons / subscriptions. */
export async function daily(days: number, now = new Date()): Promise<{ day: string; landed: number; demo_started: number; demo_completed: number; signups: number; lessons: number; subscriptions: number }[]> {
  const since = new Date(now.getTime() - days * 86400e3);
  const q = db();
  const ev = await q.query<{ day: string; name: string; n: number }>(
    "select to_char(created_at at time zone $2, 'YYYY-MM-DD') as day, name, count(distinct coalesce(visitor, id::text))::int as n from events where created_at >= $1 group by 1, 2",
    [since, APP.timezone],
  );
  const su = await q.query<{ day: string; n: number }>("select to_char(created_at at time zone $2, 'YYYY-MM-DD') as day, count(*)::int as n from parents where created_at >= $1 group by 1", [since, APP.timezone]);
  const co = await q.query<{ day: string; n: number }>("select to_char(completed_at at time zone $2, 'YYYY-MM-DD') as day, count(*)::int as n from completions where complete and completed_at >= $1 group by 1", [since, APP.timezone]);
  const rows = new Map<string, { day: string; landed: number; demo_started: number; demo_completed: number; signups: number; lessons: number; subscriptions: number }>();
  const get = (d: string) => rows.get(d) ?? (rows.set(d, { day: d, landed: 0, demo_started: 0, demo_completed: 0, signups: 0, lessons: 0, subscriptions: 0 }), rows.get(d)!);
  for (const r of ev.rows) {
    const x = get(r.day);
    if (r.name === "land") x.landed = r.n;
    else if (r.name === "demo_start") x.demo_started = r.n;
    else if (r.name === "demo_complete") x.demo_completed = r.n;
    else if (r.name === "subscribe") x.subscriptions = r.n;
  }
  for (const r of su.rows) get(r.day).signups = r.n;
  for (const r of co.rows) get(r.day).lessons = r.n;
  return Array.from(rows.values()).sort((a, b) => (a.day < b.day ? 1 : -1));
}

export interface SignupRow {
  email: string;
  name: string;
  created_at: string;
  kids: { name: string; level: string; grade: string; completions: number }[];
  paying: boolean;
  last_completion: string | null;
}

/** Who signed up, newest first, with their kids and activity (editor-only). */
export async function signups(limit = 100): Promise<SignupRow[]> {
  const r = await db().query<{ email: string; name: string; created_at: Date; kids: unknown; paying: boolean; last_completion: Date | null }>(
    `select p.email, p.name, p.created_at,
       coalesce((select json_agg(json_build_object('name', k.name, 'level', k.level, 'grade', k.grade,
                  'completions', (select count(*)::int from completions c where c.kid_id = k.id and c.complete)) order by k.created_at)
                 from kids k where k.parent_id = p.id and k.deleted_at is null), '[]'::json) as kids,
       exists(select 1 from subscriptions s join kids k on k.id = s.kid_id where k.parent_id = p.id and s.status in ('active','past_due')) as paying,
       (select max(c.completed_at) from completions c join kids k on k.id = c.kid_id where k.parent_id = p.id and c.complete) as last_completion
     from parents p where p.deleted_at is null order by p.created_at desc limit $1`,
    [limit],
  );
  return r.rows.map((x) => ({
    email: x.email,
    name: x.name,
    created_at: new Date(x.created_at).toISOString(),
    kids: (typeof x.kids === "string" ? JSON.parse(x.kids) : x.kids) as SignupRow["kids"],
    paying: !!x.paying,
    last_completion: x.last_completion ? new Date(x.last_completion).toISOString() : null,
  }));
}
