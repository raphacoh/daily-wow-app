import { NextResponse } from "next/server";
import { hasDb } from "@/lib/db";
import { body, editionNumber, guard } from "@/lib/adminAuth";
import { saveMenu, StageError } from "@/lib/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { "cache-control": "no-store" };

/**
 * POST /api/admin/menus/{n} — the morning topic-menu routine records the five candidates it offered,
 * and (later, from the builder) which one the editor picked.
 */
export async function POST(req: Request, ctx: { params: Promise<{ n: string }> }) {
  const denied = await guard(req);
  if (denied) return denied;
  if (!hasDb()) return NextResponse.json({ error: "no_db" }, { status: 503, headers: NO_STORE });
  const n = editionNumber((await ctx.params).n);
  if (n === null) return NextResponse.json({ error: "bad_edition" }, { status: 400, headers: NO_STORE });
  const b = await body(req);
  try {
    const menu = await saveMenu(n, {
      for_date: typeof b.for_date === "string" ? b.for_date : null,
      options: b.options ?? [],
      default_k: b.default_k === undefined || b.default_k === null ? null : Number(b.default_k),
      chosen: b.chosen === undefined || b.chosen === null ? null : String(b.chosen),
      chosen_title: typeof b.chosen_title === "string" ? b.chosen_title : null,
      decided_by: typeof b.decided_by === "string" ? b.decided_by : null,
    });
    return NextResponse.json({ menu }, { headers: NO_STORE });
  } catch (e) {
    if (e instanceof StageError) return NextResponse.json({ error: e.message }, { status: 400, headers: NO_STORE });
    throw e;
  }
}
