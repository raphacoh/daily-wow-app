import { NextResponse } from "next/server";
import { hasDb } from "@/lib/db";
import { NotSignedIn, requireParent } from "@/lib/auth";
import { portalUrl } from "@/lib/billing";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET — bounce the parent to the Dodo customer portal (cancel / update card). 404 when they never paid,
 * so the billing page can simply not offer the link.
 */
export async function GET() {
  if (!hasDb()) return NextResponse.json({ error: "no_db" }, { status: 503 });
  let parent;
  try {
    parent = await requireParent();
  } catch (e) {
    if (e instanceof NotSignedIn) return NextResponse.json({ error: "not_signed_in" }, { status: 401 });
    throw e;
  }
  const url = await portalUrl(parent);
  if (!url) return NextResponse.json({ error: "no_portal" }, { status: 404 });
  return NextResponse.redirect(url, { status: 302, headers: { "cache-control": "no-store" } });
}
