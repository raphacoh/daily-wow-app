/**
 * Magic-link landing with the destination in the PATH: /auth/cb/<base64url(next)>?token_hash=…&type=email
 * Supabase only redirects to URLs on its allow-list, and query strings make that matching brittle, so the
 * sign-in action encodes `next` into the path instead. Same handling as /auth/callback otherwise.
 */
import { NextResponse, type NextRequest } from "next/server";
import type { EmailOtpType } from "@supabase/supabase-js";
import { supabaseConfigured, supabaseServer } from "@/lib/auth";

export const dynamic = "force-dynamic";

function safeNext(raw: string): string {
  let next = "/home";
  try {
    next = Buffer.from(raw, "base64url").toString("utf8");
  } catch {
    /* keep default */
  }
  if (!next.startsWith("/") || next.startsWith("//") || next.startsWith("/\\")) return "/home";
  return next;
}

export async function GET(req: NextRequest, ctx: { params: Promise<{ n: string }> }) {
  const { n } = await ctx.params;
  const url = new URL(req.url);
  const next = safeNext(n);
  const failed = NextResponse.redirect(new URL(`/signin?error=1&next=${encodeURIComponent(next)}`, url.origin));
  if (!supabaseConfigured()) return failed;
  const code = url.searchParams.get("code");
  const tokenHash = url.searchParams.get("token_hash");
  const type = url.searchParams.get("type");
  try {
    const sb = await supabaseServer();
    if (code) {
      const { error } = await sb.auth.exchangeCodeForSession(code);
      if (error) return failed;
    } else if (tokenHash && type) {
      const { error } = await sb.auth.verifyOtp({ token_hash: tokenHash, type: type as EmailOtpType });
      if (error) return failed;
    } else {
      return failed;
    }
  } catch (e) {
    console.error("[auth/cb]", e);
    return failed;
  }
  return NextResponse.redirect(new URL(next, url.origin));
}
