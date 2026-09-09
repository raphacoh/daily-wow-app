/**
 * "This device is the kid's": the personal link token, remembered in an httpOnly cookie.
 *
 * A kid has no account — the token from the daily email IS the identity. Once a kid opens their link
 * once, the app remembers it so the bare domain lands on today's lesson instead of the visitor demo,
 * and so the token stops travelling in URLs the kid might share. A signed-in parent always wins over
 * the cookie (see `/` and `/l/[n]`), so a parent who previews a kid's lesson is never mistaken for one.
 */
import { cookies } from "next/headers";
import type { NextResponse } from "next/server";

export const KID_COOKIE = "rw_kid";
const MAX_AGE = 60 * 60 * 24 * 400; // the link is long-lived; the daily email re-arms it anyway

function opts() {
  return { httpOnly: true, sameSite: "lax" as const, secure: process.env.NODE_ENV === "production", path: "/", maxAge: MAX_AGE };
}

/** The remembered token, or "". Never throws — outside a request scope (tests, build) there is no cookie store. */
export async function rememberedKidToken(): Promise<string> {
  try {
    return (await cookies()).get(KID_COOKIE)?.value ?? "";
  } catch {
    return "";
  }
}

export function rememberKid(res: NextResponse, token: string): void {
  res.cookies.set(KID_COOKIE, token, opts());
}

export function forgetKid(res: NextResponse): void {
  res.cookies.set(KID_COOKIE, "", { ...opts(), maxAge: 0 });
}
