/**
 * Importers: editions from the local content folder into the database, and families from a JSON manifest
 * (the M1 migration of the founding families). Both are idempotent.
 */
import { db } from "./db";
import { extractAssistantContext, listLocalEditions, loadLocalEdition } from "./editions";
import { registerFamily, type RegistrationInput } from "./family";
import { rebuildStats } from "./kids";

export async function importLocalEditions(opts: { release?: boolean } = {}): Promise<{ imported: number[] }> {
  const list = await listLocalEditions();
  const imported: number[] = [];
  for (const m of list) {
    const e = await loadLocalEdition(m.n);
    if (!e) continue;
    const ctx = extractAssistantContext(e.html);
    const status = opts.release === false ? "staged" : e.status;
    await db().query(
      `insert into editions (n, code, date, language, title, topics, summary, teaser, password, max_score, status, reviewer_verdict, review_url, html, lesson_context, grading_context, released_at)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::edition_status,$12,$13,$14,$15,$16, case when $11::text = 'released' then coalesce($17::timestamptz, now()) else null end)
       on conflict (n) do update set title = excluded.title, topics = excluded.topics, summary = excluded.summary, teaser = excluded.teaser, html = excluded.html,
         lesson_context = excluded.lesson_context, grading_context = excluded.grading_context, password = excluded.password`,
      [e.n, e.code, e.date, e.language, e.title, e.topics, e.summary, e.teaser, e.password, e.max_score, status, e.reviewer_verdict ?? null, e.review_url ?? null, e.html, ctx.lesson_context, ctx.grading_context, e.released_at],
    );
    imported.push(e.n);
  }
  return { imported };
}

export interface FamilyManifest {
  families: (RegistrationInput & {
    is_editor?: boolean;
    timezone?: string;
    /** historical completions to carry over: [{ kid: <kid name>, edition_n, score, max, complete, late, completed_at }] */
    history?: { kid: string; edition_n: number; score: number; max: number; complete: boolean; late?: boolean; completed_at?: string }[];
    /** free assistant grant for every kid, ISO date */
    free_assistant_until?: string;
  })[];
}

export async function importFamilies(manifest: FamilyManifest): Promise<{ created: { email: string; kids: { name: string; link: string }[] }[]; existed: string[] }> {
  const created: { email: string; kids: { name: string; link: string }[] }[] = [];
  const existed: string[] = [];
  for (const f of manifest.families) {
    const r = await registerFamily({ parentName: f.parentName, email: f.email, consent: true, kids: f.kids });
    if (r.existed) {
      existed.push(f.email);
      continue;
    }
    if (f.is_editor || f.timezone) {
      await db().query("update parents set is_editor = coalesce($2, is_editor), timezone = coalesce($3, timezone) where id = $1", [r.parentId, f.is_editor ?? null, f.timezone ?? null]);
    }
    if (f.free_assistant_until) {
      await db().query("update kids set free_assistant_until = $2 where parent_id = $1", [r.parentId, f.free_assistant_until]);
    }
    for (const h of f.history ?? []) {
      const kid = r.kids.find((k) => k.name === h.kid);
      if (!kid) continue;
      await db().query(
        `insert into completions (kid_id, edition_n, score, max, complete, late, xp_awarded, completed_at)
         values ($1,$2,$3,$4,$5,$6,$7, coalesce($8::timestamptz, now())) on conflict (kid_id, edition_n) do nothing`,
        [kid.id, h.edition_n, h.score, h.max, h.complete, !!h.late, h.score * 10 + (h.complete ? 20 : 0) + (h.complete && !h.late ? 5 : 0), h.completed_at ?? null],
      );
    }
    for (const kid of r.kids) await rebuildStats(kid.id, f.timezone ?? "Asia/Jerusalem");
    created.push({ email: f.email, kids: r.kids.map((k) => ({ name: k.name, link: `/l/today?k=${encodeURIComponent(k.token)}` })) });
  }
  return { created, existed };
}
