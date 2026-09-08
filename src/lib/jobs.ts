/**
 * Scheduled jobs (PRD §6.4, §6.5, §11).
 *
 * Four jobs, all safe to run twice:
 *   sendDaily       — one mail per family for one edition   (idempotent per (edition, parent))
 *   sendWeekly      — Sunday recap per parent               (idempotent per (parent, ISO week))
 *   sendStreakRisk  — 19:00 nudge per kid                   (idempotent per (edition, kid))
 *   nightly         — housekeeping only
 *
 * Two rules the whole file obeys:
 *
 * 1. **Never mutate derived state.** Streaks come from `liveStreak()` (which reads completions);
 *    no job writes `kid_stats`. A job that crashes therefore cannot corrupt a streak.
 *
 * 2. **Claim before sending.** Every job inserts its `sends` row *before* handing the mail to Resend,
 *    with `on conflict do nothing returning id`. No row back → somebody already sent it → skip.
 *    If the send then fails, the claim is released so the next cron run retries.
 *
 * Time zones: the editor's timezone (APP.timezone) dates editions; each family's own timezone decides
 * when "today" and "19:00" are for them. Crons are scheduled twice in UTC (summer/winter) and gated on
 * local time here, so the extra run is a no-op instead of an hour-early email — see `dailySendGate`.
 */
import { db, type Queryable } from "./db";
import { APP, getConfig, getNumber } from "./config";
import { getEdition, listEditions } from "./editions";
import { kidLink, liveStreak, statsFor, type KidRow, type ParentRow } from "./kids";
import { localDate } from "./progress";
import { dailyMail, sendBatch, sendMail, streakRiskMail, weeklyMail, type Mail, type WeekDay } from "./emails";
import { MEDAL_NAMES, progressFor } from "./gamification";
import { purgeOffPrompts } from "./arto";

export interface JobResult {
  sent: number;
  skipped: number;
  errors: string[];
}

/** Families are only mailed once their own clock has passed these hours (see `dailySendGate` for daily). */
const WEEKLY_HOUR = 18;
const RISK_HOUR = 19;

/** How many families we build and hand to Resend's batch endpoint at a time. */
const BATCH = 50;

/* ------------------------------------------------------------------ *
 * Small time helpers
 * ------------------------------------------------------------------ */

/** "HH:MM" for `at` in an IANA timezone (24h). */
export function localTime(at: Date, timezone: string): string {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: timezone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(at);
  const g = (t: string) => parts.find((p) => p.type === t)?.value ?? "00";
  return `${g("hour")}:${g("minute")}`;
}

export function localHour(at: Date, timezone: string): number {
  return Number(localTime(at, timezone).slice(0, 2));
}

/** YYYY-MM-DD ± n days. */
export function addDays(date: string, n: number): string {
  const t = new Date(`${date}T00:00:00Z`);
  t.setUTCDate(t.getUTCDate() + n);
  return t.toISOString().slice(0, 10);
}

/**
 * ISO-8601 week key, e.g. "2026-W37" — the idempotency key for the weekly mail.
 * (A text key rather than an arithmetic trick packed into `edition_n`: `sends.week_key` exists for this,
 * with a partial unique index on (parent_id, week_key) where kind = 'weekly'.)
 */
export function isoWeekKey(date: string): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7) + 3); // the Thursday of this ISO week
  const isoYear = d.getUTCFullYear();
  const jan4 = new Date(Date.UTC(isoYear, 0, 4));
  jan4.setUTCDate(jan4.getUTCDate() - ((jan4.getUTCDay() + 6) % 7) + 3); // the Thursday of ISO week 1
  const week = 1 + Math.round((d.getTime() - jan4.getTime()) / (7 * 86400e3));
  return `${isoYear}-W${String(week).padStart(2, "0")}`;
}

/** "8.9" — a short Hebrew-friendly day label for the weekly grid header. */
function dayLabel(date: string): string {
  const [, m, d] = date.split("-");
  return `${Number(d)}.${Number(m)}`;
}

/* ------------------------------------------------------------------ *
 * Families
 * ------------------------------------------------------------------ */

export interface Family {
  parent: ParentRow;
  kids: KidRow[];
  /** extra adults per kid id, from kid_contacts with notify_daily */
  contacts: Map<string, string[]>;
}

/** Case-insensitive dedupe that keeps the first spelling seen (the parent's own). */
function dedupe(emails: (string | null | undefined)[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of emails) {
    const e = (raw ?? "").trim();
    if (!e) continue;
    const k = e.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(e);
  }
  return out;
}

/**
 * Active families: a parent that isn't deleted, with at least one kid that isn't paused or deleted.
 * `language` filters on the parent's locale (PRD §11 — "the daily send filters families by language");
 * pass null to ignore language (weekly / streak-risk, which aren't tied to one edition's language).
 */
export async function activeFamilies(language: string | null, q: Queryable = db()): Promise<Family[]> {
  const lang = language ? language.toLowerCase().split("-")[0] : null;
  const langClause = lang ? "and lower(split_part(p.locale, '-', 1)) = $1" : "";
  const params = lang ? [lang] : [];

  const parents = await q.query<ParentRow>(
    `select p.* from parents p
     where p.deleted_at is null ${langClause}
       and exists (select 1 from kids k where k.parent_id = p.id and k.deleted_at is null and not k.paused)
     order by p.created_at, p.id`,
    params,
  );
  if (!parents.rows.length) return [];

  const kids = await q.query<KidRow>(
    `select k.* from kids k join parents p on p.id = k.parent_id
     where p.deleted_at is null and k.deleted_at is null and not k.paused ${langClause}
     order by k.created_at, k.id`,
    params,
  );
  const contacts = await q.query<{ kid_id: string; email: string }>(
    `select c.kid_id, c.email from kid_contacts c
     join kids k on k.id = c.kid_id join parents p on p.id = k.parent_id
     where c.notify_daily and p.deleted_at is null and k.deleted_at is null and not k.paused ${langClause}`,
    params,
  );

  const byParent = new Map<string, Family>();
  for (const p of parents.rows) byParent.set(String(p.id), { parent: p, kids: [], contacts: new Map() });
  const kidParent = new Map<string, string>();
  for (const k of kids.rows) {
    const f = byParent.get(String(k.parent_id));
    if (!f) continue;
    f.kids.push(k);
    kidParent.set(String(k.id), String(k.parent_id));
  }
  for (const c of contacts.rows) {
    const f = byParent.get(kidParent.get(String(c.kid_id)) ?? "");
    if (!f) continue;
    const list = f.contacts.get(String(c.kid_id)) ?? [];
    list.push(c.email);
    f.contacts.set(String(c.kid_id), list);
  }
  return Array.from(byParent.values()).filter((f) => f.kids.length > 0);
}

/** parent + kid emails + the extra adults, deduped. */
export function dailyRecipients(f: Family): string[] {
  const out: (string | null)[] = [f.parent.email];
  for (const k of f.kids) {
    out.push(k.email);
    for (const c of f.contacts.get(String(k.id)) ?? []) out.push(c);
  }
  return dedupe(out);
}

/* ------------------------------------------------------------------ *
 * job_runs
 * ------------------------------------------------------------------ */

async function recordRun(job: string, ok: boolean, detail: unknown, startedAt: Date): Promise<void> {
  try {
    await db().query("insert into job_runs (job, started_at, finished_at, ok, detail) values ($1,$2,now(),$3,$4)", [
      job,
      startedAt,
      ok,
      JSON.stringify(detail),
    ]);
  } catch (e) {
    console.warn(`[jobs] could not record job_run for ${job}:`, e);
  }
}

function msg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/* ------------------------------------------------------------------ *
 * 1. Daily
 * ------------------------------------------------------------------ */

/**
 * Is it time to send today's edition? The Vercel cron fires twice (08:05 and 09:05 UTC) because
 * Asia/Jerusalem is UTC+3 in summer and UTC+2 in winter and cron has no timezone. The run that lands
 * before `send_time` in the editor's timezone does nothing; the one after it sends. So the schedule is
 * always "11:05 local", never "10:05 local in winter".
 */
export async function dailySendGate(now: Date): Promise<{ due: boolean; local: string; sendTime: string; timezone: string }> {
  const sendTime = (await getConfig("send_time")) || "11:05";
  const local = localTime(now, APP.timezone);
  return { due: local >= sendTime, local, sendTime, timezone: APP.timezone };
}

/** The edition whose date is today in the editor's timezone, if it is released. */
export async function todaysEdition(now: Date): Promise<number | null> {
  const today = localDate(now, APP.timezone);
  const recent = await listEditions({ limit: 10 });
  const hit = recent.find((e) => String(e.date).slice(0, 10) === today);
  return hit ? hit.n : null;
}

function teaserFor(e: { teaser: string; title: string }): string {
  if (e.teaser && e.teaser.trim()) return e.teaser.trim();
  // A missing teaser must never block the send — the title carries the mail.
  return `היום בגיליון: ${e.title}. שיעור אחד קצר, בערך ${25} דקות, ובסוף — הסיסמה הסודית.`;
}

/**
 * One mail per family for edition N. Idempotent per (edition, parent) through `sends`;
 * `force` deletes the previous claim first so the editor can resend from /admin.
 */
export async function sendDaily(editionN: number, opts: { force?: boolean; now?: Date } = {}): Promise<JobResult> {
  const startedAt = opts.now ?? new Date();
  const errors: string[] = [];
  let sent = 0;
  let skipped = 0;

  const edition = await getEdition(editionN);
  if (!edition) {
    errors.push("edition_not_released");
    await recordRun("send-daily", false, { edition_n: editionN, errors }, startedAt);
    return { sent, skipped, errors };
  }

  const families = await activeFamilies(edition.language || "he");

  // Resend's plan has a daily ceiling (PRD §6.4: free ~100/day, move to paid at ~80 families).
  // At 80% we raise a soft alert the admin page shows; above the ceiling we send what we can.
  const limit = await getNumber("resend_daily_limit");
  if (limit > 0 && families.length >= limit * 0.8) {
    errors.push(`resend_daily_limit_warning: ${families.length} families is ≥ 80% of the ${limit}/day limit — move to a paid Resend plan`);
  }
  const target = limit > 0 ? families.slice(0, limit) : families;
  if (target.length < families.length) {
    errors.push(`resend_daily_limit_reached: ${families.length - target.length} families were not sent (limit ${limit})`);
    skipped += families.length - target.length;
  }

  const teaser = teaserFor(edition);
  const editorNote = edition.editor_note ?? undefined;

  // ---- claim, build, send, in chunks ----
  type Claim = { sendId: string; mail: Mail };
  let pending: Claim[] = [];

  const flush = async () => {
    if (!pending.length) return;
    const chunk = pending;
    pending = [];
    try {
      const r = await sendBatch(chunk.map((c) => c.mail));
      sent += chunk.length;
      // Resend returns ids in request order; only trust them when the counts line up.
      if (r.ids.length === chunk.length) {
        for (let i = 0; i < chunk.length; i++) {
          await db().query("update sends set resend_id = $2 where id = $1", [chunk[i].sendId, r.ids[i]]);
        }
      }
    } catch (e) {
      // Release the claims so the next cron run (or a manual retry) can try again.
      errors.push(`batch_failed: ${msg(e)}`);
      for (const c of chunk) {
        await db().query("delete from sends where id = $1", [c.sendId]).catch(() => {});
        skipped++;
      }
    }
  };

  for (const f of target) {
    const to = dailyRecipients(f);
    if (!to.length) {
      skipped++;
      continue;
    }
    if (opts.force) {
      await db().query("delete from sends where kind = 'daily' and edition_n = $1 and parent_id = $2", [editionN, f.parent.id]);
    }
    const ins = await db().query<{ id: string }>(
      "insert into sends (edition_n, parent_id, kind, to_emails) values ($1,$2,'daily',$3) on conflict do nothing returning id",
      [editionN, f.parent.id, to],
    );
    if (!ins.rows.length) {
      skipped++; // already sent to this family for this edition
      continue;
    }

    const kids = [];
    for (const k of f.kids) {
      let link = kidLink(k, APP.url, editionN);
      if (!link) {
        // No decryptable token (rotated LINK_KEY, or a row imported without one): the demo link still
        // opens the lesson, just without the personal profile. Loud enough to notice in the logs.
        console.warn(`[jobs] kid ${k.id} has no decryptable link token — falling back to the demo link`);
        errors.push(`no_link_token: kid ${k.id}`);
        link = `${APP.url}/l/${editionN}`;
      }
      kids.push({
        name: k.name,
        feminine: !!k.feminine,
        streak: await liveStreak(String(k.id), f.parent.timezone || APP.timezone, startedAt),
        link,
      });
    }

    pending.push({
      sendId: String(ins.rows[0].id),
      mail: dailyMail({
        to,
        editionN,
        editionTitle: edition.title,
        editionDate: String(edition.date).slice(0, 10),
        teaser,
        editorNote,
        kids,
        replyTo: APP.editorEmail,
      }),
    });
    if (pending.length >= BATCH) await flush();
  }
  await flush();

  await recordRun("send-daily", errors.every((e) => e.startsWith("resend_daily_limit_warning")), { edition_n: editionN, sent, skipped, errors, force: !!opts.force }, startedAt);
  return { sent, skipped, errors };
}

/* ------------------------------------------------------------------ *
 * 2. Weekly
 * ------------------------------------------------------------------ */

/**
 * Sunday recap, one mail per parent with `notify_weekly`.
 *
 * Badges: we list `kid_stats.badges` rather than re-deriving the week's badges from completions.
 * Deriving would mean replaying `badgesFor` over the whole history to know which of the kid's badges
 * are new this week — a lot of machinery for a decorative line. The simple version is honest ("the
 * badges you have"), cheap, and cannot disagree with the dashboard. Said out loud, as asked.
 *
 * Idempotent per (parent, ISO week) via `sends.week_key`. Gated on the family's own 18:00 so the two
 * Sunday crons (15:00 and 16:00 UTC) collapse into one send whatever the DST offset is.
 */
export async function sendWeekly(now: Date = new Date(), opts: { force?: boolean } = {}): Promise<JobResult> {
  const startedAt = now;
  const errors: string[] = [];
  let sent = 0;
  let skipped = 0;

  const families = await activeFamilies(null);
  const editorLineRaw = (await getConfig("weekly_editor_line")).trim();
  const editorLine = editorLineRaw || undefined;

  for (const f of families) {
    if (!f.parent.notify_weekly) {
      skipped++;
      continue;
    }
    const tz = f.parent.timezone || APP.timezone;
    if (!opts.force && localHour(now, tz) < WEEKLY_HOUR) {
      skipped++; // too early in this family's day; the second Sunday cron picks them up
      continue;
    }
    const end = localDate(now, tz);
    const start = addDays(end, -6);
    const weekKey = isoWeekKey(end);

    const ins = await db().query<{ id: string }>(
      "insert into sends (parent_id, kind, week_key, to_emails) values ($1,'weekly',$2,$3) on conflict do nothing returning id",
      [f.parent.id, weekKey, [f.parent.email]],
    );
    if (!ins.rows.length) {
      skipped++;
      continue;
    }

    try {
      const released = await db().query<{ n: number; date: Date | string }>(
        "select n, date from editions where status = 'released' and date >= $1 and date <= $2",
        [start, end],
      );
      const editionByDate = new Map<string, number>();
      for (const r of released.rows) editionByDate.set(String(r.date instanceof Date ? localDate(r.date, "UTC") : r.date).slice(0, 10), Number(r.n));

      const kids = [];
      for (const k of f.kids) {
        const done = await db().query<{ edition_n: number; score: number; complete: boolean }>(
          `select c.edition_n, c.score, c.complete from completions c join editions e on e.n = c.edition_n
           where c.kid_id = $1 and e.date >= $2 and e.date <= $3`,
          [k.id, start, end],
        );
        const byEdition = new Map(done.rows.map((r) => [Number(r.edition_n), r]));
        const days: WeekDay[] = [];
        for (let i = 0; i < 7; i++) {
          const date = addDays(start, i);
          const n = editionByDate.get(date);
          const c = n === undefined ? undefined : byEdition.get(n);
          days.push({ date: dayLabel(date), done: !!c?.complete, ...(c?.complete ? { score: Number(c.score) } : {}) });
        }
        const stats = await statsFor(String(k.id));
        // the week's collection from the replayed progress (spec §10); falls back to the lifetime badge list
        const p = await progressFor(String(k.id));
        const weekNs = new Set(released.rows.map((r) => Number(r.n)));
        const weekBadges = p ? p.badges.filter((b) => b.earned_at.slice(0, 10) >= start && b.earned_at.slice(0, 10) <= end).map((b) => b.name) : [];
        const medals = p ? Object.entries(p.medals).filter(([n]) => weekNs.has(Number(n))).map(([, m]) => m) : [];
        const medalLine = (["diamond", "gold", "silver", "bronze"] as const).map((m) => [medals.filter((x) => x === m).length, MEDAL_NAMES[m]] as const).filter(([c]) => c > 0).map(([c, name]) => `${c} ${name}`).join(", ");
        const collection = p && medals.length ? `${medalLine} · ${medals.length} ${medals.length === 1 ? "קלף חדש" : "קלפים חדשים"} · ${p.cards.length} באלבום` : undefined;
        kids.push({ name: k.name, feminine: !!k.feminine, days, badges: p ? weekBadges : stats.badges, collection });
      }

      const mail = weeklyMail({
        to: [f.parent.email],
        parentName: f.parent.name,
        weekLabel: `${dayLabel(start)}–${dayLabel(end)}`,
        kids,
        editorLine,
      });
      const r = await sendMail(mail);
      sent++;
      if (r.id) await db().query("update sends set resend_id = $2 where id = $1", [ins.rows[0].id, r.id]);
    } catch (e) {
      errors.push(`weekly ${f.parent.id}: ${msg(e)}`);
      await db().query("delete from sends where id = $1", [ins.rows[0].id]).catch(() => {});
      skipped++;
    }
  }

  await recordRun("weekly", errors.length === 0, { sent, skipped, errors }, startedAt);
  return { sent, skipped, errors };
}

/* ------------------------------------------------------------------ *
 * 3. Streak at risk
 * ------------------------------------------------------------------ */

/**
 * 19:00 in the family's timezone: one quiet line for a kid who has a live streak going and hasn't
 * opened today's edition yet. Off by default (`parents.notify_streak_risk`). Idempotent per (edition, kid).
 *
 * Nothing here writes state: the streak is read with `liveStreak`, exactly as the dashboard reads it.
 */
export async function sendStreakRisk(now: Date = new Date(), opts: { force?: boolean } = {}): Promise<JobResult> {
  const startedAt = now;
  const errors: string[] = [];
  let sent = 0;
  let skipped = 0;

  const families = await activeFamilies(null);
  for (const f of families) {
    if (!f.parent.notify_streak_risk) {
      skipped++;
      continue;
    }
    const tz = f.parent.timezone || APP.timezone;
    if (!opts.force && localHour(now, tz) < RISK_HOUR) {
      skipped++;
      continue;
    }
    const today = localDate(now, tz);
    const ed = await db().query<{ n: number }>("select n from editions where status = 'released' and date = $1 order by n desc limit 1", [today]);
    const editionN = ed.rows[0] ? Number(ed.rows[0].n) : null;
    if (editionN === null) {
      skipped++; // no edition today (a HOLD) — nothing is at risk
      continue;
    }

    for (const k of f.kids) {
      try {
        const doneToday = await db().query("select 1 from completions where kid_id = $1 and edition_n = $2 and complete", [k.id, editionN]);
        if (doneToday.rows.length) {
          skipped++;
          continue;
        }
        const streak = await liveStreak(String(k.id), tz, now);
        if (streak < 1) {
          skipped++; // no streak to lose; we don't invent pressure
          continue;
        }
        const link = kidLink(k, APP.url, editionN) ?? `${APP.url}/l/${editionN}`;
        const ins = await db().query<{ id: string }>(
          "insert into sends (edition_n, kid_id, parent_id, kind, to_emails) values ($1,$2,$3,'risk',$4) on conflict do nothing returning id",
          [editionN, k.id, f.parent.id, [f.parent.email]],
        );
        if (!ins.rows.length) {
          skipped++;
          continue;
        }
        try {
          const r = await sendMail(streakRiskMail({ to: [f.parent.email], kidName: k.name, feminine: !!k.feminine, streak, link }));
          sent++;
          if (r.id) await db().query("update sends set resend_id = $2 where id = $1", [ins.rows[0].id, r.id]);
        } catch (e) {
          errors.push(`risk ${k.id}: ${msg(e)}`);
          await db().query("delete from sends where id = $1", [ins.rows[0].id]).catch(() => {});
          skipped++;
        }
      } catch (e) {
        errors.push(`risk ${k.id}: ${msg(e)}`);
        skipped++;
      }
    }
  }

  await recordRun("streak-risk", errors.length === 0, { sent, skipped, errors }, startedAt);
  return { sent, skipped, errors };
}

/* ------------------------------------------------------------------ *
 * 4. Nightly
 * ------------------------------------------------------------------ */

/**
 * Housekeeping only (PRD §6.5, "Missed days"): anonymised off-topic prompts age out after 7 days,
 * expired assistant sessions are dropped. Streaks are derived from completions, so there is
 * deliberately nothing here that touches them — a missed day simply stops appearing in the walk-back.
 */
export async function nightly(now: Date = new Date()): Promise<{ purged: number; sessions: number; errors: string[] }> {
  const startedAt = now;
  const errors: string[] = [];
  let purged = 0;
  let sessions = 0;
  try {
    purged = await purgeOffPrompts();
  } catch (e) {
    errors.push(`purge_off_prompts: ${msg(e)}`);
  }
  try {
    const r = await db().query("delete from arto_sessions where expires_at < now()");
    sessions = r.rowCount;
  } catch (e) {
    errors.push(`arto_sessions: ${msg(e)}`);
  }
  await recordRun("nightly", errors.length === 0, { purged, sessions, errors }, startedAt);
  return { purged, sessions, errors };
}
