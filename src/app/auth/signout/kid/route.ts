/**
 * Forget the kid on this device. POST only — a GET would let any image tag log a kid out.
 * The personal link still works: this only clears the "this device is theirs" cookie.
 */
import { NextResponse, type NextRequest } from "next/server";
import { forgetKid } from "@/lib/kidSession";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const res = NextResponse.redirect(new URL("/", new URL(req.url).origin), { status: 303 });
  forgetKid(res);
  return res;
}
