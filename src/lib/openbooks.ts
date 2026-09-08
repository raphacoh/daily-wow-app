/**
 * Open books (PRD §5.6, principle §1.2.3): the monthly numbers behind the app, computed from the app's
 * own tables — nothing is typed in by hand except the two figures a machine cannot know (what building
 * the editions cost, and the real income), which the editor puts in the `open_books` table.
 *
 * With no database configured the page still renders: one row of zeros for the current month.
 */
import { db, hasDb } from "./db";
import { APP } from "./config";

export interface OpenBooksRow {
  /** `YYYY-MM` */
  month: string;
  families: number;
  kids: number;
  subs: number;
  /** ILS, from the app's own usage counters. */
  token_cost: number;
  /** ILS, editor-entered. */
  build_cost: number;
  /** ILS, editor-entered; defaults to subscriptions × the monthly price. */
  income: number;
  /** income − token cost − build cost. */
  difference: number;
  note: string;
}

/** Anthropic bills in dollars; the page speaks shekels. */
export function usdIls(): number {
  const v = Number(process.env.USD_ILS);
  return Number.isFinite(v) && v > 0 ? v : 3.7;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

function monthKey(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

function monthStart(key: string): Date {
  return new Date(`${key}-01T00:00:00.000Z`);
}

function nextMonthKey(key: string): string {
  const s = monthStart(key);
  return monthKey(new Date(Date.UTC(s.getUTCFullYear(), s.getUTCMonth() + 1, 1)));
}

function zeroRow(month: string): OpenBooksRow {
  return { month, families: 0, kids: 0, subs: 0, token_cost: 0, build_cost: 0, income: 0, difference: 0, note: "" };
}

/**
 * One row per month since the first parent registered (at least the current month), newest first.
 * Cheap: a handful of months, four counters each.
 */
export async function monthlyRows(): Promise<OpenBooksRow[]> {
  const current = monthKey(new Date());
  if (!hasDb()) return [zeroRow(current)];

  try {
    const q = db();
    const first = await q.query<{ first: Date | string | null }>("select min(created_at) as first from parents where deleted_at is null");
    const firstAt = first.rows[0]?.first ?? null;
    let key = firstAt ? monthKey(new Date(firstAt as string)) : current;

    const keys: string[] = [];
    // The guard keeps a bad `created_at` (a clock skew, a seeded row from 1970) from spinning forever.
    for (let i = 0; i < 120 && key <= current; i++) {
      keys.push(key);
      key = nextMonthKey(key);
    }
    if (keys.length === 0) keys.push(current);

    const entered = new Map<string, { build_cost: number; income: number; note: string }>();
    const ob = await q.query<{ month: Date | string; build_cost: string | number; income: string | number; note: string }>(
      "select month, build_cost, income, note from open_books",
    );
    for (const r of ob.rows) {
      const m = monthKey(new Date(r.month as string));
      entered.set(m, { build_cost: Number(r.build_cost) || 0, income: Number(r.income) || 0, note: r.note ?? "" });
    }

    const rate = usdIls();
    const rows: OpenBooksRow[] = [];
    for (const m of keys) {
      const from = monthStart(m).toISOString();
      const to = monthStart(nextMonthKey(m)).toISOString();
      const r = await q.query<{ families: string; kids: string; subs: string; usd: string }>(
        `select
           (select count(*) from parents where created_at < $2 and deleted_at is null) as families,
           (select count(*) from kids where created_at < $2 and deleted_at is null) as kids,
           (select count(*) from subscriptions
              where created_at < $2 and status in ('active','past_due')
                and (current_period_end is null or current_period_end >= $1)) as subs,
           (select coalesce(sum(cost_estimate), 0) from usage where created_at >= $1 and created_at < $2) as usd`,
        [from, to],
      );
      const c = r.rows[0];
      const subs = Number(c?.subs ?? 0);
      const e = entered.get(m);
      const token_cost = round2(Number(c?.usd ?? 0) * rate);
      const build_cost = round2(e?.build_cost ?? 0);
      const income = round2(e && e.income > 0 ? e.income : subs * APP.priceIls);
      rows.push({
        month: m,
        families: Number(c?.families ?? 0),
        kids: Number(c?.kids ?? 0),
        subs,
        token_cost,
        build_cost,
        income,
        difference: round2(income - token_cost - build_cost),
        note: e?.note ?? "",
      });
    }
    return rows.reverse();
  } catch {
    // The books are a principle, not a critical path: a database hiccup shows zeros, not an error page.
    return [zeroRow(current)];
  }
}
