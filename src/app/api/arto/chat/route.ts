import { NextResponse } from "next/server";
import { chat } from "@/lib/arto";
import { hasDb } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** POST { token, messages:[{role,content}…] } → { text, scope, remaining, cap, subscribed } */
export async function POST(req: Request) {
  if (!hasDb()) return NextResponse.json({ error: "no_db" }, { status: 503 });
  let b: Record<string, unknown> = {};
  try {
    b = await req.json();
  } catch {
    return NextResponse.json({ error: "bad_json" }, { status: 400 });
  }
  const r = await chat(typeof b.token === "string" ? b.token : "", b.messages);
  if (!r.ok) {
    const { ok: _ok, status, ...rest } = r;
    void _ok;
    return NextResponse.json(rest, { status });
  }
  return NextResponse.json({ text: r.text, scope: r.scope, remaining: r.remaining, cap: r.cap, subscribed: r.subscribed }, { headers: { "cache-control": "no-store" } });
}
