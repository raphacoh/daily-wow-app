import { NextResponse } from "next/server";
import { getEdition } from "@/lib/editions";
import { hasDb } from "@/lib/db";
import { guard } from "@/lib/adminAuth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/admin/editions/N/html — the edition's fragment, verbatim (staged or released). Editor only. */
export async function GET(req: Request, ctx: { params: Promise<{ n: string }> }) {
  const denied = await guard(req);
  if (denied) return denied;
  if (!hasDb()) return NextResponse.json({ error: "no_db" }, { status: 503 });
  const { n } = await ctx.params;
  const e = await getEdition(Number(n), { includeStaged: true });
  if (!e) return NextResponse.json({ error: "not_found" }, { status: 404 });
  return new NextResponse(e.html, { status: 200, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "x-edition-status": e.status } });
}
