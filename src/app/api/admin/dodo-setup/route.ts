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
    // status
    const products = await client.products.list();
    const webhooks = await client.webhooks.list();
    const items = (products as unknown as { items?: unknown[] }).items ?? [];
    const hooks = (webhooks as unknown as { items?: { id: string; url: string }[] }).items ?? [];
    return NextResponse.json({ products: items, webhooks: hooks.map((h) => ({ id: h.id, url: h.url })) });
  } catch (e) {
    return NextResponse.json({ error: String((e as Error).message).slice(0, 300) }, { status: 502 });
  }
}
