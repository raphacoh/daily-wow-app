import { NextResponse } from "next/server";
import { openSession } from "@/lib/arto";
import { hasDb } from "@/lib/db";
import { visitorHash } from "@/lib/analytics";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** POST { kidToken, edition_n } → { token, remaining, cap, subscribed } (kidToken empty = the demo pool). */
export async function POST(req: Request) {
  if (!hasDb()) return NextResponse.json({ error: "no_db" }, { status: 503 });
  let b: Record<string, unknown> = {};
  try {
    b = await req.json();
  } catch {
    /* empty */
  }
  const kidToken = typeof b.kidToken === "string" ? b.kidToken : "";
  const edition_n = Number(b.edition_n);
  if (!Number.isInteger(edition_n)) return NextResponse.json({ error: "bad_edition" }, { status: 400 });
  const r = await openSession(kidToken, edition_n, new Date(), kidToken ? null : visitorHash(req));
  if ("error" in r) return NextResponse.json({ error: r.error }, { status: r.status });
  return NextResponse.json(r, { headers: { "cache-control": "no-store" } });
}
