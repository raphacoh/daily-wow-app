import { NextResponse } from "next/server";
import { hasDb } from "@/lib/db";
import { guard } from "@/lib/adminAuth";
import { listMenus } from "@/lib/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { "cache-control": "no-store" };

/** GET /api/admin/menus?limit=10 — recent topic menus (what was offered, what was chosen). */
export async function GET(req: Request) {
  const denied = await guard(req);
  if (denied) return denied;
  if (!hasDb()) return NextResponse.json({ error: "no_db" }, { status: 503, headers: NO_STORE });
  const limit = Number(new URL(req.url).searchParams.get("limit") ?? 10);
  const menus = await listMenus(Number.isFinite(limit) ? limit : 10);
  return NextResponse.json({ menus }, { headers: NO_STORE });
}
