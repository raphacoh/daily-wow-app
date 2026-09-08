import { cronGuard, forced, json, testNow } from "../_auth";
import { hasDb } from "@/lib/db";
import { sendWeekly } from "@/lib/jobs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * The Sunday recap (PRD §6.4). Scheduled at 15:00 and 16:00 UTC on Sundays — 18:00 Jerusalem in summer
 * and in winter respectively. Each family is only mailed once its own clock passes 18:00, and the send
 * is idempotent per (parent, ISO week), so the second run adds nothing.
 */
async function run(req: Request) {
  const denied = cronGuard(req);
  if (denied) return denied;
  if (!hasDb()) return json({ error: "no_db" }, 503);
  const r = await sendWeekly(testNow(req) ?? new Date(), { force: forced(req) });
  return json(r);
}

export const GET = run;
export const POST = run;
