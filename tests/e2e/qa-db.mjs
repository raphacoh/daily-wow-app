/** QA helper: read-only-ish psql access to production for the cap-to-pay QA run. Delete after the run. */
import pg from "pg";
import fs from "node:fs";
const SP = process.env.QA_SCRATCH || "/private/tmp/claude-501/-Users-rapha-arto/bd8d891f-c4e7-4410-bbd0-5e2787e48852/scratchpad";
const env = Object.fromEntries(
  fs.readFileSync(SP + "/supabase-db.env", "utf8").split("\n").filter(Boolean).map((l) => {
    const i = l.indexOf("=");
    return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
  }),
);
const url = `postgresql://postgres.gvwzpfoqeheciteetewv:${encodeURIComponent(env.DB_PASSWORD)}@${env.POOLER_HOST}:6543/postgres`;
export async function q(sql, params = []) {
  const c = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
  await c.connect();
  try {
    const r = await c.query(sql, params);
    return r.rows;
  } finally {
    await c.end();
  }
}
if (process.argv[2]) console.log(JSON.stringify(await q(process.argv[2], process.argv.slice(3)), null, 2));
