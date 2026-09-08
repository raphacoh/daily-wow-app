import { NextResponse, after } from "next/server";
import { kidByToken, recordCompletion } from "@/lib/kids";
import { hasDb } from "@/lib/db";
import { queueCompletionNotice } from "@/lib/notify";
import { db } from "@/lib/db";

/** the vault opens only when every part of the test is done — same rule server-side */
async function isComplete(kidId: string, n: number): Promise<boolean> {
  const r = await db().query<{ complete: boolean }>("select complete from completions where kid_id = $1 and edition_n = $2", [kidId, n]);
  return !!r.rows[0]?.complete;
}

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST { token, edition_n, score, max, complete, late?, challenge?, answers? } — the page's completion signal.
 * Replaces the old "send to Dad" email hack. Idempotent per (kid, edition); a better score updates.
 */
export async function POST(req: Request) {
  if (!hasDb()) return NextResponse.json({ error: "no_db" }, { status: 503 });
  let b: Record<string, unknown> = {};
  try {
    b = await req.json();
  } catch {
    return NextResponse.json({ error: "bad_json" }, { status: 400 });
  }
  const token = typeof b.token === "string" ? b.token : "";
  const kid = await kidByToken(token);
  if (!kid) return NextResponse.json({ error: "bad_kid" }, { status: 404 });
  if (kid.paused) return NextResponse.json({ error: "paused" }, { status: 403 });
  const edition_n = Number(b.edition_n);
  const score = Number(b.score);
  const max = Number(b.max);
  if (!Number.isInteger(edition_n) || !Number.isFinite(score) || !Number.isFinite(max)) return NextResponse.json({ error: "bad_input" }, { status: 400 });
  const answers = (b.answers && typeof b.answers === "object" ? (b.answers as Record<string, unknown>) : {}) as { explain?: unknown };
  const explanation = kid.parent.keep_explanations && typeof answers.explain === "string" ? answers.explain.slice(0, 4000) : null;

  const r = await recordCompletion(kid, { edition_n, score, max, complete: !!b.complete, challenge: !!b.challenge, explanation });
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: 409 });

  if (r.improved || r.first_time) {
    // after the response is sent, but the function stays alive until it finishes (serverless-safe)
    after(() => queueCompletionNotice(kid, edition_n, r).catch((e) => console.error("[complete] notice", e)));
  }
  return NextResponse.json(
    { ok: true, stats: r.stats, xp_awarded: r.xp_awarded, late: r.late, new_badges: r.new_badges, first_time: r.first_time, improved: r.improved, password: (await isComplete(kid.id, edition_n)) ? r.password : null },
    { headers: { "cache-control": "no-store" } },
  );
}
