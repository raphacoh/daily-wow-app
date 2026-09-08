import { NextResponse } from "next/server";
import { isEditorApiKey, requireEditor } from "@/lib/auth";
import { hasDb } from "@/lib/db";
import { importFamilies, importLocalEditions, type FamilyManifest } from "@/lib/importer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/admin/import  { editions?: true, families?: FamilyManifest }
 * Editor-only (bearer EDITOR_API_KEY or a signed-in editor). Imports the local editions folder and/or a
 * family manifest (the founding families' migration). Idempotent.
 */
export async function POST(req: Request) {
  if (!hasDb()) return NextResponse.json({ error: "no_db" }, { status: 503 });
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
  let body: { editions?: boolean; families?: FamilyManifest } = {};
  try {
    body = await req.json();
  } catch {
    /* empty */
  }
  const out: Record<string, unknown> = {};
  const del = (body as { delete_families?: string[] }).delete_families;
  if (Array.isArray(del) && del.length) {
    const { db } = await import("@/lib/db");
    const { deleteFamily } = await import("@/lib/family");
    const deleted: string[] = [];
    for (const email of del) {
      const r = await db().query<{ id: string }>("select id from parents where email = $1", [String(email).toLowerCase()]);
      if (r.rows[0]) { await deleteFamily(r.rows[0].id); deleted.push(email); }
    }
    out.deleted = deleted;
  }
  if (body.editions) out.editions = await importLocalEditions();
  if (body.families?.families?.length) out.families = await importFamilies(body.families);
  return NextResponse.json(out);
}
