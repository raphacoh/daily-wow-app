/**
 * Test database: PGlite (Postgres in WASM) running the real migration. `setDb()` points the app at it.
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { pgliteDb, setDb, type Db } from "@/lib/db";

export async function freshDb(): Promise<{ db: Db; pg: PGlite }> {
  const pg = new PGlite();
  const sql = await fs.readFile(path.join(process.cwd(), "supabase/migrations/20260908000000_init.sql"), "utf8");
  await pg.exec(sql);
  const db = pgliteDb(pg as never);
  setDb(db);
  return { db, pg };
}

export async function seedParent(db: Db, o: { email?: string; name?: string; timezone?: string; id?: string; is_editor?: boolean } = {}) {
  const id = o.id ?? crypto.randomUUID();
  await db.query(
    "insert into parents (id, email, name, timezone, is_editor) values ($1,$2,$3,$4,$5)",
    [id, o.email ?? `p-${id.slice(0, 6)}@example.com`, o.name ?? "טסט", o.timezone ?? "Asia/Jerusalem", !!o.is_editor],
  );
  return id;
}

export async function seedEdition(db: Db, n: number, date: string, o: { status?: string; password?: string; title?: string; html?: string } = {}) {
  await db.query(
    `insert into editions (n, code, date, title, password, status, html, released_at) values ($1,$2,$3,$4,$5,$6::edition_status,$7, case when $6::text = 'released' then now() else null end)
     on conflict (n) do update set date = excluded.date, status = excluded.status`,
    [n, `WOW-${String(n).padStart(3, "0")}`, date, o.title ?? `גיליון ${n}`, o.password ?? `pw${n}`, o.status ?? "released", o.html ?? ""],
  );
}
