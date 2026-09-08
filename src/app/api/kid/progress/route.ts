import { NextResponse } from "next/server";
import { hasDb } from "@/lib/db";
import { kidByToken } from "@/lib/kids";
import { BADGE_DEFS, WINGS, WING_LEVELS, badgeName, progressFor, rebuildProgress } from "@/lib/gamification";
import { ROOTS, ROOT_STAGES } from "@/lib/roots";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/kid/progress?k=<token> — the kid's whole collection (the "my roots and wings" drawer, the dashboard). */
export async function GET(req: Request) {
  if (!hasDb()) return NextResponse.json({ error: "no_db" }, { status: 503 });
  const token = new URL(req.url).searchParams.get("k") || "";
  const kid = await kidByToken(token);
  if (!kid) return NextResponse.json({ error: "bad_kid" }, { status: 404 });
  const progress = (await progressFor(kid.id)) ?? (await rebuildProgress(kid, kid.parent.timezone || "Asia/Jerusalem"));
  // the badge case shows what is still locked (hidden ones only as a silhouette), so the page needs the definitions
  const defs = Object.entries(BADGE_DEFS).map(([id, d]) => ({ id, name: d.hidden ? null : badgeName(id, kid.feminine), glyph: d.glyph, family: d.family, hidden: !!d.hidden, hint: d.hidden ? null : d.hint }));
  const roots = Object.fromEntries(Object.entries(ROOTS).map(([id, r]) => [id, { name: r.name, glyph: r.glyph }]));
  return NextResponse.json({ ok: true, progress, defs, roots, stages: ROOT_STAGES, wings: WINGS, wing_levels: WING_LEVELS }, { headers: { "cache-control": "no-store" } });
}
