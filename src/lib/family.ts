/**
 * Families: registration, the dashboard's data, settings. Server-side only.
 */
import { progressFor, type Progress } from "./gamification";
import { db, type Queryable } from "./db";
import { createKid, GRADES, kidLink, liveStreak, statsFor, type KidRow, type KidStats, type Level, type ParentRow, LEVELS_UI } from "./kids";
import { levelFor, localDate } from "./progress";
import { getNumber } from "./config";
import { listEditions, type EditionMeta } from "./editions";
import { isEntitled } from "./arto";
import { track } from "./analytics";

export interface KidInput {
  name: string;
  feminine: boolean;
  age: number;
  grade: string;
  level: Level;
  email?: string | null;
  extra?: { name: string; email: string } | null;
}

export interface RegistrationInput {
  parentName: string;
  email: string;
  consent: boolean;
  kids: KidInput[];
}

export type FieldError = { field: string; message: string };

export function validateRegistration(input: RegistrationInput, maxKids = 6): FieldError[] {
  const errs: FieldError[] = [];
  if (!input.parentName?.trim()) errs.push({ field: "parentName", message: "איך קוראים לכם?" });
  if (!isEmail(input.email)) errs.push({ field: "email", message: "כתובת מייל לא תקינה." });
  if (!input.consent) errs.push({ field: "consent", message: "צריך לאשר את תנאי הפרטיות." });
  if (!input.kids?.length) errs.push({ field: "kids", message: "לפחות ילד/ה אחד/ת." });
  if (input.kids?.length > maxKids) errs.push({ field: "kids", message: `עד ${maxKids} ילדים בחשבון אחד.` });
  input.kids?.forEach((k, i) => errs.push(...validateKid(k, `kids.${i}`)));
  return errs;
}

export function validateKid(k: KidInput, prefix = "kid"): FieldError[] {
  const errs: FieldError[] = [];
  if (!k.name?.trim()) errs.push({ field: `${prefix}.name`, message: "איך קוראים לילד/ה?" });
  if (typeof k.feminine !== "boolean") errs.push({ field: `${prefix}.feminine`, message: "בן או בת?" });
  if (!Number.isInteger(k.age) || k.age < 7 || k.age > 13) errs.push({ field: `${prefix}.age`, message: "גיל בין 7 ל-13." });
  if (!(GRADES as readonly string[]).includes(k.grade)) errs.push({ field: `${prefix}.grade`, message: "כיתה ב–ח." });
  if (!(k.level in LEVELS_UI) && k.level !== "on_track") errs.push({ field: `${prefix}.level`, message: "רמה לא מוכרת." });
  if (k.email && !isEmail(k.email)) errs.push({ field: `${prefix}.email`, message: "המייל של הילד/ה לא תקין." });
  if (k.extra && (k.extra.email || k.extra.name) && !isEmail(k.extra.email)) errs.push({ field: `${prefix}.extra`, message: "המייל של המבוגר הנוסף לא תקין." });
  return errs;
}

export function isEmail(s: unknown): s is string {
  return typeof s === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(s.trim());
}

/** Grade pre-filled from age (Israeli system: age 6 → א). */
export function gradeForAge(age: number): string {
  const i = Math.max(0, Math.min(GRADES.length - 1, age - 7));
  return GRADES[i];
}

export interface RegisteredKid {
  id: string;
  name: string;
  feminine: boolean;
  token: string;
}

/**
 * Create the family. `parentId` comes from Supabase Auth when the user already exists there, otherwise a
 * fresh uuid is used and the auth trigger later links by email (the parents row is keyed by auth uid on
 * Supabase; `registerFamily` is also used by the migration script and tests without auth).
 */
export async function registerFamily(input: RegistrationInput, opts: { parentId?: string } = {}): Promise<{ parentId: string; kids: RegisteredKid[]; existed: boolean }> {
  const email = input.email.trim().toLowerCase();
  return db().tx(async (q) => {
    const existing = await q.query<{ id: string; kids: number }>(
      "select p.id, (select count(*)::int from kids k where k.parent_id = p.id and k.deleted_at is null) as kids from parents p where p.email = $1 and p.deleted_at is null",
      [email],
    );
    let parentId: string;
    if (existing.rows[0]) {
      // the parent already exists (e.g. signed in with Google first): if it is them and they have no kids yet, finish the registration
      const mine = opts.parentId && opts.parentId === existing.rows[0].id;
      if (!mine || existing.rows[0].kids > 0) return { parentId: existing.rows[0].id, kids: [], existed: true };
      parentId = existing.rows[0].id;
      await q.query("update parents set name = case when name = '' then $2 else name end where id = $1", [parentId, input.parentName.trim()]);
    } else {
      parentId = opts.parentId ?? crypto.randomUUID();
      await q.query("insert into parents (id, email, name) values ($1, $2, $3)", [parentId, email, input.parentName.trim()]);
    }
    const kids: RegisteredKid[] = [];
    for (const k of input.kids) {
      const kidEmail = k.email && k.email.trim().toLowerCase() !== email ? k.email : null; // a kid email equal to the parent's is skipped
      const { id, token } = await createKid(parentId, { name: k.name, feminine: k.feminine, age: k.age, grade: k.grade, level: k.level, email: kidEmail }, q);
      if (k.extra?.email) {
        await q.query("insert into kid_contacts (kid_id, name, email, role) values ($1, $2, $3, 'relative')", [id, k.extra.name?.trim() ?? "", k.extra.email.trim().toLowerCase()]);
      }
      kids.push({ id, name: k.name.trim(), feminine: k.feminine, token });
    }
    return { parentId, kids, existed: false };
  }).then(async (r) => {
    if (!r.existed) await track("signup", { parent_id: r.parentId, props: { kids: r.kids.length } });
    return r;
  });
}

/* ---------- dashboard ---------- */

export interface DashboardKid {
  kid: KidRow;
  stats: KidStats;
  liveStreak: number;
  levelName: string;
  entitled: boolean;
  /** the free assistant cap was reached today (only meaningful when not entitled) */
  capHitToday: boolean;
  subscription: { status: string; current_period_end: string | null; cancel_at_period_end: boolean; provider_customer_id: string | null } | null;
  freeUntil: string | null;
  link: string | null; // the personal link for today's edition
  days: { date: string; done: boolean; late: boolean; score: number | null; n: number | null }[];
  contacts: { id: string; name: string; email: string; notify_daily: boolean; notify_completion: boolean }[];
  todayResult: { score: number; max: number; complete: boolean; late: boolean } | null;
  /** roots, medals, cards, badges, shields (gamification P0); null until the first completion */
  progress: Progress | null;
}

export interface Dashboard {
  parent: ParentRow;
  today: EditionMeta | null;
  todaySent: boolean;
  kids: DashboardKid[];
  history: { edition: EditionMeta; results: Record<string, { score: number; max: number; complete: boolean; late: boolean } | null>; password: string | null }[];
}

export async function dashboardFor(parent: ParentRow, appUrl: string, now = new Date()): Promise<Dashboard> {
  const q = db();
  const tz = parent.timezone || "Asia/Jerusalem";
  const today = localDate(now, tz);
  const editions = await listEditions({ limit: 60 });
  const todayEd = editions.find((e) => e.date === today) ?? editions[0] ?? null;
  const kidsRows = await q.query<KidRow>("select * from kids where parent_id = $1 and deleted_at is null order by created_at", [parent.id]);
  const ids = kidsRows.rows.map((k) => k.id);
  const comps = ids.length
    ? await q.query<{ kid_id: string; edition_n: number; score: number; max: number; complete: boolean; late: boolean }>(
        "select kid_id, edition_n, score, max, complete, late from completions where kid_id = any($1::uuid[])",
        [ids],
      )
    : { rows: [] as { kid_id: string; edition_n: number; score: number; max: number; complete: boolean; late: boolean }[] };
  const byKid = new Map<string, Map<number, (typeof comps.rows)[number]>>();
  for (const c of comps.rows) {
    if (!byKid.has(c.kid_id)) byKid.set(c.kid_id, new Map());
    byKid.get(c.kid_id)!.set(c.edition_n, c);
  }
  const subs = ids.length
    ? await q.query<{ kid_id: string; status: string; current_period_end: Date | null; cancel_at_period_end: boolean; provider_customer_id: string | null }>(
        "select distinct on (kid_id) kid_id, status, current_period_end, cancel_at_period_end, provider_customer_id from subscriptions where kid_id = any($1::uuid[]) order by kid_id, updated_at desc",
        [ids],
      )
    : { rows: [] as never[] };
  const contacts = ids.length
    ? await q.query<{ id: string; kid_id: string; name: string; email: string; notify_daily: boolean; notify_completion: boolean }>("select id, kid_id, name, email, notify_daily, notify_completion from kid_contacts where kid_id = any($1::uuid[])", [ids])
    : { rows: [] as never[] };
  const sent = todayEd ? await q.query("select 1 from sends where edition_n = $1 and parent_id = $2 and kind = 'daily'", [todayEd.n, parent.id]) : { rows: [] };

  const last14 = editions.filter((e) => e.date <= today).slice(0, 14).reverse();
  const kids: DashboardKid[] = [];
  for (const kid of kidsRows.rows) {
    const stats = await statsFor(kid.id);
    const live = await liveStreak(kid.id, tz, now);
    const mine = byKid.get(kid.id) ?? new Map();
    const sub = (subs.rows as { kid_id: string; status: string; current_period_end: Date | null; cancel_at_period_end: boolean; provider_customer_id: string | null }[]).find((s) => s.kid_id === kid.id) ?? null;
    const todayC = todayEd ? mine.get(todayEd.n) ?? null : null;
    kids.push({
      kid,
      stats: { ...stats, streak: live },
      liveStreak: live,
      levelName: levelFor(stats.xp, kid.feminine).name,
      entitled: await isEntitled(kid.id, now),
      capHitToday: ((await q.query<{ messages: number }>("select messages from arto_counters where key = $1 and day = $2", [kid.id, today])).rows[0]?.messages ?? 0) >= (await getNumber("free_messages_per_day")),
      subscription: sub ? { status: sub.status, current_period_end: sub.current_period_end ? new Date(sub.current_period_end).toISOString() : null, cancel_at_period_end: sub.cancel_at_period_end, provider_customer_id: sub.provider_customer_id } : null,
      freeUntil: kid.free_assistant_until ? new Date(kid.free_assistant_until).toISOString() : null,
      link: kidLink(kid, appUrl, todayEd ? todayEd.n : "today"),
      days: last14.map((e) => {
        const c = mine.get(e.n);
        return { date: e.date, n: e.n, done: !!c?.complete, late: !!c?.late, score: c ? c.score : null };
      }),
      contacts: (contacts.rows as { id: string; kid_id: string; name: string; email: string; notify_daily: boolean; notify_completion: boolean }[]).filter((c) => c.kid_id === kid.id),
      todayResult: todayC ? { score: todayC.score, max: todayC.max, complete: todayC.complete, late: todayC.late } : null,
      progress: await progressFor(kid.id),
    });
  }
  const history = editions.slice(0, 60).map((e) => ({
    edition: e,
    results: Object.fromEntries(kids.map((k) => [k.kid.id, (byKid.get(k.kid.id)?.get(e.n) && { ...byKid.get(k.kid.id)!.get(e.n)! }) ?? null])),
    password: null as string | null,
  }));
  // passwords of past editions are shown; today's only after a kid completed (or tap-to-reveal, client-side)
  const pw = await q.query<{ n: number; password: string }>("select n, password from editions where status = 'released' and n = any($1::int[])", [history.map((h) => h.edition.n)]);
  const pwMap = new Map(pw.rows.map((r) => [r.n, r.password]));
  for (const h of history) h.password = pwMap.get(h.edition.n) ?? null;
  return { parent, today: todayEd, todaySent: sent.rows.length > 0, kids, history };
}

export { kidLink, rotateKidToken } from "./kids";

/* ---------- settings ---------- */

export async function assertOwnsKid(parentId: string, kidId: string, q: Queryable = db()): Promise<KidRow> {
  const r = await q.query<KidRow>("select * from kids where id = $1 and parent_id = $2 and deleted_at is null", [kidId, parentId]);
  if (!r.rows[0]) throw new Error("not_your_kid");
  return r.rows[0];
}

export async function setKidLevel(parentId: string, kidId: string, level: Level): Promise<void> {
  if (!(level in LEVELS_UI) && level !== "on_track") throw new Error("bad_level");
  await assertOwnsKid(parentId, kidId);
  await db().query("update kids set level = $2 where id = $1", [kidId, level]);
}

export async function updateKid(parentId: string, kidId: string, patch: Partial<Pick<KidInput, "name" | "age" | "grade" | "email" | "feminine">> & { paused?: boolean }): Promise<void> {
  await assertOwnsKid(parentId, kidId);
  const sets: string[] = [];
  const vals: unknown[] = [kidId];
  const push = (col: string, v: unknown) => { vals.push(v); sets.push(`${col} = $${vals.length}`); };
  if (patch.name !== undefined) push("name", patch.name.trim());
  if (patch.age !== undefined) push("age", patch.age);
  if (patch.grade !== undefined) push("grade", patch.grade);
  if (patch.feminine !== undefined) push("feminine", patch.feminine);
  if (patch.email !== undefined) push("email", patch.email ? patch.email.trim().toLowerCase() : null);
  if (patch.paused !== undefined) push("paused", patch.paused);
  if (!sets.length) return;
  await db().query(`update kids set ${sets.join(", ")} where id = $1`, vals);
}

export async function removeKid(parentId: string, kidId: string): Promise<void> {
  await assertOwnsKid(parentId, kidId);
  await db().query("update kids set deleted_at = now(), paused = true where id = $1", [kidId]);
}

export async function addKid(parentId: string, k: KidInput): Promise<{ id: string; token: string }> {
  const max = await getNumber("max_kids_per_family");
  const count = await db().query("select count(*)::int as c from kids where parent_id = $1 and deleted_at is null", [parentId]);
  if (((count.rows[0] as { c: number }).c ?? 0) >= max) throw new Error("too_many_kids");
  const errs = validateKid(k);
  if (errs.length) throw new Error(errs[0].message);
  return createKid(parentId, { name: k.name, feminine: k.feminine, age: k.age, grade: k.grade, level: k.level, email: k.email ?? null });
}

export async function upsertContact(parentId: string, kidId: string, c: { id?: string; name: string; email: string; notify_daily?: boolean; notify_completion?: boolean }): Promise<void> {
  await assertOwnsKid(parentId, kidId);
  if (!isEmail(c.email)) throw new Error("bad_email");
  if (c.id) {
    await db().query("update kid_contacts set name = $3, email = $4, notify_daily = $5, notify_completion = $6 where id = $1 and kid_id = $2", [c.id, kidId, c.name.trim(), c.email.trim().toLowerCase(), c.notify_daily ?? true, c.notify_completion ?? true]);
  } else {
    await db().query("insert into kid_contacts (kid_id, name, email, notify_daily, notify_completion) values ($1,$2,$3,$4,$5)", [kidId, c.name.trim(), c.email.trim().toLowerCase(), c.notify_daily ?? true, c.notify_completion ?? true]);
  }
}

export async function removeContact(parentId: string, kidId: string, contactId: string): Promise<void> {
  await assertOwnsKid(parentId, kidId);
  await db().query("delete from kid_contacts where id = $1 and kid_id = $2", [contactId, kidId]);
}

export async function updateParent(parentId: string, patch: Partial<Pick<ParentRow, "name" | "notify_completion" | "notify_weekly" | "notify_streak_risk" | "keep_explanations" | "timezone">>): Promise<void> {
  const sets: string[] = [];
  const vals: unknown[] = [parentId];
  const push = (col: string, v: unknown) => { vals.push(v); sets.push(`${col} = $${vals.length}`); };
  if (patch.name !== undefined) push("name", patch.name.trim());
  if (patch.notify_completion !== undefined) push("notify_completion", patch.notify_completion);
  if (patch.notify_weekly !== undefined) push("notify_weekly", patch.notify_weekly);
  if (patch.notify_streak_risk !== undefined) push("notify_streak_risk", patch.notify_streak_risk);
  if (patch.keep_explanations !== undefined) push("keep_explanations", patch.keep_explanations);
  if (patch.timezone !== undefined) push("timezone", patch.timezone);
  if (!sets.length) return;
  await db().query(`update parents set ${sets.join(", ")} where id = $1`, vals);
}

export async function addTopicIdea(parentId: string, text: string): Promise<void> {
  const t = text.trim().slice(0, 500);
  if (!t) return;
  await db().query("insert into topic_ideas (parent_id, text) values ($1, $2)", [parentId, t]);
}

/** Everything we hold about a family, as JSON (PRD §10). */
export async function exportFamily(parentId: string): Promise<Record<string, unknown>> {
  const q = db();
  const parent = (await q.query("select id, email, name, locale, timezone, notify_completion, notify_weekly, notify_streak_risk, keep_explanations, created_at from parents where id = $1", [parentId])).rows[0];
  const kids = (await q.query("select id, name, feminine, age, grade, level, email, paused, free_assistant_until, created_at from kids where parent_id = $1 and deleted_at is null", [parentId])).rows;
  const ids = (kids as { id: string }[]).map((k) => k.id);
  const completions = ids.length ? (await q.query("select kid_id, edition_n, score, max, complete, late, challenge, xp_awarded, explanation, completed_at from completions where kid_id = any($1::uuid[]) order by edition_n", [ids])).rows : [];
  const stats = ids.length ? (await q.query("select * from kid_stats where kid_id = any($1::uuid[])", [ids])).rows : [];
  const contacts = ids.length ? (await q.query("select kid_id, name, email, role, notify_daily, notify_completion from kid_contacts where kid_id = any($1::uuid[])", [ids])).rows : [];
  const subscriptions = ids.length ? (await q.query("select kid_id, provider, status, current_period_end, created_at from subscriptions where kid_id = any($1::uuid[])", [ids])).rows : [];
  const usage = ids.length ? (await q.query("select kid_id, edition_n, kind, scope, created_at from usage where kid_id = any($1::uuid[]) order by created_at", [ids])).rows : [];
  return { exported_at: new Date().toISOString(), parent, kids, stats, completions, contacts, subscriptions, usage };
}

/** Hard delete of the family (kids, completions, contacts cascade). Usage rows are anonymised by the FK (`set null`). */
export async function deleteFamily(parentId: string): Promise<void> {
  await db().query("delete from parents where id = $1", [parentId]);
}
