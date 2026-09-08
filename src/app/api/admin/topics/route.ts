import { NextResponse } from "next/server";
import { hasDb } from "@/lib/db";
import { guard } from "@/lib/adminAuth";
import { listTopicIdeas } from "@/lib/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { "cache-control": "no-store" };

/**
 * GET /api/admin/topics — the parents' topic ideas that no edition has used yet. First names only:
 * the pipeline never needs to know which family suggested what.
 */
export async function GET(req: Request) {
  const denied = await guard(req);
  if (denied) return denied;
  if (!hasDb()) return NextResponse.json({ error: "no_db" }, { status: 503, headers: NO_STORE });
  const limit = Number(new URL(req.url).searchParams.get("limit") ?? 40);
  const ideas = await listTopicIdeas(Number.isFinite(limit) ? limit : 40);
  return NextResponse.json({ ideas }, { headers: NO_STORE });
}
