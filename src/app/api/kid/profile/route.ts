import { NextResponse } from "next/server";
import { kidByToken, profileFor } from "@/lib/kids";
import { hasDb } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** POST { token } → the kid's rendering profile (name, gender, grade, level, stats). Never the parent's email. */
export async function POST(req: Request) {
  if (!hasDb()) return NextResponse.json({ error: "no_db" }, { status: 503 });
  let body: { token?: unknown } = {};
  try {
    body = await req.json();
  } catch {
    /* empty */
  }
  const token = typeof body.token === "string" ? body.token : "";
  const kid = await kidByToken(token);
  if (!kid) return NextResponse.json({ error: "bad_kid" }, { status: 404, headers: { "cache-control": "no-store" } });
  const profile = await profileFor(kid);
  return NextResponse.json(profile, { headers: { "cache-control": "no-store" } });
}
