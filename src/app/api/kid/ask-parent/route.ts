import { NextResponse } from "next/server";
import { kidByToken } from "@/lib/kids";
import { hasDb } from "@/lib/db";
import { notifyCapHit } from "@/lib/notify";
import { getNumber } from "@/lib/config";
import { localDate } from "@/lib/progress";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** POST { token } — the kid asks their parents to switch Arto on: one email to the parent per kid per day, with the activation link. */
export async function POST(req: Request) {
  if (!hasDb()) return NextResponse.json({ error: "no_db" }, { status: 503 });
  let b: { token?: unknown } = {};
  try {
    b = await req.json();
  } catch {
    /* empty */
  }
  const kid = await kidByToken(typeof b.token === "string" ? b.token : "");
  if (!kid) return NextResponse.json({ error: "bad_kid" }, { status: 404 });
  const day = localDate(new Date(), kid.parent.timezone || "Asia/Jerusalem");
  const r = await notifyCapHit(kid, day, await getNumber("free_messages_per_day"), true);
  return NextResponse.json({ ok: true, already: !r.sent });
}
