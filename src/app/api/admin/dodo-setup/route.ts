import { NextResponse } from "next/server";
import { isEditorApiKey, requireEditor } from "@/lib/auth";
import { APP } from "@/lib/config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/admin/dodo-setup { action: "status" | "product" | "webhook" }
 * One-time provisioning on the Dodo account through its API (needs DODO_PAYMENTS_API_KEY on the server):
 *  - product: the single recurring product, ₪10 / month (USD-equivalent if ILS is not offered on the account)
 *  - webhook: the endpoint for this app, with its signing secret (returned once, to be stored in Vercel)
 * Editor only. The API key never leaves the server.
 */
export async function POST(req: Request) {
  let allowed = isEditorApiKey(req.headers.get("authorization"));
  if (!allowed) {
    try {
      await requireEditor();
      allowed = true;
    } catch {
      allowed = false;
    }
  }
  if (!allowed) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!process.env.DODO_PAYMENTS_API_KEY) return NextResponse.json({ error: "dodo_not_configured" }, { status: 503 });
  let b: { action?: string } = {};
  try {
    b = await req.json();
  } catch {
    /* empty */
  }
  const { default: DodoPayments } = await import("dodopayments");
  const client = new DodoPayments({
    bearerToken: process.env.DODO_PAYMENTS_API_KEY,
    environment: (process.env.DODO_PAYMENTS_ENVIRONMENT as "test_mode" | "live_mode") || "test_mode",
  });

  try {
    if (b.action === "product") {
      const base = {
        name: "ארטו — העוזר של שורשים וכנפיים",
        description: "העוזר שעונה לילד/ה על שאלות בתוך השיעור, עד 30 שאלות ביום. המחיר מכסה את עלות הטוקנים; המספרים פתוחים.",
        tax_category: "edtech" as const,
      };
      const recurring = (currency: "ILS" | "USD", price: number) => ({
        type: "recurring_price" as const,
        currency,
        price,
        discount: 0,
        payment_frequency_count: 1,
        payment_frequency_interval: "Month" as const,
        subscription_period_count: 1,
        subscription_period_interval: "Month" as const,
        purchasing_power_parity: false,
        tax_inclusive: true,
      });
      try {
        const p = await client.products.create({ ...base, price: recurring("ILS", APP.priceIls * 100) });
        return NextResponse.json({ product_id: p.product_id, currency: "ILS" });
      } catch (e) {
        // ILS not available on this account → USD equivalent, displayed as ≈ ₪10 on the site
        const p = await client.products.create({ ...base, price: recurring("USD", 270) });
        return NextResponse.json({ product_id: p.product_id, currency: "USD", note: String((e as Error).message).slice(0, 160) });
      }
    }
    if (b.action === "webhook") {
      const url = `${APP.url}/api/webhooks/dodo`;
      const w = await client.webhooks.create({
        url,
        description: "Roots and Wings app",
        filter_types: [
          "subscription.active", "subscription.renewed", "subscription.updated", "subscription.past_due", "subscription.on_hold",
          "subscription.cancelled", "subscription.expired", "subscription.failed", "subscription.plan_changed",
          "payment.succeeded", "payment.failed",
        ],
      });
      const s = await client.webhooks.retrieveSecret(w.id);
      return NextResponse.json({ webhook_id: w.id, url, secret: s.secret });
    }
    if (b.action === "simulate") {
      // drive the real webhook state machine with a synthetic event (signature path is unit-tested separately)
      const { applyWebhook } = await import("@/lib/billing");
      const x = b as { type?: string; kid_id?: string; subscription_id?: string; next_billing_date?: string; cancel_at_next_billing_date?: boolean; status?: string };
      const ev = {
        id: "qa-" + crypto.randomUUID(),
        business_id: "qa",
        type: x.type ?? "subscription.active",
        timestamp: new Date().toISOString(),
        data: {
          payload_type: "Subscription",
          subscription_id: x.subscription_id ?? "sub_qa_" + Date.now(),
          status: x.status ?? (x.type?.startsWith("subscription.") ? x.type.split(".")[1] : "active"),
          next_billing_date: x.next_billing_date ?? new Date(Date.now() + 30 * 86400e3).toISOString(),
          previous_billing_date: new Date().toISOString(),
          customer: { customer_id: "cus_qa", email: "qa@example.com", name: "QA" },
          metadata: { kid_id: x.kid_id ?? "", parent_id: "" },
          product_id: process.env.DODO_PRODUCT_ID ?? "",
          cancelled_at: null,
          cancel_at_next_billing_date: !!x.cancel_at_next_billing_date,
          quantity: 1,
        },
      };
      const r = await applyWebhook(ev as never);
      return NextResponse.json({ applied: r ?? true, event: ev.type });
    }
    if (b.action === "checkout-test") {
      // creates a checkout session for the editor (nothing is charged unless someone completes it)
      const c = await client.checkoutSessions.create({
        product_cart: [{ product_id: process.env.DODO_PRODUCT_ID ?? "", quantity: 1 }],
        customer: { email: APP.editorEmail, name: APP.editorName },
        return_url: `${APP.url}/billing?ok=1`,
        metadata: { test: "1" },
      });
      return NextResponse.json({ checkout_url: c.checkout_url ?? null, session_id: c.session_id });
    }
    // status: also detect which mode the key belongs to (test and live keys are different)
    if (!b.action || b.action === "status") {
      const detected: Record<string, string> = {};
      for (const env of ["test_mode", "live_mode"] as const) {
        try {
          const c = new DodoPayments({ bearerToken: process.env.DODO_PAYMENTS_API_KEY, environment: env });
          const r = await c.products.list();
          detected[env] = "ok (" + (((r as unknown as { items?: unknown[] }).items ?? []).length) + " products)";
        } catch (e) {
          detected[env] = String((e as Error).message).slice(0, 60);
        }
      }
      return NextResponse.json({ configured_environment: process.env.DODO_PAYMENTS_ENVIRONMENT || "test_mode", key_works_in: detected });
    }
    const products = await client.products.list();
    const webhooks = await client.webhooks.list();
    const items = (products as unknown as { items?: unknown[] }).items ?? [];
    const hooks = (webhooks as unknown as { items?: { id: string; url: string }[] }).items ?? [];
    return NextResponse.json({ products: items, webhooks: hooks.map((h) => ({ id: h.id, url: h.url })) });
  } catch (e) {
    return NextResponse.json({ error: String((e as Error).message).slice(0, 300) }, { status: 502 });
  }
}
