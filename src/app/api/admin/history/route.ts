import { NextResponse } from "next/server";
import { hasDb } from "@/lib/db";
import { guard } from "@/lib/adminAuth";
import { editionHistory } from "@/lib/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { "cache-control": "no-store" };

/** GET /api/admin/history — titles and topics of every edition ever: the builder's do-not-repeat list. */
export async function GET(req: Request) {
  const denied = await guard(req);
  if (denied) return denied;
  if (!hasDb()) return NextResponse.json({ error: "no_db" }, { status: 503, headers: NO_STORE });
  const history = await editionHistory();
  return NextResponse.json({ history, titles: history.map((h) => h.title), topics: [...new Set(history.flatMap((h) => h.topics))] }, { headers: NO_STORE });
}
