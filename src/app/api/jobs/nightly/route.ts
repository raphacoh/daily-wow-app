import { cronGuard, json, testNow } from "../_auth";
import { hasDb } from "@/lib/db";
import { nightly } from "@/lib/jobs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Nightly housekeeping at 01:00 UTC: purge off-topic prompts older than 7 days, drop expired assistant
 * sessions. It never touches streaks — those are derived from completions (PRD §6.5).
 */
async function run(req: Request) {
  const denied = cronGuard(req);
  if (denied) return denied;
  if (!hasDb()) return json({ error: "no_db" }, 503);
  const r = await nightly(testNow(req) ?? new Date());
  return json(r);
}

export const GET = run;
export const POST = run;
