import { NextResponse } from "next/server";
import { isEditorApiKey, requireEditor } from "@/lib/auth";
import { hasDb } from "@/lib/db";
import { latestReleased } from "@/lib/editions";
import { sendTestDaily } from "@/lib/admin";
import { APP } from "@/lib/config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** POST /api/admin/test-email { n?, to? } — send the daily email for edition n to the editor (or `to`). Editor only. */
export async function POST(req: Request) {
  let allowed = isEditorApiKey(req.headers.get("authorization"));
  if (!allowed) {
    try {
      await requireEditor();
      allowed = true;
    } catch {
      allowed = false;
    }
  }
  if (!allowed) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!hasDb()) return NextResponse.json({ error: "no_db" }, { status: 503 });
  let b: { n?: number; to?: string } = {};
  try {
    b = await req.json();
  } catch {
    /* empty */
  }
  const n = Number.isInteger(b.n) ? Number(b.n) : (await latestReleased())?.n;
  if (!n) return NextResponse.json({ error: "no_edition" }, { status: 404 });
  const to = typeof b.to === "string" && b.to.includes("@") ? b.to : APP.editorEmail;
  const r = await sendTestDaily(n, to);
  return NextResponse.json({ ok: true, n, to, result: r });
}
