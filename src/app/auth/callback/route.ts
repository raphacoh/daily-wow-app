/**
 * Magic-link landing (PRD §6.1). Supabase sends either `?code=` (PKCE) or `?token_hash=&type=`
 * (the plain email-link flow); both end with a session cookie and a redirect to `next`.
 * `next` is only ever followed when it is a path on this site.
 */
import { NextResponse, type NextRequest } from "next/server";
import type { EmailOtpType } from "@supabase/supabase-js";
import { supabaseConfigured, supabaseServer } from "@/lib/auth";

export const dynamic = "force-dynamic";

/** Only relative, single-slash paths: never an absolute URL or a protocol-relative one. */
function safeNext(raw: string | null): string {
  if (!raw || !raw.startsWith("/") || raw.startsWith("//") || raw.startsWith("/\\")) return "/home";
  return raw;
}

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const failed = NextResponse.redirect(new URL("/signin?error=1", url.origin));
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
    console.error("[auth/callback]", e);
    return failed;
  }

  return NextResponse.redirect(new URL(safeNext(url.searchParams.get("next")), url.origin));
}
