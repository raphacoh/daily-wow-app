import { NextResponse } from "next/server";
import { hasDb } from "@/lib/db";
import { kidByToken } from "@/lib/kids";
import { recordItemEvents, type ItemEventIn } from "@/lib/gamification";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST { token, edition_n, events:[{ id, kind, correct?, partial?, attempt?, stars?, graded?, value?, target? }] }
 * — the engine's per-item events (gamification spec §8.2). First attempt per item is immutable; capped per edition.
 */
export async function POST(req: Request) {
  if (!hasDb()) return NextResponse.json({ error: "no_db" }, { status: 503 });
  let b: { token?: unknown; edition_n?: unknown; events?: unknown } = {};
  try {
    b = await req.json();
  } catch {
    return NextResponse.json({ error: "bad_json" }, { status: 400 });
  }
  const kid = await kidByToken(typeof b.token === "string" ? b.token : "");
  if (!kid) return NextResponse.json({ error: "bad_kid" }, { status: 404 });
  if (kid.paused) return NextResponse.json({ error: "paused" }, { status: 403 });
  const n = Number(b.edition_n);
  if (!Number.isInteger(n) || !Array.isArray(b.events)) return NextResponse.json({ error: "bad_input" }, { status: 400 });
  const r = await recordItemEvents(kid, n, b.events as ItemEventIn[], kid.parent.timezone || "Asia/Jerusalem");
  if (r.error) return NextResponse.json({ error: r.error }, { status: 409 });
  return NextResponse.json({ ok: true, accepted: r.accepted }, { headers: { "cache-control": "no-store" } });
}
