import { NextResponse } from "next/server";
import { isEditorApiKey, requireEditor } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/admin/resend-domain { name, action?: "create" | "verify" | "get" }
 * Registers the sending domain with Resend and returns the DNS records to add (or the verification state).
 * Editor only; the Resend key never leaves the server.
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
  if (!process.env.RESEND_API_KEY) return NextResponse.json({ error: "resend_not_configured" }, { status: 503 });
  let b: { name?: string; action?: string } = {};
  try {
    b = await req.json();
  } catch {
    /* empty */
  }
  const name = String(b.name ?? "").trim().toLowerCase();
  if (!/^[a-z0-9.-]+\.[a-z]{2,}$/.test(name)) return NextResponse.json({ error: "bad_domain" }, { status: 400 });
  const { Resend } = await import("resend");
  const resend = new Resend(process.env.RESEND_API_KEY);

  // action "smtp-key": mint a sending-only API key for Supabase's SMTP (returned once, never stored here)
  if (b.action === "smtp-key") {
    const k = await resend.apiKeys.create({ name: `supabase-smtp-${Date.now()}`, permission: "sending_access" });
    if (k.error) return NextResponse.json({ error: k.error.message }, { status: 502 });
    return NextResponse.json({ token: k.data?.token ?? null, id: k.data?.id ?? null });
  }
  if (b.action === "revoke-key") {
    const id = String((b as { id?: string }).id ?? "");
    if (!id) return NextResponse.json({ error: "bad_id" }, { status: 400 });
    const r = await resend.apiKeys.remove(id);
    if (r.error) return NextResponse.json({ error: r.error.message }, { status: 502 });
    return NextResponse.json({ revoked: id });
  }
  const list = await resend.domains.list();
  const existing = ((list.data as unknown as { data?: { id: string; name: string; status: string }[] } | null)?.data ?? []).find((d) => d.name === name);
  const action = b.action ?? (existing ? "get" : "create");

  if (action === "create") {
    if (existing) return NextResponse.json({ error: "exists", domain: existing }, { status: 409 });
    const r = await resend.domains.create({ name, region: "eu-west-1" });
    if (r.error) return NextResponse.json({ error: r.error.message }, { status: 502 });
    return NextResponse.json({ created: true, domain: r.data });
  }
  if (!existing) return NextResponse.json({ error: "not_found" }, { status: 404 });
  if (action === "verify") {
    const v = await resend.domains.verify(existing.id);
    if (v.error) return NextResponse.json({ error: v.error.message }, { status: 502 });
  }
  const g = await resend.domains.get(existing.id);
  if (g.error) return NextResponse.json({ error: g.error.message }, { status: 502 });
  return NextResponse.json({ domain: g.data });
}
