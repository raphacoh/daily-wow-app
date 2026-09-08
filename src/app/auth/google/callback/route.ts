/**
 * Google sends the user back here with a code. We exchange it for an ID token (server to server, with the
 * client secret), then let Supabase mint the session from that token. No Supabase hostname ever shows.
 */
import { NextResponse, type NextRequest } from "next/server";
import { supabaseConfigured, supabaseServer } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const fail = (why: string, code = "google") => {
    console.error("[auth/google]", why);
    const r = NextResponse.redirect(new URL(`/signin?error=google&why=${encodeURIComponent(code)}`, url.origin));
    for (const c of ["g_state", "g_nonce", "g_next"]) r.cookies.set(c, "", { path: "/auth/google", maxAge: 0 });
    return r;
  };
  if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET || !supabaseConfigured()) return fail("not configured", "config");
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const savedState = req.cookies.get("g_state")?.value;
  const nonce = req.cookies.get("g_nonce")?.value;
  const nextRaw = req.cookies.get("g_next")?.value || "/home";
  const next = nextRaw.startsWith("/") && !nextRaw.startsWith("//") ? nextRaw : "/home";
  if (!code || !state || !savedState || state !== savedState || !nonce) return fail("state mismatch", "state");

  // code → tokens
  const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: process.env.GOOGLE_CLIENT_ID,
      client_secret: process.env.GOOGLE_CLIENT_SECRET,
      redirect_uri: `${url.origin}/auth/google/callback`,
      grant_type: "authorization_code",
    }),
  });
  if (!tokenRes.ok) return fail("token exchange " + tokenRes.status + " " + (await tokenRes.text()).slice(0, 200), "exchange");
  const tokens = (await tokenRes.json()) as { id_token?: string };
  if (!tokens.id_token) return fail("no id_token", "token");

  // ID token → Supabase session (Supabase verifies the signature, audience = our client id, and the nonce)
  const sb = await supabaseServer();
  const { error } = await sb.auth.signInWithIdToken({ provider: "google", token: tokens.id_token, nonce });
  if (error) return fail("supabase " + error.message, "session:" + error.message.slice(0, 60));

  const res = NextResponse.redirect(new URL(next, url.origin));
  for (const c of ["g_state", "g_nonce", "g_next"]) res.cookies.set(c, "", { path: "/auth/google", maxAge: 0 });
  return res;
}
