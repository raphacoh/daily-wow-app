/**
 * The editor's side of the house (PRD §6.6, §6.9): staging and releasing editions, the numbers the
 * /admin page shows, runtime config, and the small family-support queries.
 *
 * Everything here is server-only and assumes the caller is already authorised (an editor session or the
 * `EDITOR_API_KEY` bearer — see `adminAuth.ts`). Nothing in this module reads cookies or headers, which
 * keeps it unit-testable against PGlite.
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import { db } from "./db";
import { APP, invalidateConfigCache, getNumber } from "./config";
import {
  EDITIONS_DIR,
  decodePw,
  extractAssistantContext,
  extractTitle,
  getEdition,
  listEditions,
  pad3,
  type EditionFull,
  type EditionMeta,
} from "./editions";
import { kidLink, type KidRow } from "./kids";
import { extractEngineVersion, extractWowMeta } from "./wow-meta";
import { dailyMail, isEmailAddress, queueMail, sendMail, type KidDaily } from "./emails";
import { deleteFamily } from "./family";
import { msg, recordRun, sendDaily } from "./jobs";
import { localDate } from "./progress";

/* ------------------------------------------------------------------ *
 * Staging
 * ------------------------------------------------------------------ */

export interface StageInput {
  n: number;
  code?: string;
  /** Omit it for a queued draft: `releaseEdition` stamps the day the lesson actually goes out. */
  date?: string | null;
  title?: string;
  topics?: string[];
  summary?: string;
  teaser?: string;
  language?: string;
  password?: string;
  max_score?: number;
  reviewer_verdict?: string | null;
  review_url?: string | null;
  sources?: string | null;
  html: string;
}

export class StageError extends Error {
  constructor(
    message: string,
    public readonly problems: string[] = [],
  ) {
    super(message);
    this.name = "StageError";
  }
}

/**
 * The gate every edition passes before it can be staged. These are the things that silently break the
 * lesson if they are missing: the runtime bootstrap (the page would have no kid, no API), both content
 * tracks, the advanced layer, the challenge handler, and the fragment shape (a fragment, not a document —
 * `/l/N` wraps it itself, so a doctype here would nest two documents).
 */
export function validateFragment(html: string): string[] {
  const problems: string[] = [];
  const need: [string, string][] = [
    ["<title>", "חסר <title> בתחילת הפראגמנט"],
    ["RUNTIME", "חסר ה-runtime bootstrap (RUNTIME) — הגיליון לא ידע מי הילד/ה"],
    ['data-track="younger"', 'חסר מסלול younger (data-track="younger")'],
    ['data-track="older"', 'חסר מסלול older (data-track="older")'],
    ['data-level="advanced"', 'חסרה שכבת המתקדמים (data-level="advanced")'],
    ["checkChallenge", "חסר checkChallenge — פאנל האתגר לא מחובר"],
  ];
  for (const [needle, message] of need) if (!html.includes(needle)) problems.push(message);
  if (/<!doctype/i.test(html)) problems.push("זה מסמך שלם ולא פראגמנט (יש <!doctype>) — האפליקציה עוטפת בעצמה");
  return problems;
}

/** Strip the series prefix the builder puts in <title>: "שורשים וכנפיים #12 · הכותרת" → "הכותרת". */
export function stripTitlePrefix(title: string): string {
  return title.replace(/^\s*[^#]*#\s*\d+\s*[·•・|-]\s*/u, "").trim();
}

/**
 * Upsert edition N as `staged`. A staged or held row may be restaged (the builder reruns, the editor asks
 * for changes); a released row never is — editions the kids already got must not change under them.
 */
/** Extract the gamification declarations from a fragment; warnings are advice for the builder, never a rejection. */
export function gamificationOf(html: string): { wow_meta: unknown; engine_version: string | null; warnings: string[] } {
  const { meta, warnings } = extractWowMeta(html);
  const engine_version = extractEngineVersion(html);
  if (!engine_version) warnings.push("ENGINE_VERSION חסר — המנוע הזה קדם לאירועי הפריטים (כנפיים ועיטורי נדירות לא ייצברו)");
  return { wow_meta: meta, engine_version, warnings };
}

export async function stageEdition(input: StageInput): Promise<EditionFull & { warnings: string[] }> {
  const n = Number(input.n);
  if (!Number.isInteger(n) || n < 1) throw new StageError("מספר גיליון לא תקין");
  const html = String(input.html ?? "");
  const problems = validateFragment(html);
  if (problems.length) throw new StageError("הפראגמנט לא עבר את הבדיקות", problems);
  // A queued draft has no date: which day it goes out is decided at release, not at build time. A date may
  // still be given (a rebuild of something already dated, an import), and then it has to be a real one.
  const date = input.date == null || input.date === "" ? null : String(input.date);
  if (date !== null && !/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new StageError("תאריך לא תקין (YYYY-MM-DD)");

  const ctx = extractAssistantContext(html);
  const game = gamificationOf(html);
  const password = (input.password ?? "").trim() || decodePw(html);
  const title = (input.title ?? "").trim() || stripTitlePrefix(extractTitle(html));

  await db().tx(async (q) => {
    const cur = await q.query<{ status: string }>("select status from editions where n = $1", [n]);
    if (cur.rows[0]?.status === "released") throw new StageError(`גיליון #${n} כבר שוחרר — אי אפשר לדרוס אותו`);
    await q.query(
      `insert into editions
         (n, code, date, language, title, topics, summary, teaser, password, max_score, status,
          reviewer_verdict, review_url, sources, html, lesson_context, grading_context, wow_meta, engine_version, staged_at)
       values ($1,$2,$3,$4,$5,$6::text[],$7,$8,$9,$10,'staged',$11,$12,$13,$14,$15,$16,$17::jsonb,$18, now())
       on conflict (n) do update set
         code = excluded.code, date = excluded.date, language = excluded.language, title = excluded.title,
         topics = excluded.topics, summary = excluded.summary, teaser = excluded.teaser, password = excluded.password,
         max_score = excluded.max_score, status = 'staged', reviewer_verdict = excluded.reviewer_verdict,
         review_url = excluded.review_url, sources = excluded.sources, html = excluded.html,
         lesson_context = excluded.lesson_context, grading_context = excluded.grading_context,
         wow_meta = excluded.wow_meta, engine_version = excluded.engine_version,
         staged_at = now(), held_at = null, approved_at = null, revision_note = null`,
      [
        n,
        input.code?.trim() || `WOW-${pad3(n)}`,
        date,
        input.language?.trim() || "he",
        title,
        input.topics ?? [],
        input.summary ?? "",
        input.teaser ?? "",
        password,
        Number.isFinite(Number(input.max_score)) ? Number(input.max_score) : 11,
        input.reviewer_verdict ?? null,
        input.review_url ?? null,
        input.sources ?? null,
        html,
        ctx.lesson_context,
        ctx.grading_context,
        game.wow_meta == null ? null : JSON.stringify(game.wow_meta),
        game.engine_version,
      ],
    );
  });

  const row = await getEdition(n, { includeStaged: true });
  if (!row) throw new StageError("הגיליון לא נשמר");
  return { ...row, warnings: game.warnings };
}

/* ------------------------------------------------------------------ *
 * Release / hold / republish
 * ------------------------------------------------------------------ */

export interface ReleaseOptions {
  editor_note?: string | null;
  edited_by_editor?: boolean;
  /** `false` releases without mailing anyone (useful when the send is retried by hand). */
  send?: boolean;
}

export type SendResult = { sent: number; skipped: number; errors: string[] };

/**
 * staged|held → released, then hand over to the daily send. The release routine calls this after it has
 * pushed the content repo; the app owns the mailing from here on (PRD §2.3).
 */
export async function releaseEdition(n: number, opts: ReleaseOptions = {}): Promise<{ edition: EditionFull; send: SendResult | null }> {
  const r = await db().query<{ status: string }>("select status from editions where n = $1", [n]);
  const status = r.rows[0]?.status;
  if (!status) throw new StageError(`אין גיליון #${n}`);
  if (status === "released") throw new StageError(`גיליון #${n} כבר שוחרר`);

  await db().query(
    `update editions set status = 'released', released_at = coalesce(released_at, now()),
       date = coalesce(date, (now() at time zone $4)::date),
       editor_note = coalesce($2, editor_note), edited_by_editor = edited_by_editor or $3
     where n = $1`,
    [n, opts.editor_note ?? null, !!opts.edited_by_editor, APP.timezone],
  );

  const edition = await getEdition(n, { includeStaged: true });
  if (!edition) throw new StageError(`אין גיליון #${n}`);

  if (process.env.EDITIONS_WRITE_LOCAL === "1") await writeLocalEdition(edition);

  const send = opts.send === false ? null : await sendDaily(n);
  return { edition, send };
}

/* ------------------------------------------------------------------ *
 * The reviewed queue
 *
 * The builder works ahead into `staged` drafts; the editor approves at their own pace; the release job
 * takes the oldest `approved` edition each day. Nothing reaches a child that the editor has not seen,
 * and a night the builder fails is absorbed by the queue instead of becoming a missed day.
 * ------------------------------------------------------------------ */

/** The editor said yes. It joins the queue and goes out on its turn, oldest first. */
export async function approveEdition(n: number): Promise<EditionFull> {
  const r = await db().query<{ status: string }>("select status from editions where n = $1", [n]);
  const status = r.rows[0]?.status;
  if (!status) throw new StageError(`אין גיליון #${n}`);
  if (status === "released") throw new StageError(`גיליון #${n} כבר שוחרר`);

  await db().query(
    `update editions set status = 'approved', approved_at = now(), held_at = null, revision_note = null where n = $1`,
    [n],
  );
  const edition = await getEdition(n, { includeStaged: true });
  if (!edition) throw new StageError(`אין גיליון #${n}`);
  return edition;
}

/**
 * Sent back for changes. It leaves the queue and the note is kept on the row for the next builder run to
 * read, so "what I asked for" survives without a mail thread to parse.
 */
export async function requestChanges(n: number, note: string): Promise<EditionFull> {
  const text = String(note ?? "").trim().slice(0, 2000);
  if (!text) throw new StageError("צריך לכתוב מה לשנות");
  const r = await db().query(
    `update editions set status = 'held', held_at = now(), approved_at = null, revision_note = $2
      where n = $1 and status <> 'released' returning n`,
    [n, text],
  );
  if (!r.rows.length) throw new StageError(`אין גיליון #${n} שאפשר להחזיר`);
  const edition = await getEdition(n, { includeStaged: true });
  if (!edition) throw new StageError(`אין גיליון #${n}`);
  return edition;
}

export interface QueueState {
  /** approved and waiting, oldest first */
  ready: number[];
  /** built and waiting for the editor */
  drafts: number[];
  /** the next edition the release job would send, or null when the queue is empty */
  next: number | null;
}

/** What the release job will find, and what the queue warning is based on. */
export async function queueState(): Promise<QueueState> {
  const r = await db().query<{ n: number; status: string }>(
    "select n, status from editions where status in ('approved','staged') order by n asc",
  );
  const ready = r.rows.filter((x) => x.status === "approved").map((x) => Number(x.n));
  const drafts = r.rows.filter((x) => x.status === "staged").map((x) => Number(x.n));
  return { ready, drafts, next: ready[0] ?? null };
}

/** The editor's HOLD: the edition stays out of every mail and out of `/l/N` until it is released. */
export async function holdEdition(n: number): Promise<EditionFull> {
  const r = await db().query("update editions set status = 'held', held_at = now() where n = $1 returning n", [n]);
  if (!r.rows.length) throw new StageError(`אין גיליון #${n}`);
  const edition = await getEdition(n, { includeStaged: true });
  if (!edition) throw new StageError(`אין גיליון #${n}`);
  return edition;
}

/* ------------------------------------------------------------------ *
 * The daily release
 * ------------------------------------------------------------------ */

/** Warn the editor once the queue is down to this many approved editions. */
const QUEUE_LOW = 3;

export interface ReleaseRunResult {
  released: number | null;
  sent: number;
  skipped: number;
  ready: number;
  drafts: number;
  reason?: string;
  errors: string[];
}

/**
 * The 11:00 job: release the oldest approved edition, and nothing else.
 *
 * Only what the editor approved ever goes out, so an empty queue is a skipped day, not a lesson nobody
 * read first — and the editor is told, which is the part that was missing when the pipeline failed
 * silently overnight on 2026-09-11. Safe to run twice: the second run finds today's edition already
 * released and does nothing, and the warning mail is claimed once per day through `sends`.
 */
export async function releaseQueued(opts: { force?: boolean; now?: Date } = {}): Promise<ReleaseRunResult> {
  const now = opts.now ?? new Date();
  const startedAt = now;
  const errors: string[] = [];
  const today = localDate(now, APP.timezone);

  // already out today? then this is the second cron firing, or a manual release beat us to it
  const recent = await listEditions({ limit: 5 });
  const already = recent.find((e) => e.date && String(e.date).slice(0, 10) === today);
  if (already && !opts.force) {
    const q = await queueState();
    const out = { released: null, sent: 0, skipped: 0, ready: q.ready.length, drafts: q.drafts.length, reason: "already_released_today", errors };
    await recordRun("release", true, { ...out, edition_n: already.n }, startedAt);
    return out;
  }

  const queue = await queueState();
  if (queue.next === null) {
    await warnAboutQueue("empty", queue, today, errors);
    const out = { released: null, sent: 0, skipped: 0, ready: 0, drafts: queue.drafts.length, reason: "queue_empty", errors };
    await recordRun("release", false, out, startedAt);
    return out;
  }

  let sent = 0;
  let skipped = 0;
  try {
    const r = await releaseEdition(queue.next);
    sent = r.send?.sent ?? 0;
    skipped = r.send?.skipped ?? 0;
    if (r.send?.errors.length) errors.push(...r.send.errors);
  } catch (e) {
    errors.push(`release_${queue.next}: ${msg(e)}`);
    const out = { released: null, sent: 0, skipped: 0, ready: queue.ready.length, drafts: queue.drafts.length, reason: "release_failed", errors };
    await recordRun("release", false, out, startedAt);
    return out;
  }

  const after = await queueState();
  if (after.ready.length < QUEUE_LOW) await warnAboutQueue("low", after, today, errors);

  const out = { released: queue.next, sent, skipped, ready: after.ready.length, drafts: after.drafts.length, errors };
  await recordRun("release", errors.length === 0, out, startedAt);
  return out;
}

/** One warning a day, claimed through `sends` the way every other mail in this file is. */
async function warnAboutQueue(kind: "empty" | "low", queue: QueueState, today: string, errors: string[]): Promise<void> {
  const claim = await db().query<{ id: string }>(
    "insert into sends (kind, week_key, to_emails) values ('queue', $1, $2) on conflict do nothing returning id",
    [today, [APP.editorEmail]],
  );
  if (!claim.rows.length) return;
  try {
    const mail = queueMail({
      to: APP.editorEmail,
      kind,
      ready: queue.ready,
      drafts: queue.drafts,
      adminUrl: `${APP.url}/admin`,
    });
    const r = await sendMail(mail);
    await db().query("update sends set resend_id = $2 where id = $1", [claim.rows[0].id, r.id]);
  } catch (e) {
    errors.push(`queue_warning: ${msg(e)}`);
    await db().query("delete from sends where id = $1", [claim.rows[0].id]);
  }
}

/** Re-run the daily send for an edition that already went out (a bad link, a bounced batch). */
export async function republish(n: number): Promise<SendResult> {
  return sendDaily(n, { force: true });
}

/**
 * Mirror the edition into the local `editions/` content folder. Normally the release routine pushes the
 * content repo itself, so this only runs with EDITIONS_WRITE_LOCAL=1 (the seed, dev, and the migration).
 */
export async function writeLocalEdition(e: EditionFull): Promise<void> {
  // Resolved per call, not per import, so a script (or a test) can point it at another folder.
  const root = process.env.EDITIONS_DIR || EDITIONS_DIR;
  const dir = path.join(/*turbopackIgnore: true*/ root, "e", pad3(e.n));
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, "edition.html"), e.html, "utf8");
  const meta = {
    n: e.n,
    code: e.code,
    date: e.date,
    language: e.language,
    title: e.title,
    topics: e.topics,
    summary: e.summary,
    teaser: e.teaser,
    max_score: e.max_score,
    status: e.status,
    released_at: e.released_at,
    password: e.password,
    reviewer_verdict: e.reviewer_verdict ?? null,
    review_url: e.review_url ?? null,
    editor_note: e.editor_note,
  };
  await fs.writeFile(path.join(dir, "meta.json"), JSON.stringify(meta, null, 2) + "\n", "utf8");
  await upsertJsonList(path.join(root, "editions.json"), { n: e.n, date: e.date, title: e.title, path: `e/${pad3(e.n)}/` });
  await upsertJsonList(path.join(root, "topics.json"), { n: e.n, title: e.title, topics: e.topics });
}

async function upsertJsonList(file: string, entry: { n: number } & Record<string, unknown>): Promise<void> {
  let list: ({ n: number } & Record<string, unknown>)[] = [];
  try {
    const parsed = JSON.parse(await fs.readFile(file, "utf8"));
    if (Array.isArray(parsed)) list = parsed;
  } catch {
    /* first write */
  }
  const out = list.filter((x) => Number(x?.n) !== entry.n).concat(entry).sort((a, b) => Number(a.n) - Number(b.n));
  await fs.writeFile(file, JSON.stringify(out, null, 2) + "\n", "utf8");
}

/* ------------------------------------------------------------------ *
 * Lists and numbers for /admin
 * ------------------------------------------------------------------ */

export interface AdminEdition extends EditionMeta {
  staged_at: string | null;
  held_at: string | null;
  has_html: boolean;
  /** what the editor asked to be changed, kept for the next builder run */
  revision_note: string | null;
}

/** Every edition, every status, newest first. Never the html and never the password. */
export async function listAdminEditions(limit = 40): Promise<AdminEdition[]> {
  const r = await db().query<Record<string, unknown>>(
    `select n, code, date, language, title, topics, summary, teaser, max_score, status, reviewer_verdict,
            review_url, editor_note, edited_by_editor, released_at, staged_at, held_at, revision_note,
            (html is not null and html <> '') as has_html
       from editions order by n desc limit $1`,
    [Math.max(1, Math.min(500, limit))],
  );
  return r.rows.map((row) => ({
    n: Number(row.n),
    code: String(row.code),
    date: isoDate(row.date),
    language: String(row.language ?? "he"),
    title: String(row.title ?? ""),
    topics: (row.topics as string[]) ?? [],
    summary: String(row.summary ?? ""),
    teaser: String(row.teaser ?? ""),
    max_score: Number(row.max_score ?? 11),
    status: row.status as EditionMeta["status"],
    reviewer_verdict: (row.reviewer_verdict as string | null) ?? null,
    review_url: (row.review_url as string | null) ?? null,
    editor_note: (row.editor_note as string | null) ?? null,
    revision_note: (row.revision_note as string | null) ?? null,
    edited_by_editor: !!row.edited_by_editor,
    released_at: isoOrNull(row.released_at),
    staged_at: isoOrNull(row.staged_at),
    held_at: isoOrNull(row.held_at),
    has_html: !!row.has_html,
  }));
}

function isoDate(v: unknown): string {
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  return String(v ?? "").slice(0, 10);
}
function isoOrNull(v: unknown): string | null {
  if (!v) return null;
  return new Date(v as string).toISOString();
}

export interface ScopeAudit {
  edition_n: number;
  messages: number;
  off: number;
  pct: number;
  alert: boolean;
}

export interface AdminStats {
  families: number;
  kids: number;
  activeSubs: number;
  month: { label: string; messages: number; chat: number; grade: number; demo: number; input_tokens: number; output_tokens: number; cost: number };
  scope: ScopeAudit[];
  offPrompts: { edition_n: number | null; text: string; at: string }[];
  jobs: { id: string; job: string; started_at: string; finished_at: string | null; ok: boolean | null; detail: string | null }[];
  sends: { kind: string; edition_n: number | null; recipients: number; sent_at: string }[];
  alertPct: number;
}

/** Everything the admin page's cards need, in one round of queries. */
export async function adminStats(now = new Date()): Promise<AdminStats> {
  const q = db();
  const alertPct = await getNumber("off_topic_alert_pct");

  const [fam, kid, subs, month, scope, offs, jobs, sends] = await Promise.all([
    q.query<{ c: number }>("select count(*)::int as c from parents where deleted_at is null"),
    q.query<{ c: number }>("select count(*)::int as c from kids where deleted_at is null"),
    q.query<{ c: number }>("select count(*)::int as c from subscriptions where status = 'active'"),
    q.query<{ messages: number; chat: number; grade: number; demo: number; input_tokens: number; output_tokens: number; cost: string }>(
      `select count(*)::int as messages,
              count(*) filter (where kind = 'chat')::int as chat,
              count(*) filter (where kind = 'grade')::int as grade,
              count(*) filter (where kind = 'demo')::int as demo,
              coalesce(sum(input_tokens),0)::int as input_tokens,
              coalesce(sum(output_tokens),0)::int as output_tokens,
              coalesce(sum(cost_estimate),0)::text as cost
         from usage where created_at >= date_trunc('month', now())`,
    ),
    q.query<{ edition_n: number; messages: number; off: number }>(
      `select edition_n, count(*)::int as messages, count(*) filter (where scope = 'off')::int as off
         from usage
        where created_at > now() - interval '14 days' and edition_n is not null
        group by edition_n order by edition_n desc`,
    ),
    q.query<{ edition_n: number | null; off_prompt: string; created_at: string }>(
      "select edition_n, off_prompt, created_at from usage where off_prompt is not null order by created_at desc limit 20",
    ),
    q.query<{ id: string; job: string; started_at: string; finished_at: string | null; ok: boolean | null; detail: string | null }>(
      "select id, job, started_at, finished_at, ok, detail from job_runs order by started_at desc limit 20",
    ),
    q.query<{ kind: string; edition_n: number | null; to_emails: string[]; sent_at: string }>(
      "select kind, edition_n, to_emails, sent_at from sends order by sent_at desc limit 20",
    ),
  ]);

  const m = month.rows[0];
  return {
    families: fam.rows[0]?.c ?? 0,
    kids: kid.rows[0]?.c ?? 0,
    activeSubs: subs.rows[0]?.c ?? 0,
    month: {
      label: `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`,
      messages: m?.messages ?? 0,
      chat: m?.chat ?? 0,
      grade: m?.grade ?? 0,
      demo: m?.demo ?? 0,
      input_tokens: m?.input_tokens ?? 0,
      output_tokens: m?.output_tokens ?? 0,
      cost: Number(m?.cost ?? 0),
    },
    scope: scope.rows.map((s) => {
      const pct = s.messages ? Math.round((s.off / s.messages) * 1000) / 10 : 0;
      return { edition_n: Number(s.edition_n), messages: s.messages, off: s.off, pct, alert: pct > alertPct };
    }),
    offPrompts: offs.rows.map((o) => ({ edition_n: o.edition_n === null ? null : Number(o.edition_n), text: o.off_prompt, at: new Date(o.created_at).toISOString() })),
    jobs: jobs.rows.map((j) => ({ ...j, started_at: new Date(j.started_at).toISOString(), finished_at: j.finished_at ? new Date(j.finished_at).toISOString() : null })),
    sends: sends.rows.map((s) => ({ kind: s.kind, edition_n: s.edition_n === null ? null : Number(s.edition_n), recipients: (s.to_emails ?? []).length, sent_at: new Date(s.sent_at).toISOString() })),
    alertPct,
  };
}

/* ------------------------------------------------------------------ *
 * Config
 * ------------------------------------------------------------------ */

/** Write one runtime setting and drop the 60-second cache so the change is live immediately. */
export async function setConfig(key: string, value: string): Promise<void> {
  const k = String(key ?? "").trim();
  if (!k) throw new StageError("חסר מפתח");
  await db().query(
    "insert into app_config (key, value, updated_at) values ($1, $2, now()) on conflict (key) do update set value = excluded.value, updated_at = now()",
    [k, String(value ?? "")],
  );
  invalidateConfigCache();
}

/* ------------------------------------------------------------------ *
 * Families (support, not browsing)
 * ------------------------------------------------------------------ */

export interface AdminFamily {
  id: string;
  name: string;
  email: string;
  kids: number;
  created_at: string;
  is_editor: boolean;
}

export async function recentFamilies(limit = 20): Promise<AdminFamily[]> {
  const r = await db().query<{ id: string; name: string; email: string; kids: number; created_at: string; is_editor: boolean }>(
    `select p.id, p.name, p.email, p.is_editor, p.created_at,
            (select count(*)::int from kids k where k.parent_id = p.id and k.deleted_at is null) as kids
       from parents p where p.deleted_at is null
      order by p.created_at desc limit $1`,
    [Math.max(1, Math.min(200, limit))],
  );
  return r.rows.map((x) => ({ ...x, created_at: new Date(x.created_at).toISOString() }));
}

export interface FamilyDetail extends AdminFamily {
  children: { id: string; name: string; age: number; grade: string; level: string; paused: boolean; free_assistant_until: string | null; subscription: string | null; streak: number; xp: number }[];
}

/** Support lookup: one family by email, with just enough about the kids to answer a support mail. */
export async function findParentByEmail(email: string): Promise<FamilyDetail | null> {
  const e = String(email ?? "").trim().toLowerCase();
  if (!e) return null;
  const p = await db().query<{ id: string; name: string; email: string; is_editor: boolean; created_at: string }>(
    "select id, name, email, is_editor, created_at from parents where email = $1 and deleted_at is null",
    [e],
  );
  const parent = p.rows[0];
  if (!parent) return null;
  const kids = await db().query<{ id: string; name: string; age: number; grade: string; level: string; paused: boolean; free_assistant_until: string | null; subscription: string | null; streak: number; xp: number }>(
    `select k.id, k.name, k.age, k.grade, k.level::text as level, k.paused, k.free_assistant_until,
            (select s.status::text from subscriptions s where s.kid_id = k.id order by s.updated_at desc limit 1) as subscription,
            coalesce(st.streak, 0) as streak, coalesce(st.xp, 0) as xp
       from kids k left join kid_stats st on st.kid_id = k.id
      where k.parent_id = $1 and k.deleted_at is null order by k.created_at`,
    [parent.id],
  );
  return {
    ...parent,
    created_at: new Date(parent.created_at).toISOString(),
    kids: kids.rows.length,
    children: kids.rows.map((k) => ({ ...k, free_assistant_until: k.free_assistant_until ? new Date(k.free_assistant_until).toISOString() : null })),
  };
}

/** The editor's gift: ארטו on, for free, until a date (founding families, testers, "we owe you a month"). */
export async function grantFreeAssistant(kidId: string, untilISO: string): Promise<void> {
  const until = new Date(untilISO);
  if (Number.isNaN(until.getTime())) throw new StageError("תאריך לא תקין");
  const r = await db().query("update kids set free_assistant_until = $2 where id = $1 and deleted_at is null returning id", [kidId, until.toISOString()]);
  if (!r.rows.length) throw new StageError("אין ילד/ה כזה/כזאת");
}

/** Support edit: the parent's name and sign-in address. The address is what the daily mail and the magic link go to. */
export async function updateFamilyContact(parentId: string, patch: { name?: string; email?: string }): Promise<{ email: string }> {
  const cur = await db().query<{ id: string; email: string; name: string }>("select id, email, name from parents where id = $1 and deleted_at is null", [parentId]);
  if (!cur.rows.length) throw new StageError("אין משפחה כזאת");
  const name = patch.name === undefined ? cur.rows[0].name : patch.name.trim();
  const email = patch.email === undefined ? cur.rows[0].email : patch.email.trim().toLowerCase();
  if (!isEmailAddress(email)) throw new StageError("כתובת המייל לא תקינה");
  if (email !== cur.rows[0].email) {
    const taken = await db().query("select 1 from parents where email = $1 and id <> $2", [email, parentId]);
    if (taken.rows.length) throw new StageError("המייל הזה כבר שייך למשפחה אחרת");
  }
  await db().query("update parents set name = $2, email = $3 where id = $1", [parentId, name, email]);
  return { email };
}

/**
 * Support delete: the whole family, hard (kids, completions, contacts and claims cascade — see `deleteFamily`).
 * The editor's own account is refused. `confirmEmail` must match the family's address: the form asks the
 * editor to type it, so a stray click cannot remove a family.
 */
export async function deleteFamilyByAdmin(parentId: string, confirmEmail: string): Promise<{ email: string }> {
  const cur = await db().query<{ email: string; is_editor: boolean }>("select email, is_editor from parents where id = $1 and deleted_at is null", [parentId]);
  if (!cur.rows.length) throw new StageError("אין משפחה כזאת");
  const { email, is_editor } = cur.rows[0];
  if (is_editor) throw new StageError("אי אפשר למחוק את חשבון העורך מכאן");
  if (confirmEmail.trim().toLowerCase() !== email.toLowerCase()) throw new StageError("המייל שהוקלד לאישור לא תואם");
  await deleteFamily(parentId);
  return { email };
}

/* ------------------------------------------------------------------ *
 * Topic menus (written by the morning "topic menu" routine)
 * ------------------------------------------------------------------ */

export interface MenuInput {
  for_date?: string | null;
  options?: unknown;
  default_k?: number | null;
  chosen?: string | null;
  chosen_title?: string | null;
  decided_by?: string | null;
}

export interface MenuRow {
  n: number;
  for_date: string | null;
  options: unknown;
  default_k: number | null;
  chosen: string | null;
  chosen_title: string | null;
  decided_by: string | null;
  created_at: string;
}

export async function saveMenu(n: number, m: MenuInput): Promise<MenuRow> {
  if (!Number.isInteger(n) || n < 1) throw new StageError("מספר גיליון לא תקין");
  const r = await db().query<Record<string, unknown>>(
    `insert into menus (n, for_date, options, default_k, chosen, chosen_title, decided_by)
     values ($1, $2, $3::jsonb, $4, $5, $6, $7)
     on conflict (n) do update set
       for_date = coalesce(excluded.for_date, menus.for_date),
       options = case when excluded.options = '[]'::jsonb then menus.options else excluded.options end,
       default_k = coalesce(excluded.default_k, menus.default_k),
       chosen = coalesce(excluded.chosen, menus.chosen),
       chosen_title = coalesce(excluded.chosen_title, menus.chosen_title),
       decided_by = coalesce(excluded.decided_by, menus.decided_by)
     returning *`,
    [n, m.for_date ?? null, JSON.stringify(m.options ?? []), m.default_k ?? null, m.chosen ?? null, m.chosen_title ?? null, m.decided_by ?? null],
  );
  return menuRow(r.rows[0]);
}

export async function listMenus(limit = 10): Promise<MenuRow[]> {
  const r = await db().query<Record<string, unknown>>("select * from menus order by n desc limit $1", [Math.max(1, Math.min(100, limit))]);
  return r.rows.map(menuRow);
}

function menuRow(row: Record<string, unknown>): MenuRow {
  return {
    n: Number(row.n),
    for_date: row.for_date ? isoDate(row.for_date) : null,
    options: typeof row.options === "string" ? JSON.parse(row.options) : (row.options ?? []),
    default_k: row.default_k === null || row.default_k === undefined ? null : Number(row.default_k),
    chosen: (row.chosen as string | null) ?? null,
    chosen_title: (row.chosen_title as string | null) ?? null,
    decided_by: (row.decided_by as string | null) ?? null,
    created_at: new Date(row.created_at as string).toISOString(),
  };
}

/* ------------------------------------------------------------------ *
 * Topic ideas + history (what the builder reads)
 * ------------------------------------------------------------------ */

export interface TopicIdea {
  id: string;
  text: string;
  from: string;
  created_at: string;
}

/** Parents' unused ideas. First name only — the builder has no business knowing who wrote what. */
export async function listTopicIdeas(limit = 40): Promise<TopicIdea[]> {
  const r = await db().query<{ id: string; text: string; name: string | null; created_at: string }>(
    `select i.id, i.text, p.name, i.created_at
       from topic_ideas i left join parents p on p.id = i.parent_id
      where i.used_in_edition is null
      order by i.created_at desc limit $1`,
    [Math.max(1, Math.min(200, limit))],
  );
  return r.rows.map((x) => ({
    id: x.id,
    text: x.text,
    from: (x.name ?? "").trim().split(/\s+/)[0] ?? "",
    created_at: new Date(x.created_at).toISOString(),
  }));
}

/** The do-not-repeat list: every edition ever, title + topics only. */
export async function editionHistory(): Promise<{ n: number; date: string; title: string; topics: string[]; status: string }[]> {
  const r = await db().query<Record<string, unknown>>("select n, date, title, topics, status from editions order by n desc");
  return r.rows.map((row) => ({
    n: Number(row.n),
    date: isoDate(row.date),
    title: String(row.title ?? ""),
    topics: (row.topics as string[]) ?? [],
    status: String(row.status),
  }));
}

/* ------------------------------------------------------------------ *
 * "Send a test to me"
 * ------------------------------------------------------------------ */

/**
 * The daily mail for edition N, addressed to the editor alone. Uses the editor's own kids when they have
 * any (so the links are real and clickable), otherwise one demo row pointing at the public lesson URL.
 * Nobody else is mailed and no `sends` row is written — this is a preview, not a send.
 */
export async function sendTestDaily(n: number, parentEmail: string): Promise<{ ok: boolean; to: string; skipped?: string; error?: string }> {
  const to = String(parentEmail ?? "").trim();
  if (!to) return { ok: false, to: "", error: "אין כתובת" };
  const edition = await getEdition(n, { includeStaged: true });
  if (!edition) return { ok: false, to, error: `אין גיליון #${n}` };

  const parent = await db().query<{ id: string }>("select id from parents where lower(email) = lower($1) and deleted_at is null", [to]);
  let kids: KidDaily[] = [];
  if (parent.rows[0]) {
    const rows = await db().query<KidRow & { streak: number | null }>(
      `select k.*, st.streak from kids k left join kid_stats st on st.kid_id = k.id
        where k.parent_id = $1 and k.deleted_at is null order by k.created_at`,
      [parent.rows[0].id],
    );
    kids = rows.rows.map((k) => ({
      name: k.name,
      feminine: k.feminine,
      streak: Number(k.streak ?? 0),
      link: kidLink(k, APP.url, edition.n) ?? `${APP.url}/l/${edition.n}`,
    }));
  }
  if (!kids.length) kids = [{ name: APP.editorName, feminine: false, streak: 0, link: `${APP.url}/l/${edition.n}` }];

  const mail = dailyMail({
    to,
    editionN: edition.n,
    editionTitle: edition.title,
    editionDate: edition.date,
    teaser: edition.teaser || edition.summary,
    editorNote: edition.editor_note ?? undefined,
    kids,
  });
  mail.subject = `[בדיקה] ${mail.subject}`;
  try {
    const r = await sendMail(mail);
    return { ok: !r.skipped, to, skipped: r.skipped };
  } catch (e) {
    return { ok: false, to, error: e instanceof Error ? e.message : String(e) };
  }
}

/* ------------------------------------------------------------------ *
 * Gamification registries and readout (spec §9)
 * ------------------------------------------------------------------ */

export interface GamificationReadout {
  editions: { n: number; title: string; status: string; engine_version: string | null; has_meta: boolean; warnings: string[] }[];
  unmapped_topics: { topic: string; editions: number[] }[];
  skills: { slug: string; editions: number[]; name_he: string | null; canonical_slug: string | null }[];
  aliases: { topic: string; root: string }[];
  item_stats: { edition_n: number; item_id: string; n: number; first_try_correct: number; rate: number | null }[];
}

export async function gamificationReadout(): Promise<GamificationReadout> {
  const { rootForTopic } = await import("./roots");
  const al = await db().query<{ topic: string; root: string }>("select topic, root from root_aliases order by topic");
  const aliases = Object.fromEntries(al.rows.map((r) => [r.topic, r.root]));
  const reg = await db().query<{ slug: string; name_he: string | null; canonical_slug: string | null }>("select slug, name_he, canonical_slug from skills");
  const regBy = new Map(reg.rows.map((r) => [r.slug, r]));
  const eds = await db().query<{ n: number; title: string; status: string; topics: string[] | null; html: string; engine_version: string | null; wow_meta: { items?: Record<string, { skill?: string | null }> } | null }>(
    "select n, title, status, topics, html, engine_version, wow_meta from editions order by n desc limit 30",
  );
  const unmapped = new Map<string, number[]>();
  const skills = new Map<string, number[]>();
  const editions = eds.rows.map((e) => {
    for (const t of e.topics ?? []) if (!rootForTopic(t, aliases)) unmapped.set(t, [...(unmapped.get(t) ?? []), e.n]);
    for (const it of Object.values(e.wow_meta?.items ?? {})) if (it.skill) skills.set(it.skill, [...new Set([...(skills.get(it.skill) ?? []), e.n])]);
    return { n: e.n, title: e.title, status: e.status, engine_version: e.engine_version, has_meta: !!e.wow_meta, warnings: gamificationOf(e.html).warnings };
  });
  for (const r of reg.rows) if (!skills.has(r.slug)) skills.set(r.slug, []);
  const stats = await db().query<{ edition_n: number; item_id: string; n: number; first_try_correct: number }>(
    "select edition_n, item_id, n, first_try_correct from item_stats where edition_n in (select n from editions where status = 'released' order by date desc limit 7) order by edition_n desc, item_id",
  );
  return {
    editions,
    unmapped_topics: [...unmapped].map(([topic, ns]) => ({ topic, editions: ns })),
    skills: [...skills].map(([slug, ns]) => ({ slug, editions: ns, name_he: regBy.get(slug)?.name_he ?? null, canonical_slug: regBy.get(slug)?.canonical_slug ?? null })).sort((a, b) => a.slug.localeCompare(b.slug)),
    aliases: al.rows,
    item_stats: stats.rows.map((r) => ({ ...r, n: Number(r.n), first_try_correct: Number(r.first_try_correct), rate: Number(r.n) ? Math.round((100 * Number(r.first_try_correct)) / Number(r.n)) : null })),
  };
}

/** Map a topic word to a root (or clear it with root = ""). Applies on the next progress rebuild. */
export async function setRootAlias(topic: string, root: string): Promise<void> {
  const { ROOT_IDS, normTopic } = await import("./roots");
  const t = normTopic(topic);
  if (!t) throw new StageError("מילת נושא ריקה");
  if (!root) {
    await db().query("delete from root_aliases where topic = $1", [t]);
    return;
  }
  if (!(ROOT_IDS as readonly string[]).includes(root)) throw new StageError(`שורש לא מוכר: ${root}`);
  await db().query("insert into root_aliases (topic, root) values ($1,$2) on conflict (topic) do update set root = excluded.root", [t, root]);
}

/** Give a skill slug a Hebrew name and/or merge it into a canonical slug. */
export async function saveSkill(slug: string, nameHe: string, canonical: string): Promise<void> {
  const ok = /^[a-z][a-z0-9-]{1,40}$/;
  if (!ok.test(slug)) throw new StageError(`slug לא תקין: ${slug}`);
  if (canonical && (!ok.test(canonical) || canonical === slug)) throw new StageError(`slug קנוני לא תקין: ${canonical}`);
  await db().query(
    "insert into skills (slug, name_he, canonical_slug) values ($1,$2,$3) on conflict (slug) do update set name_he = excluded.name_he, canonical_slug = excluded.canonical_slug",
    [slug, nameHe.trim() || null, canonical || null],
  );
}
