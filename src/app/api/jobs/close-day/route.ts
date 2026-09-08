import { cronGuard, json, testNow } from "../_auth";
import { hasDb } from "@/lib/db";
import { closeDay } from "@/lib/gamification";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * The daily close (gamification spec §8.4), 23:30 Asia/Jerusalem: community first-try statistics for the last two
 * editions, every kid's progress replayed, notices for badges the community's answers unlocked (rare success).
 */
async function run(req: Request) {
  const denied = cronGuard(req);
  if (denied) return denied;
  if (!hasDb()) return json({ error: "no_db" }, 503);
  return json(await closeDay(testNow(req) ?? new Date()));
}

export const GET = run;
export const POST = run;
