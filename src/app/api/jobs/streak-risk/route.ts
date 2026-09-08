import { cronGuard, forced, json, testNow } from "../_auth";
import { hasDb } from "@/lib/db";
import { sendStreakRisk } from "@/lib/jobs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * The 19:00 nudge (PRD §6.4, opt-in). Scheduled at 16:00 and 17:00 UTC — 19:00 Jerusalem in summer and
 * in winter. Families are gated on their own 19:00 and the send is idempotent per (edition, kid).
 */
async function run(req: Request) {
  const denied = cronGuard(req);
  if (denied) return denied;
  if (!hasDb()) return json({ error: "no_db" }, 503);
  const r = await sendStreakRisk(testNow(req) ?? new Date(), { force: forced(req) });
  return json(r);
}

export const GET = run;
export const POST = run;
