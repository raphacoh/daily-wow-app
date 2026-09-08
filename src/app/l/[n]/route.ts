import { NextResponse } from "next/server";
import { getEdition, latestReleased, wrapEdition, type RuntimeBootstrap } from "@/lib/editions";
import { kidByToken, profileFor } from "@/lib/kids";
import { hasDb } from "@/lib/db";
import { APP } from "@/lib/config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /l/N?k=<token> — the lesson page. Serves the edition fragment wrapped in a document with the
 * RUNTIME bootstrap. With a valid kid token the profile is injected (one round trip fewer for the kid);
 * without one the page runs in demo mode.
 */
export async function GET(req: Request, ctx: { params: Promise<{ n: string }> }) {
  const { n: nRaw } = await ctx.params;
  const url = new URL(req.url);
  const token = url.searchParams.get("k") || "";

  let n: number;
  if (nRaw === "today" || nRaw === "latest") {
    const latest = await latestReleased();
    if (!latest) return new NextResponse(notFound("עוד אין גיליון."), { status: 404, headers: html() });
    const q = token ? `?k=${encodeURIComponent(token)}` : "";
    return NextResponse.redirect(`${APP.url}/l/${latest.n}${q}`, 302);
  } else {
    n = Number(nRaw);
    if (!Number.isInteger(n) || n < 1) return new NextResponse(notFound("כתובת לא תקינה."), { status: 404, headers: html() });
  }

  const edition = await getEdition(n);
  if (!edition) return new NextResponse(notFound("הגיליון הזה עוד לא יצא."), { status: 404, headers: html() });

  const rt: RuntimeBootstrap = {
    api: "/api",
    kidToken: "",
    edition: { n: edition.n, code: edition.code, date: edition.date, title: edition.title },
    library: "/library",
  };
  if (token && hasDb()) {
    const kid = await kidByToken(token);
    if (kid && !kid.paused) {
      rt.kidToken = token;
      rt.profile = await profileFor(kid);
    }
  }
  const doc = wrapEdition(edition.html, rt, edition.language || "he", edition.language === "en" || edition.language === "fr" ? "ltr" : "rtl");
  return new NextResponse(doc, { status: 200, headers: html() });
}

function html() {
  return { "content-type": "text/html; charset=utf-8", "cache-control": "private, no-store" };
}

function notFound(msg: string) {
  return `<!doctype html><html lang="he" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>שורשים וכנפיים</title>
<style>body{font-family:Rubik,Arial,sans-serif;background:#FBF5E6;color:#1E2140;display:grid;place-items:center;min-height:100vh;margin:0}main{text-align:center;padding:24px}a{color:#167C8A}</style></head>
<body><main><h1>שורשים וכנפיים</h1><p>${msg}</p><p><a href="/library">כל הגיליונות ›</a></p></main></body></html>`;
}
