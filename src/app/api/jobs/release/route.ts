import { cronGuard, forced, json, testNow } from "../_auth";
import { hasDb } from "@/lib/db";
import { releaseQueued } from "@/lib/admin";
import { dailySendGate } from "@/lib/jobs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// releasing runs the whole family mail loop inline, so it needs more room than the 60s default
export const maxDuration = 120;

/**
 * The daily release. Takes the oldest edition the editor approved and sends it to every family.
 *
 * Scheduled twice in UTC like every other job here, because Asia/Jerusalem is UTC+3 in summer and UTC+2
 * in winter and Vercel Cron has no timezone: the run that lands before `send_time` locally is a no-op and
 * the one after it releases. Running twice is safe anyway — the second run finds today's edition already
 * released and reports `already_released_today`.
 *
 * An empty queue is a skipped day, not a lesson nobody reviewed. The editor gets a mail saying so.
 * `?force=1` bypasses both the time gate and the already-released check.
 */
async function run(req: Request) {
  const denied = cronGuard(req);
  if (denied) return denied;
  if (!hasDb()) return json({ error: "no_db" }, 503);

  const now = testNow(req) ?? new Date();
  const force = forced(req);

  const gate = await dailySendGate(now);
  if (!gate.due && !force) {
    return json({ released: null, reason: "too_early", local_time: gate.local, send_time: gate.sendTime, timezone: gate.timezone });
  }

  return json(await releaseQueued({ force, now }));
}

export const GET = run;
export const POST = run;
