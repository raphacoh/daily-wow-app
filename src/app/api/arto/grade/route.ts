import { NextResponse } from "next/server";
import { grade } from "@/lib/arto";
import { hasDb } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** POST { token, explanation } → { stars, praise, missing[], tip, remaining } */
export async function POST(req: Request) {
  if (!hasDb()) return NextResponse.json({ error: "no_db" }, { status: 503 });
  let b: Record<string, unknown> = {};
  try {
    b = await req.json();
  } catch {
    return NextResponse.json({ error: "bad_json" }, { status: 400 });
  }
  const r = await grade(typeof b.token === "string" ? b.token : "", b.explanation);
  if (!r.ok) {
    const { ok: _ok, status, ...rest } = r;
    void _ok;
    return NextResponse.json(rest, { status });
  }
  const { ok: _ok, ...out } = r;
  void _ok;
  return NextResponse.json(out, { headers: { "cache-control": "no-store" } });
}
