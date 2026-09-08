import { NextResponse } from "next/server";
import { guard } from "@/lib/adminAuth";
import { hasDb } from "@/lib/db";
import { gamificationReadout } from "@/lib/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/admin/gamification — the editor's readout (spec §9): engine versions, WOW_META warnings, unmapped topics, skills, item stats. */
export async function GET(req: Request) {
  const denied = await guard(req);
  if (denied) return denied;
  if (!hasDb()) return NextResponse.json({ error: "no_db" }, { status: 503 });
  return NextResponse.json(await gamificationReadout(), { headers: { "cache-control": "no-store" } });
}
