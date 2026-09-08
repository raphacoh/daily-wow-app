/**
 * Postgres access. Production: `pg` against DATABASE_URL (Supabase pooler, transaction mode).
 * Tests: PGlite in-process (same SQL) via `setDb(...)`.
 * The interface is deliberately tiny — `query(text, params)` and `tx(fn)` — so both fit.
 */
import type { Pool as PgPool } from "pg";

export type Row = Record<string, unknown>;
export interface Queryable {
  query<T extends object = Row>(text: string, params?: unknown[]): Promise<{ rows: T[]; rowCount: number }>;
}
export interface Db extends Queryable {
  tx<T>(fn: (q: Queryable) => Promise<T>): Promise<T>;
}

let current: Db | null = null;

export function setDb(db: Db | null) {
  current = db;
}

export function hasDb(): boolean {
  return !!current || !!process.env.DATABASE_URL;
}

export function db(): Db {
  if (current) return current;
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new DbNotConfigured();
  }
  // `pglite://./.pglite` = an embedded Postgres in a local folder: the whole app runs without Docker or a
  // Supabase project (dev, demos, tests). Anything else is a real Postgres connection string.
  current = url.startsWith("pglite:") ? pgliteFileDb(url.replace(/^pglite:\/\/?/, "")) : pgDb(url);
  return current;
}

function pgliteFileDb(dir: string): Db {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { PGlite } = require("@electric-sql/pglite") as typeof import("@electric-sql/pglite");
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const fs = require("node:fs") as typeof import("node:fs");
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const path = require("node:path") as typeof import("node:path");
  const pg = new PGlite(dir || "./.pglite");
  const base = pgliteDb(pg as never);
  // an embedded database initialises itself: the migrations are idempotent SQL
  const ready: Promise<void> = (async () => {
    const mdir = path.join(process.cwd(), "supabase/migrations");
    const files = fs.existsSync(mdir) ? fs.readdirSync(mdir).filter((f) => f.endsWith(".sql")).sort() : [];
    for (const f of files) await pg.exec(fs.readFileSync(path.join(mdir, f), "utf8"));
  })();
  // serialise transactions: PGlite is single-connection
  let chain: Promise<unknown> = ready;
  return {
    async query(text, params) {
      await ready;
      return base.query(text, params);
    },
    tx<T>(fn: (q: Queryable) => Promise<T>): Promise<T> {
      const run = chain.then(() => base.tx(fn));
      chain = run.catch(() => {});
      return run;
    },
  };
}

export class DbNotConfigured extends Error {
  constructor() {
    super("DATABASE_URL is not set");
    this.name = "DbNotConfigured";
  }
}

function pgDb(url: string): Db {
  // Lazy require keeps `pg` out of the client bundle and lets tests run without it.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { Pool } = require("pg") as typeof import("pg");
  // Supabase's pooler presents a certificate from Supabase's own CA. `pg` treats `sslmode=require` as
  // verify-full, so a pasted "…?sslmode=require" string fails with "self-signed certificate in chain".
  // Strip the flag and decide SSL ourselves: encrypted, without CA verification, for Supabase hosts.
  const u = new URL(url);
  const wantsSsl = /supabase\.co|pooler\.supabase/.test(u.hostname) || u.searchParams.has("sslmode");
  u.searchParams.delete("sslmode");
  const pool: PgPool = new Pool({
    connectionString: u.toString(),
    max: 4,
    ssl: wantsSsl ? { rejectUnauthorized: false } : undefined,
  });
  const q = (client: { query: PgPool["query"] }): Queryable => ({
    async query(text, params) {
      const r = await client.query(text, params as never[]);
      return { rows: r.rows as never, rowCount: r.rowCount ?? r.rows.length };
    },
  });
  return {
    query: (text, params) => q(pool).query(text, params),
    async tx(fn) {
      const client = await pool.connect();
      try {
        await client.query("begin");
        const out = await fn(q(client));
        await client.query("commit");
        return out;
      } catch (e) {
        await client.query("rollback").catch(() => {});
        throw e;
      } finally {
        client.release();
      }
    },
  };
}

/** Wrap a PGlite instance (tests, or a local file store) in the same interface. */
export function pgliteDb(pg: {
  query: (text: string, params?: unknown[]) => Promise<{ rows: unknown[]; affectedRows?: number }>;
  transaction: <T>(fn: (t: { query: (text: string, params?: unknown[]) => Promise<{ rows: unknown[]; affectedRows?: number }> }) => Promise<T>) => Promise<T>;
}): Db {
  const wrap = (c: { query: typeof pg.query }): Queryable => ({
    async query(text, params) {
      const r = await c.query(text, params);
      return { rows: r.rows as never, rowCount: r.affectedRows ?? r.rows.length };
    },
  });
  return {
    query: (text, params) => wrap(pg).query(text, params),
    tx: (fn) => pg.transaction((t) => fn(wrap(t))),
  };
}
