/**
 * Kids, profiles, and completions (PRD §6.2, §6.5). All server-side.
 */
import { db, type Queryable } from "./db";
import { decryptToken, encryptToken, hashToken, looksLikeToken, newLinkToken } from "./tokens";
import { badgesFor, computeStreak, levelFor, localDate, xpFor } from "./progress";
import { rebuildProgress, type Progress } from "./gamification";

export type Level = "support" | "standard" | "on_track" | "advanced";
/** The three levels parents choose from. `on_track` still exists in the database (legacy) and behaves like `standard`. */
export const LEVELS_UI: Record<Exclude<Level, "on_track">, { label: string; blurb: string }> = {
  support: { label: "צריך/ה עזרה", blurb: "קורא/ת לאט, הולך/ת לאיבוד בטקסטים ארוכים, צריך/ה צעדים קונקרטיים." },
  standard: { label: "רגיל", blurb: "מסתדר/ת יפה בבית הספר. מקבל/ת שאלת המשך אחרי כל תשובה, והאתגר מומלץ." },
  advanced: { label: "מתקדם/ת", blurb: "מחונן/ת או משתעמם/ת מהקצב הרגיל — לדחוף: המשימות הקשות, ההסבר המלא." },
};
export function normLevel(l: string | null | undefined): Exclude<Level, "on_track"> {
  return l === "support" || l === "advanced" ? l : "standard";
}
export const GRADES = ["ב", "ג", "ד", "ה", "ו", "ז", "ח"] as const;

export interface KidRow {
  id: string;
  parent_id: string;
  name: string;
  feminine: boolean;
  age: number;
  grade: string;
  level: Level;
  email: string | null;
  paused: boolean;
  free_assistant_until: Date | null;
  link_token_enc: string | null;
  created_at: Date;
}

/** The kid's personal link (the raw token is kept encrypted at rest; the hash is what lookups use). */
export function kidLink(kid: Pick<KidRow, "link_token_enc">, appUrl: string, editionN: number | "today" = "today"): string | null {
  const raw = kid.link_token_enc ? decryptToken(kid.link_token_enc) : null;
  return raw ? `${appUrl}/l/${editionN}?k=${encodeURIComponent(raw)}` : null;
}

export interface KidStats {
  streak: number;
  best: number;
  xp: number;
  badges: string[];
  last_done_date: string | null;
}

export interface ParentRow {
  id: string;
  email: string;
  name: string;
  timezone: string;
  locale: string;
  is_editor: boolean;
  notify_completion: boolean;
  notify_weekly: boolean;
  notify_streak_risk: boolean;
  keep_explanations: boolean;
}

export async function kidByToken(token: string, q: Queryable = db()): Promise<(KidRow & { parent: ParentRow }) | null> {
  if (!looksLikeToken(token)) return null;
  const r = await q.query(
    `select k.*, row_to_json(p.*) as parent from kids k join parents p on p.id = k.parent_id
     where k.link_token_hash = $1 and k.deleted_at is null and p.deleted_at is null`,
    [hashToken(token)],
  );
  const row = r.rows[0] as unknown as (KidRow & { parent: ParentRow }) | undefined;
  return row ?? null;
}

export async function kidById(id: string, q: Queryable = db()): Promise<(KidRow & { parent: ParentRow }) | null> {
  const r = await q.query(
    `select k.*, row_to_json(p.*) as parent from kids k join parents p on p.id = k.parent_id where k.id = $1 and k.deleted_at is null`,
    [id],
  );
  return (r.rows[0] as unknown as (KidRow & { parent: ParentRow }) | undefined) ?? null;
}

export async function statsFor(kidId: string, q: Queryable = db()): Promise<KidStats> {
  const r = await q.query("select streak, best, xp, badges, last_done_date from kid_stats where kid_id = $1", [kidId]);
  const s = r.rows[0] as (Omit<KidStats, "last_done_date"> & { last_done_date: Date | string | null }) | undefined;
  if (!s) return { streak: 0, best: 0, xp: 0, badges: [], last_done_date: null };
  return { ...s, last_done_date: s.last_done_date ? String(s.last_done_date instanceof Date ? s.last_done_date.toISOString().slice(0, 10) : s.last_done_date) : null };
}

/** What the page needs to render for one kid — never the parent's email. */
export async function profileFor(kid: KidRow & { parent: ParentRow }, q: Queryable = db()) {
  const stats = await statsFor(kid.id, q);
  return {
    kid: { id: kid.id, name: kid.name, feminine: kid.feminine, age: kid.age, grade: kid.grade, level: kid.level },
    stats,
    level_name: levelFor(stats.xp, kid.feminine).name,
    keep_explanations: !!kid.parent.keep_explanations,
    timezone: kid.parent.timezone,
  };
}

export interface NewKid {
  name: string;
  feminine: boolean;
  age: number;
  grade: string;
  level: Level;
  email?: string | null;
}

export async function createKid(parentId: string, k: NewKid, q: Queryable = db()): Promise<{ id: string; token: string }> {
  const token = newLinkToken();
  const r = await q.query(
    `insert into kids (parent_id, name, feminine, age, grade, level, email, link_token_hash, link_token_enc)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9) returning id`,
    [parentId, k.name.trim(), k.feminine, k.age, k.grade, k.level, k.email?.trim().toLowerCase() || null, hashToken(token), encryptToken(token)],
  );
  const id = String((r.rows[0] as { id: string }).id);
  await q.query("insert into kid_stats (kid_id) values ($1) on conflict do nothing", [id]);
  return { id, token };
}

export async function rotateKidToken(kidId: string, q: Queryable = db()): Promise<string> {
  const token = newLinkToken();
  await q.query("update kids set link_token_hash = $2, link_token_enc = $3 where id = $1", [kidId, hashToken(token), encryptToken(token)]);
  return token;
}

/* ---------- completions ---------- */

export interface CompletionInput {
  edition_n: number;
  score: number;
  max: number;
  complete: boolean;
  challenge: boolean;
  explanation?: string | null;
  now?: Date;
}

export interface CompletionResult {
  ok: true;
  stats: KidStats;
  xp_awarded: number;
  late: boolean;
  new_badges: string[];
  first_time: boolean;
  improved: boolean;
  password: string;
  /** roots, medals, cards, badges, shields — replayed from facts after this completion (spec P0) */
  progress: Progress | null;
}

/**
 * Record a completion transactionally. Duplicates for (kid, edition) are rejected unless the score improves;
 * streak is derived from the completions table, never incremented blindly.
 */
export async function recordCompletion(kid: KidRow & { parent: ParentRow }, input: CompletionInput): Promise<CompletionResult | { ok: false; error: string }> {
  const now = input.now ?? new Date();
  const tz = kid.parent.timezone || "Asia/Jerusalem";
  const today = localDate(now, tz);
  return db().tx(async (q) => {
    const ed = await q.query<{ date: Date | string; max_score: number; password: string; status: string }>(
      "select date, max_score, password, status from editions where n = $1 for update",
      [input.edition_n],
    );
    const edition = ed.rows[0];
    if (!edition || edition.status !== "released") return { ok: false as const, error: "edition_not_released" };
    const editionDate = edition.date instanceof Date ? localDate(edition.date, "UTC") : String(edition.date).slice(0, 10);
    const late = today > editionDate;
    const max = Math.max(1, Math.min(input.max || edition.max_score, edition.max_score));
    const score = Math.max(0, Math.min(Math.round(input.score), max));

    // lock this kid's stats row so two tabs cannot double-award
    await q.query("insert into kid_stats (kid_id) values ($1) on conflict do nothing", [kid.id]);
    await q.query("select 1 from kid_stats where kid_id = $1 for update", [kid.id]);

    const prev = await q.query<{ score: number; complete: boolean; late: boolean; xp_awarded: number; challenge: boolean }>(
      "select score, complete, late, xp_awarded, challenge from completions where kid_id = $1 and edition_n = $2",
      [kid.id, input.edition_n],
    );
    const existing = prev.rows[0];
    const improved = !!existing && (score > existing.score || (input.complete && !existing.complete) || (input.challenge && !existing.challenge));
    if (existing && !improved) {
      const stats = await statsFor(kid.id, q);
      const progress = await rebuildProgress(kid, tz, now, q);
      return { ok: true as const, stats, xp_awarded: existing.xp_awarded, late: existing.late, new_badges: [], first_time: false, improved: false, password: edition.password, progress };
    }

    // streak after this completion (on-time completions only)
    const released = await q.query<{ date: Date | string }>("select date from editions where status = 'released' and date <= $1", [today]);
    const releasedDates = released.rows.map((r) => (r.date instanceof Date ? localDate(r.date, "UTC") : String(r.date).slice(0, 10)));
    const done = await q.query<{ date: Date | string }>(
      `select e.date from completions c join editions e on e.n = c.edition_n
       where c.kid_id = $1 and c.complete and not c.late and c.edition_n <> $2`,
      [kid.id, input.edition_n],
    );
    const onTime = new Set(done.rows.map((r) => (r.date instanceof Date ? localDate(r.date, "UTC") : String(r.date).slice(0, 10))));
    const wasLate = existing ? existing.late : late;
    const completeNow = input.complete || !!existing?.complete;
    if (completeNow && !wasLate) onTime.add(editionDate);
    const streakAfter = computeStreak(releasedDates, onTime, today);

    const firstEver = !existing?.complete && completeNow && (await q.query("select 1 from completions where kid_id = $1 and complete and edition_n <> $2 limit 1", [kid.id, input.edition_n])).rows.length === 0;

    // XP: base on the (best) score; the streak bonus is fixed at the first complete, on-time completion
    const prevBase = existing ? Math.max(0, existing.score) * 10 + (existing.complete ? 20 : 0) : 0;
    const prevBonus = existing ? Math.max(0, existing.xp_awarded - prevBase) : 0;
    const bonusNow = existing?.complete ? prevBonus : completeNow && !wasLate ? Math.min(50, streakAfter * 5) : 0;
    const xpAwarded = xpFor(score, completeNow, 0, true) + bonusNow; // base + done, plus the bonus decided above
    const xpDelta = xpAwarded - (existing?.xp_awarded ?? 0);

    const challenge = input.challenge || !!existing?.challenge;
    if (existing) {
      await q.query(
        `update completions set score = $3, max = $4, complete = $5, challenge = $6, xp_awarded = $7, explanation = coalesce($8, explanation), updated_at = now()
         where kid_id = $1 and edition_n = $2`,
        [kid.id, input.edition_n, score, max, completeNow, challenge, xpAwarded, input.explanation ?? null],
      );
    } else {
      await q.query(
        `insert into completions (kid_id, edition_n, score, max, complete, late, challenge, xp_awarded, explanation, completed_at)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [kid.id, input.edition_n, score, max, completeNow, late, challenge, xpAwarded, input.explanation ?? null, now],
      );
    }

    const stats = await statsFor(kid.id, q);
    const newBadges = badgesFor({ complete: completeNow, late: wasLate, score, max, challenge, streakAfter, firstEverCompletion: firstEver }).filter((b) => !stats.badges.includes(b));
    const badges = [...stats.badges, ...newBadges];
    const streak = completeNow ? streakAfter : stats.streak;
    const best = Math.max(stats.best, streak);
    const lastDone = completeNow && !wasLate ? editionDate : stats.last_done_date;
    await q.query(
      `update kid_stats set streak = $2, best = $3, xp = xp + $4, badges = $5, last_done_date = $6, updated_at = now() where kid_id = $1`,
      [kid.id, streak, best, xpDelta, badges, lastDone],
    );
    const after = await statsFor(kid.id, q);
    const progress = await rebuildProgress(kid, tz, now, q);
    return { ok: true as const, stats: after, xp_awarded: xpAwarded, late: wasLate, new_badges: newBadges, first_time: !existing, improved, password: edition.password, progress };
  });
}

/** Recompute streak/best/xp/badges for a kid from the completions table (repair tool, admin). */
export async function rebuildStats(kidId: string, timezone: string, now = new Date()): Promise<KidStats> {
  const today = localDate(now, timezone);
  return db().tx(async (q) => {
    const released = await q.query<{ date: Date | string }>("select date from editions where status = 'released' and date <= $1", [today]);
    const releasedDates = released.rows.map((r) => (r.date instanceof Date ? localDate(r.date, "UTC") : String(r.date).slice(0, 10)));
    const rows = await q.query<{ date: Date | string; complete: boolean; late: boolean; xp_awarded: number; score: number; max: number; challenge: boolean; completed_at: Date }>(
      `select e.date, c.complete, c.late, c.xp_awarded, c.score, c.max, c.challenge, c.completed_at from completions c join editions e on e.n = c.edition_n
       where c.kid_id = $1 order by e.date asc, c.completed_at asc`,
      [kidId],
    );
    const onTime = new Set<string>();
    let best = 0, xp = 0, first = true;
    const badges = new Set<string>();
    let lastDone: string | null = null;
    for (const r of rows.rows) {
      const d = r.date instanceof Date ? localDate(r.date, "UTC") : String(r.date).slice(0, 10);
      xp += r.xp_awarded;
      if (r.complete && !r.late) { onTime.add(d); lastDone = d; }
      const streakAt = computeStreak(releasedDates, onTime, d);
      best = Math.max(best, streakAt);
      badgesFor({ complete: r.complete, late: r.late, score: r.score, max: r.max, challenge: r.challenge, streakAfter: streakAt, firstEverCompletion: first && r.complete && !r.late }).forEach((b) => badges.add(b));
      if (r.complete) first = false;
    }
    const streak = computeStreak(releasedDates, onTime, today);
    best = Math.max(best, streak);
    await q.query(
      `insert into kid_stats (kid_id, streak, best, xp, badges, last_done_date, updated_at) values ($1,$2,$3,$4,$5,$6,now())
       on conflict (kid_id) do update set streak = excluded.streak, best = excluded.best, xp = excluded.xp, badges = excluded.badges, last_done_date = excluded.last_done_date, updated_at = now()`,
      [kidId, streak, best, xp, Array.from(badges), lastDone],
    );
    return statsFor(kidId, q);
  });
}

/** The streak shown on dashboards/emails must reflect missed days without a nightly job: derive on read. */
export async function liveStreak(kidId: string, timezone: string, now = new Date(), q: Queryable = db()): Promise<number> {
  const today = localDate(now, timezone);
  const released = await q.query<{ date: Date | string }>("select date from editions where status = 'released' and date <= $1", [today]);
  const done = await q.query<{ date: Date | string }>(
    "select e.date from completions c join editions e on e.n = c.edition_n where c.kid_id = $1 and c.complete and not c.late",
    [kidId],
  );
  const toD = (r: { date: Date | string }) => (r.date instanceof Date ? localDate(r.date, "UTC") : String(r.date).slice(0, 10));
  return computeStreak(released.rows.map(toD), done.rows.map(toD), today);
}
