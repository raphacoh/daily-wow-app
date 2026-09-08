import { NextResponse } from "next/server";
import { Webhook } from "standardwebhooks";
import { hasDb } from "@/lib/db";
import { applyWebhook, webhookConfigured, type DodoEvent } from "@/lib/billing";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST — Dodo Payments webhooks, Standard Webhooks spec (headers `webhook-id`, `webhook-timestamp`,
 * `webhook-signature`). The raw body is what is signed, so it is read with `req.text()` and never
 * re-serialised. Always 200 once the signature checks out — Dodo retries on anything else, and a payload
 * we don't act on (an unknown event type, a subscription with no kid) is not an error worth retrying.
 */
export async function POST(req: Request) {
  if (!webhookConfigured()) return NextResponse.json({ error: "webhooks_not_configured" }, { status: 503 });
  if (!hasDb()) return NextResponse.json({ error: "no_db" }, { status: 503 });

  const raw = await req.text();
  const headers = {
    "webhook-id": req.headers.get("webhook-id") ?? "",
    "webhook-timestamp": req.headers.get("webhook-timestamp") ?? "",
    "webhook-signature": req.headers.get("webhook-signature") ?? "",
  };
  try {
    new Webhook(process.env.DODO_PAYMENTS_WEBHOOK_KEY!).verify(raw, headers);
  } catch {
    return NextResponse.json({ error: "bad_signature" }, { status: 401 });
  }

  let payload: Omit<DodoEvent, "id">;
  try {
    payload = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: "bad_json" }, { status: 400 });
  }

  try {
    await applyWebhook({ ...payload, id: headers["webhook-id"] });
  } catch (e) {
    // A real failure (database down) must be retried by Dodo.
    console.error("dodo webhook failed", (e as Error).message);
    return NextResponse.json({ error: "apply_failed" }, { status: 500 });
  }
  return NextResponse.json({ received: true }, { headers: { "cache-control": "no-store" } });
}
