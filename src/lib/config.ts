/**
 * Runtime configuration: environment first, then the `app_config` table (editable from /admin), then defaults.
 * Everything the PRD calls "in config" lives here.
 */
import { db, hasDb } from "./db";

const DEFAULTS: Record<string, string> = {
  assistant_daily_cap: "30",
  free_messages_per_day: "3",
  demo_pool_per_day: "30",
  demo_messages_per_session: "3",
  demo_per_visitor_per_day: "6",
  model: "claude-sonnet-5",
  send_time: "11:05",
  magic_links_per_family_per_day: "20",
  resend_daily_limit: "100",
  off_topic_alert_pct: "10",
  past_due_grace_days: "7",
  max_kids_per_family: "6",
};

const ENV_OVERRIDES: Record<string, string | undefined> = {
  assistant_daily_cap: process.env.ASSISTANT_DAILY_CAP,
  free_messages_per_day: process.env.FREE_MESSAGES_PER_DAY,
  demo_pool_per_day: process.env.DEMO_POOL_PER_DAY,
  model: process.env.MODEL,
  send_time: process.env.SEND_TIME,
  resend_daily_limit: process.env.RESEND_DAILY_LIMIT,
};

let cache: { at: number; values: Record<string, string> } | null = null;

export async function getConfig(key: keyof typeof DEFAULTS | string): Promise<string> {
  const env = ENV_OVERRIDES[key];
  if (env !== undefined && env !== "") return env;
  if (hasDb()) {
    try {
      if (!cache || Date.now() - cache.at > 60_000) {
        const r = await db().query<{ key: string; value: string }>("select key, value from app_config");
        cache = { at: Date.now(), values: Object.fromEntries(r.rows.map((x) => [x.key, x.value])) };
      }
      if (cache.values[key] !== undefined) return cache.values[key];
    } catch {
      /* fall through to defaults */
    }
  }
  return DEFAULTS[key] ?? "";
}

export async function getNumber(key: string): Promise<number> {
  const v = Number(await getConfig(key));
  return Number.isFinite(v) ? v : Number(DEFAULTS[key] ?? 0);
}

export function invalidateConfigCache() {
  cache = null;
}

export const APP = {
  url: (process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000").replace(/\/+$/, ""),
  name: "שורשים וכנפיים",
  editorName: process.env.EDITOR_NAME || "רף",
  editorEmail: process.env.EDITOR_EMAIL || "raphco@gmail.com",
  fromEmail: process.env.EMAIL_FROM || "שורשים וכנפיים <hello@example.com>",
  timezone: process.env.EDITOR_TIMEZONE || "Asia/Jerusalem",
  kitRepo: "https://github.com/raphacoh/daily-wow-kit",
  editionsRepo: process.env.EDITIONS_REPO_URL || "https://github.com/raphacoh/daily-wow-editions",
  appRepo: process.env.APP_REPO_URL || "https://github.com/raphacoh/daily-wow-app",
  priceIls: 10,
};

export const DEFAULT_CONFIG = DEFAULTS;

/** The kit's hosted demo (edition #1 with generic names, entrance password "demo"). */
export const DEMO_URL = process.env.DEMO_URL || "https://raphacoh.github.io/daily-wow-kit/demo/";
export const X_HANDLE = "@rootsaandwings";
export const X_URL = "https://x.com/rootsaandwings";
