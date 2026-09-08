import { NextResponse } from "next/server";
import { hasDb } from "@/lib/db";
import { editionNumber, guard } from "@/lib/adminAuth";
import { republish } from "@/lib/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { "cache-control": "no-store" };

/** POST /api/admin/editions/{n}/republish — re-run the daily send with force (a bad link, a lost batch). */
export async function POST(req: Request, ctx: { params: Promise<{ n: string }> }) {
  const denied = await guard(req);
  if (denied) return denied;
  if (!hasDb()) return NextResponse.json({ error: "no_db" }, { status: 503, headers: NO_STORE });
  const n = editionNumber((await ctx.params).n);
  if (n === null) return NextResponse.json({ error: "bad_edition" }, { status: 400, headers: NO_STORE });
  const send = await republish(n);
  return NextResponse.json({ send }, { headers: NO_STORE });
}
