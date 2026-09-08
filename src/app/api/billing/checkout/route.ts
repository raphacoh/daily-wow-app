import { NextResponse } from "next/server";
import { hasDb } from "@/lib/db";
import { NotSignedIn, requireParent } from "@/lib/auth";
import { assertOwnsKid } from "@/lib/family";
import { billingConfigured, createCheckout } from "@/lib/billing";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST { kid_id } — a Dodo hosted checkout for one kid (PRD §6.7). One subscription per kid.
 * 503 `billing_not_configured` when there are no Dodo keys: the app still runs, the page says so kindly.
 */
export async function POST(req: Request) {
  if (!hasDb()) return NextResponse.json({ error: "no_db" }, { status: 503 });
  let parent;
  try {
    parent = await requireParent();
  } catch (e) {
    if (e instanceof NotSignedIn) return NextResponse.json({ error: "not_signed_in" }, { status: 401 });
    throw e;
  }
  if (!billingConfigured()) return NextResponse.json({ error: "billing_not_configured" }, { status: 503 });

  let body: Record<string, unknown> = {};
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "bad_json" }, { status: 400 });
  }
  const kidId = typeof body.kid_id === "string" ? body.kid_id : "";
  if (!kidId) return NextResponse.json({ error: "bad_input" }, { status: 400 });
  try {
    await assertOwnsKid(parent.id, kidId);
  } catch {
    return NextResponse.json({ error: "not_your_kid" }, { status: 404 });
  }

  const url = await createCheckout(parent, kidId);
  if (!url) return NextResponse.json({ error: "billing_not_configured" }, { status: 503 });
  return NextResponse.json({ url }, { headers: { "cache-control": "no-store" } });
}
