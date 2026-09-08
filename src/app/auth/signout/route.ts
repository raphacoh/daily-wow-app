/**
 * Sign out. POST only — a GET would let any image tag log a parent out.
 */
import { NextResponse, type NextRequest } from "next/server";
import { supabaseConfigured, supabaseServer } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  if (supabaseConfigured()) {
    try {
      await (await supabaseServer()).auth.signOut();
    } catch (e) {
      console.error("[auth/signout]", e);
    }
  }
  return NextResponse.redirect(new URL("/", new URL(req.url).origin), { status: 303 });
}
