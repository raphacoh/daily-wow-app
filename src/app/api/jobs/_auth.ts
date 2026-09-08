/**
 * Shared guard for the cron endpoints. Vercel Cron calls them with `Authorization: Bearer $CRON_SECRET`
 * (the value of the CRON_SECRET environment variable), which is also what a manual curl must send.
 *
 *   no CRON_SECRET set → 503 (the job is not configured; better than silently accepting everyone)
 *   wrong / missing header → 401
 */
import { NextResponse } from "next/server";
import { safeEqual } from "@/lib/tokens";

export function cronGuard(req: Request): NextResponse | null {
  const secret = process.env.CRON_SECRET;
  if (!secret || !secret.trim()) return NextResponse.json({ error: "cron_secret_unset" }, { status: 503 });
  const got = req.headers.get("authorization") ?? "";
  if (!safeEqual(got, `Bearer ${secret}`)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  return null;
}

/** `?force=1` — bypass the local-time gate (the admin's "send now" button, and manual replays). */
export function forced(req: Request): boolean {
  const v = new URL(req.url).searchParams.get("force");
  return v === "1" || v === "true";
}

/**
 * `?now=<ISO>` — a fake clock, honoured **only** under NODE_ENV=test. It exists so the tests can drive
 * the time gates through the real route; in dev and production the query parameter is ignored.
 */
export function testNow(req: Request): Date | undefined {
  if (process.env.NODE_ENV !== "test") return undefined;
  const raw = new URL(req.url).searchParams.get("now");
  if (!raw) return undefined;
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? undefined : d;
}

export function json(body: unknown, status = 200): NextResponse {
  return NextResponse.json(body, { status, headers: { "cache-control": "no-store" } });
}
