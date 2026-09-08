import { NextResponse } from "next/server";
import { hasDb } from "@/lib/db";
import { editionNumber, guard } from "@/lib/adminAuth";
import { holdEdition, StageError } from "@/lib/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { "cache-control": "no-store" };

/** POST /api/admin/editions/{n}/hold — the editor's HOLD. Nothing goes out until it is released. */
export async function POST(req: Request, ctx: { params: Promise<{ n: string }> }) {
  const denied = await guard(req);
  if (denied) return denied;
  if (!hasDb()) return NextResponse.json({ error: "no_db" }, { status: 503, headers: NO_STORE });
  const n = editionNumber((await ctx.params).n);
  if (n === null) return NextResponse.json({ error: "bad_edition" }, { status: 400, headers: NO_STORE });
  try {
    const edition = await holdEdition(n);
    const { html: _html, password: _pw, ...safe } = edition;
    void _html;
    void _pw;
    return NextResponse.json({ edition: safe }, { headers: NO_STORE });
  } catch (e) {
    if (e instanceof StageError) return NextResponse.json({ error: e.message }, { status: 409, headers: NO_STORE });
    throw e;
  }
}
