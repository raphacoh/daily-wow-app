import { NextResponse } from "next/server";
import { track, visitorHash, type EventName } from "@/lib/analytics";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ALLOWED: EventName[] = ["demo_start", "demo_complete"];

/** POST /api/e { name, n? } — the page's beacon for demo events. Anonymous, rate-limited by design (one row per hit). */
export async function POST(req: Request) {
  let b: { name?: string; n?: number } = {};
  try {
    b = await req.json();
  } catch {
    /* sendBeacon sends text/plain; try that */
  }
  if (!b.name) {
    try {
      b = JSON.parse(await req.text());
    } catch {
      /* empty */
    }
  }
  const name = ALLOWED.find((n) => n === b.name);
  if (!name) return NextResponse.json({ ok: false }, { status: 204 });
  await track(name, { visitor: visitorHash(req), edition_n: Number.isInteger(b.n) ? Number(b.n) : null });
  return new NextResponse(null, { status: 204 });
}
