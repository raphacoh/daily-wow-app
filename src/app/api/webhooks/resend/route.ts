import { NextResponse } from "next/server";
import { Webhook } from "standardwebhooks";
import { APP } from "@/lib/config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Resend inbound: mail sent to hello@<domain> arrives here as an `email.received` event (Svix-signed) and is
 * forwarded, untouched, to the editor's inbox. Replying from Gmail goes back to the original sender.
 */
export async function POST(req: Request) {
  const secret = process.env.RESEND_WEBHOOK_SECRET;
  if (!secret || !process.env.RESEND_API_KEY) return NextResponse.json({ error: "not_configured" }, { status: 503 });
  const raw = await req.text();
  const headers = {
    "webhook-id": req.headers.get("svix-id") ?? "",
    "webhook-timestamp": req.headers.get("svix-timestamp") ?? "",
    "webhook-signature": req.headers.get("svix-signature") ?? "",
  };
  let event: { type?: string; data?: { email_id?: string; from?: string; subject?: string } };
  try {
    event = new Webhook(secret).verify(raw, headers) as typeof event;
  } catch {
    return NextResponse.json({ error: "bad_signature" }, { status: 401 });
  }
  if (event.type !== "email.received" || !event.data?.email_id) return NextResponse.json({ received: true });
  const { Resend } = await import("resend");
  const resend = new Resend(process.env.RESEND_API_KEY);
  const from = (process.env.EMAIL_FROM || "").match(/<([^>]+)>/)?.[1] || "hello@rootsandwings-edu.com";
  const r = await resend.emails.receiving.forward({ emailId: event.data.email_id, to: APP.editorEmail, from, passthrough: true });
  if (r.error) {
    console.error("[resend inbound] forward failed", r.error.message);
    return NextResponse.json({ error: "forward_failed" }, { status: 502 });
  }
  return NextResponse.json({ received: true, forwarded: r.data?.id ?? null });
}
