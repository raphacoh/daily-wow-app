/**
 * "Continue with Google", first-party: the OAuth dance runs on this domain (so Google shows
 * rootsandwings-edu.com and the app name), and Google's ID token is then handed to Supabase for the session.
 * GET /auth/google?next=/home → redirects to accounts.google.com.
 */
import { NextResponse, type NextRequest } from "next/server";
import { randomBytes, createHash } from "node:crypto";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  if (!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET)) return NextResponse.redirect(new URL("/signin?error=google", url.origin));
  const rawNext = url.searchParams.get("next") || "/home";
  const next = rawNext.startsWith("/") && !rawNext.startsWith("//") ? rawNext : "/home";
  const state = randomBytes(16).toString("base64url");
  const nonce = randomBytes(16).toString("base64url");
  const params = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID!,
    redirect_uri: `${url.origin}/auth/google/callback`,
    response_type: "code",
    scope: "openid email profile",
    state,
    nonce: createHash("sha256").update(nonce).digest("hex"), // Google echoes this in the ID token; Supabase checks it against sha256(raw nonce) in hex
    prompt: "select_account",
    access_type: "online",
  });
  const res = NextResponse.redirect("https://accounts.google.com/o/oauth2/v2/auth?" + params.toString());
  const cookie = { httpOnly: true, secure: url.protocol === "https:", sameSite: "lax" as const, path: "/auth/google", maxAge: 600 };
  res.cookies.set("g_state", state, cookie);
  res.cookies.set("g_nonce", nonce, cookie);
  res.cookies.set("g_next", next, cookie);
  return res;
}
