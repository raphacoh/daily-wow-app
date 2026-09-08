import { NextResponse } from "next/server";
import { promises as fs } from "node:fs";
import path from "node:path";
import { db, hasDb } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** POST /api/dev/migrate — development only: apply supabase/migrations/*.sql to the configured database (idempotent SQL). */
export async function POST() {
  if (process.env.NODE_ENV === "production" || process.env.DEV_SEED !== "1") return NextResponse.json({ error: "not_found" }, { status: 404 });
  if (!hasDb()) return NextResponse.json({ error: "no_db" }, { status: 503 });
  const dir = path.join(process.cwd(), "supabase/migrations");
  const files = (await fs.readdir(dir)).filter((f) => f.endsWith(".sql")).sort();
  for (const f of files) {
    const sql = await fs.readFile(path.join(dir, f), "utf8");
    await db().query(sql);
  }
  return NextResponse.json({ applied: files });
}
