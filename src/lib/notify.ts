/**
 * Notifications triggered by app events (completion notices). The daily/weekly sends live in jobs.ts.
 */
import { db } from "./db";
import { capNoticeMail, completionMail, sendMail } from "./emails";
import { APP } from "./config";
import type { CompletionResult, KidRow, ParentRow } from "./kids";

export async function queueCompletionNotice(kid: KidRow & { parent: ParentRow }, editionN: number, r: CompletionResult): Promise<void> {
  if (!r.ok || !(r.improved || r.first_time)) return;
  // only when the test is complete (a partial score is not a "✓")
  const c = await db().query<{ complete: boolean; score: number; max: number }>("select complete, score, max from completions where kid_id = $1 and edition_n = $2", [kid.id, editionN]);
  const row = c.rows[0];
  if (!row?.complete) return;
  const to: string[] = [];
  if (kid.parent.notify_completion) to.push(kid.parent.email);
  const extra = await db().query<{ email: string }>("select email from kid_contacts where kid_id = $1 and notify_completion", [kid.id]);
  extra.rows.forEach((x) => to.push(x.email));
  if (!to.length) return;
  // once per (kid, edition) — a better retry does not send a second notice
  const ins = await db().query("insert into sends (edition_n, kid_id, parent_id, kind, to_emails) values ($1,$2,$3,'completion',$4) on conflict do nothing returning id", [editionN, kid.id, kid.parent.id, to]);
  if (!ins.rows.length) return;
  const mail = completionMail({ to, kidName: kid.name, feminine: kid.feminine, editionN, score: row.score, max: row.max, streak: r.stats.streak, late: r.late, password: r.password });
  const sent = await sendMail(mail);
  if (sent.id) await db().query("update sends set resend_id = $2 where id = $1", [(ins.rows[0] as { id: string }).id, sent.id]);
}

/** The free assistant cap was reached today: tell the parent once per kid per day (never the kid). */
export async function notifyCapHit(kid: KidRow & { parent: ParentRow }, day: string, cap: number): Promise<void> {
  const ins = await db().query(
    "insert into sends (kid_id, parent_id, kind, week_key, to_emails) values ($1, $2, 'cap', $3, $4) on conflict do nothing returning id",
    [kid.id, kid.parent.id, day, [kid.parent.email]],
  );
  if (!ins.rows.length) return;
  const mail = capNoticeMail({ to: [kid.parent.email], kidName: kid.name, feminine: kid.feminine, cap, billingUrl: `${APP.url}/billing?kid=${kid.id}` });
  const sent = await sendMail(mail);
  if (sent.id) await db().query("update sends set resend_id = $2 where id = $1", [(ins.rows[0] as { id: string }).id, sent.id]);
}
