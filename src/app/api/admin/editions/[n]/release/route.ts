import { NextResponse } from "next/server";
import { hasDb } from "@/lib/db";
import { body, editionNumber, guard } from "@/lib/adminAuth";
import { releaseEdition, StageError } from "@/lib/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { "cache-control": "no-store" };

/**
 * POST /api/admin/editions/{n}/release — the 11:00 routine promotes the staged edition. From here the
 * APP owns the mailing: `send: false` releases quietly (the send is then run by hand or by the cron).
 */
export async function POST(req: Request, ctx: { params: Promise<{ n: string }> }) {
  const denied = await guard(req);
  if (denied) return denied;
  if (!hasDb()) return NextResponse.json({ error: "no_db" }, { status: 503, headers: NO_STORE });
  const n = editionNumber((await ctx.params).n);
  if (n === null) return NextResponse.json({ error: "bad_edition" }, { status: 400, headers: NO_STORE });
  const b = await body(req);
  try {
    const { edition, send } = await releaseEdition(n, {
      editor_note: typeof b.editor_note === "string" ? b.editor_note : null,
      edited_by_editor: !!b.edited_by_editor,
      send: b.send === false ? false : true,
    });
    const { html: _html, password: _pw, ...safe } = edition;
    void _html;
    void _pw;
    return NextResponse.json({ edition: safe, send }, { headers: NO_STORE });
  } catch (e) {
    if (e instanceof StageError) return NextResponse.json({ error: e.message, problems: e.problems }, { status: 409, headers: NO_STORE });
    throw e;
  }
}
