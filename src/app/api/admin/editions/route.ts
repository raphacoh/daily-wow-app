import { NextResponse } from "next/server";
import { hasDb } from "@/lib/db";
import { body, guard } from "@/lib/adminAuth";
import { listAdminEditions, stageEdition, StageError, type StageInput } from "@/lib/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { "cache-control": "no-store" };

/** GET /api/admin/editions?limit=40 — the do-not-repeat list and the admin table. Never html/password. */
export async function GET(req: Request) {
  const denied = await guard(req);
  if (denied) return denied;
  if (!hasDb()) return NextResponse.json({ error: "no_db" }, { status: 503, headers: NO_STORE });
  const limit = Number(new URL(req.url).searchParams.get("limit") ?? 40);
  const all = await listAdminEditions(Number.isFinite(limit) ? limit : 40);
  const editions = all.map((e) => ({
    n: e.n,
    code: e.code,
    date: e.date,
    title: e.title,
    topics: e.topics,
    summary: e.summary,
    status: e.status,
    reviewer_verdict: e.reviewer_verdict ?? null,
    review_url: e.review_url ?? null,
    released_at: e.released_at,
  }));
  return NextResponse.json({ editions }, { headers: NO_STORE });
}

/** POST /api/admin/editions — the nightly builder stages edition N (metadata + verdict + the fragment). */
export async function POST(req: Request) {
  const denied = await guard(req);
  if (denied) return denied;
  if (!hasDb()) return NextResponse.json({ error: "no_db" }, { status: 503, headers: NO_STORE });
  const b = await body(req);
  try {
    const edition = await stageEdition({
      n: Number(b.n),
      code: typeof b.code === "string" ? b.code : undefined,
      date: String(b.date ?? ""),
      title: typeof b.title === "string" ? b.title : undefined,
      topics: Array.isArray(b.topics) ? (b.topics as unknown[]).map(String) : undefined,
      summary: typeof b.summary === "string" ? b.summary : undefined,
      teaser: typeof b.teaser === "string" ? b.teaser : undefined,
      language: typeof b.language === "string" ? b.language : undefined,
      password: typeof b.password === "string" ? b.password : undefined,
      max_score: b.max_score === undefined ? undefined : Number(b.max_score),
      reviewer_verdict: typeof b.reviewer_verdict === "string" ? b.reviewer_verdict : null,
      review_url: typeof b.review_url === "string" ? b.review_url : null,
      sources: typeof b.sources === "string" ? b.sources : null,
      html: String(b.html ?? ""),
    } satisfies StageInput);
    const { html: _html, password: _pw, ...safe } = edition;
    void _html;
    void _pw;
    return NextResponse.json({ edition: safe }, { status: 201, headers: NO_STORE });
  } catch (e) {
    if (e instanceof StageError) return NextResponse.json({ error: e.message, problems: e.problems }, { status: 400, headers: NO_STORE });
    throw e;
  }
}
