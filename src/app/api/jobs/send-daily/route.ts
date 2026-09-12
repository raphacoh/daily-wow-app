import { cronGuard, forced, json, testNow } from "../_auth";
import { hasDb } from "@/lib/db";
import { APP } from "@/lib/config";
import { dailySendGate, reportNoEditionToday, sendDaily, todaysEdition } from "@/lib/jobs";
import { localDate } from "@/lib/progress";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * The daily send (PRD §6.4). Scheduled twice in UTC — 08:05 and 09:05 — because Asia/Jerusalem is
 * UTC+3 in summer and UTC+2 in winter and Vercel Cron has no timezone. The **send-time gate** below
 * makes exactly one of those runs do the work: it refuses to send before `send_time` (config, default
 * 11:05) measured in APP.timezone, so the winter-schedule run at 08:05 UTC (10:05 local) is a no-op
 * and the 09:05 one sends. `?force=1` bypasses the gate for the admin's "send now".
 *
 * `?n=` picks an edition explicitly; otherwise it is the released edition dated today in the editor's
 * timezone. If there is none — a HOLD day, or a nightly build that never finished — the job sends
 * nothing, records a `no-edition` run and mails the editor once for that date (`reportNoEditionToday`).
 */
async function run(req: Request) {
  const denied = cronGuard(req);
  if (denied) return denied;
  if (!hasDb()) return json({ error: "no_db" }, 503);

  const url = new URL(req.url);
  const now = testNow(req) ?? new Date();
  const force = forced(req);

  const gate = await dailySendGate(now);
  if (!gate.due && !force) {
    return json({ sent: 0, skipped: 0, reason: "too_early", local_time: gate.local, send_time: gate.sendTime, timezone: gate.timezone });
  }

  const nParam = url.searchParams.get("n");
  let n: number | null = null;
  if (nParam !== null) {
    n = Number(nParam);
    if (!Number.isInteger(n) || n < 1) return json({ error: "bad_n" }, 400);
  } else {
    n = await todaysEdition(now);
  }
  if (n === null) {
    // Nobody is watching the cron's JSON. A day with no lesson has to reach a human, or it looks
    // exactly like a quiet morning until a kid asks where their lesson is.
    const today = localDate(now, APP.timezone);
    const { notified } = await reportNoEditionToday(now, today, gate.local);
    return json({ sent: 0, reason: "no_edition_today", date: today, local_time: gate.local, timezone: gate.timezone, editor_notified: notified });
  }

  const r = await sendDaily(n, { force, now });
  return json({ edition_n: n, ...r });
}

export const GET = run;
export const POST = run;
