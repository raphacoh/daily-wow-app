import { NextResponse } from "next/server";
import { guard } from "@/lib/adminAuth";
import { hasDb } from "@/lib/db";
import { rebuildAllProgress } from "@/lib/gamification";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

/** POST /api/admin/rebuild-progress — replay roots/medals/cards/badges for every kid (after a rules change, or to repair). */
export async function POST(req: Request) {
  const denied = await guard(req);
  if (denied) return denied;
  if (!hasDb()) return NextResponse.json({ error: "no_db" }, { status: 503 });
  const kids = await rebuildAllProgress();
  return NextResponse.json({ ok: true, kids });
}
