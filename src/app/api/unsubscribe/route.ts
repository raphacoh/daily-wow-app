import { NextResponse } from "next/server";
import { hasDb } from "@/lib/db";
import { emailFromToken, resubscribe, unsubscribe } from "@/lib/unsubscribe";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/unsubscribe?u=<token>[&undo=1]
 *
 * Two callers: the confirm button on /unsubscribe (a plain form post, answered with a redirect back to the
 * page), and a mail client's one-click unsubscribe (RFC 8058 — body `List-Unsubscribe=One-Click`, which only
 * needs a 2xx). Never on GET: link scanners prefetch every URL in a mail.
 */
export async function POST(req: Request) {
  const url = new URL(req.url);
  const u = url.searchParams.get("u") ?? "";
  const email = emailFromToken(u);
  if (!email) return NextResponse.json({ error: "bad_token" }, { status: 400 });
  if (!hasDb()) return NextResponse.json({ error: "no_db" }, { status: 503 });

  const body = await req.text().catch(() => "");
  const oneClick = body.includes("List-Unsubscribe=One-Click");

  if (url.searchParams.get("undo") === "1") await resubscribe(email);
  else await unsubscribe(email, oneClick ? "one_click" : "link");

  if (oneClick) return NextResponse.json({ ok: true });
  return NextResponse.redirect(new URL(`/unsubscribe?u=${encodeURIComponent(u)}`, req.url), 303);
}
