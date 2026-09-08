import { NextResponse } from "next/server";
import { isEditorApiKey, requireEditor, supabaseConfigured } from "@/lib/auth";
import { hasDb, db } from "@/lib/db";
import { APP } from "@/lib/config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/admin/status — which integrations are configured (booleans only, never values), plus a live
 * check of each one that can be probed cheaply. Editor only.
 */
export async function GET(req: Request) {
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

  const out: Record<string, unknown> = {
    app_url: APP.url,
    from_email: APP.fromEmail,
    database: { configured: hasDb(), ok: false as boolean | string },
    supabase_auth: { configured: supabaseConfigured() },
    resend: { configured: !!process.env.RESEND_API_KEY, domain: null as unknown },
    anthropic: { configured: !!process.env.ANTHROPIC_API_KEY, model: process.env.MODEL || "claude-sonnet-5" },
    dodo: {
      configured: !!(process.env.DODO_PAYMENTS_API_KEY && process.env.DODO_PRODUCT_ID),
      webhook_key: !!process.env.DODO_PAYMENTS_WEBHOOK_KEY,
      environment: process.env.DODO_PAYMENTS_ENVIRONMENT || null,
      product: null as unknown,
    },
    cron_secret: !!process.env.CRON_SECRET,
  };

  if (hasDb()) {
    try {
      const r = await db().query<{ n: number }>("select count(*)::int as n from editions where status = 'released'");
      out.database = { configured: true, ok: true, released_editions: r.rows[0]?.n ?? 0 };
    } catch (e) {
      out.database = { configured: true, ok: String((e as Error).message).slice(0, 120) };
    }
  }

  // Resend: list domains and report verification state (names only)
  if (process.env.RESEND_API_KEY) {
    try {
      const { Resend } = await import("resend");
      const resend = new Resend(process.env.RESEND_API_KEY);
      const d = await resend.domains.list();
      const list = (d.data as unknown as { data?: { name: string; status: string }[] } | null)?.data ?? (d.data as unknown as { name: string; status: string }[] | null) ?? [];
      (out.resend as Record<string, unknown>).domain = Array.isArray(list) ? list.map((x) => ({ name: x.name, status: x.status })) : d.error?.message ?? "unknown";
    } catch (e) {
      (out.resend as Record<string, unknown>).domain = "error: " + String((e as Error).message).slice(0, 120);
    }
  }

  // Dodo: fetch the product so a wrong id or environment shows up immediately
  if (process.env.DODO_PAYMENTS_API_KEY && process.env.DODO_PRODUCT_ID) {
    try {
      const { default: DodoPayments } = await import("dodopayments");
      const client = new DodoPayments({ bearerToken: process.env.DODO_PAYMENTS_API_KEY, environment: (process.env.DODO_PAYMENTS_ENVIRONMENT as "test_mode" | "live_mode") || "test_mode" });
      const p = (await client.products.retrieve(process.env.DODO_PRODUCT_ID)) as unknown as { name?: string; price?: unknown; is_recurring?: boolean };
      (out.dodo as Record<string, unknown>).product = { name: p.name, recurring: p.is_recurring, price: p.price };
    } catch (e) {
      (out.dodo as Record<string, unknown>).product = "error: " + String((e as Error).message).slice(0, 160);
    }
  }

  return NextResponse.json(out, { headers: { "cache-control": "no-store" } });
}
