import { NextResponse } from "next/server";
import { latestReleased } from "@/lib/editions";
import { APP } from "@/lib/config";
import { HTML_HEADERS, notFoundPage, renderLesson } from "@/lib/lesson-page";
import { currentParent } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /l/N?k=<token> — the lesson page. With a valid kid token the profile is injected; without one the
 * page runs in demo mode. `/l/today` redirects to the newest released edition.
 */
export async function GET(req: Request, ctx: { params: Promise<{ n: string }> }) {
  const { n: nRaw } = await ctx.params;
  const url = new URL(req.url);
  const token = url.searchParams.get("k") || "";

  if (nRaw === "today" || nRaw === "latest") {
    const latest = await latestReleased();
    if (!latest) return new NextResponse(notFoundPage("עוד אין גיליון."), { status: 404, headers: HTML_HEADERS });
    const q = token ? `?k=${encodeURIComponent(token)}` : "";
    return NextResponse.redirect(`${APP.url}/l/${latest.n}${q}`, 302);
  }
  const n = Number(nRaw);
  if (!Number.isInteger(n) || n < 1) return new NextResponse(notFoundPage("כתובת לא תקינה."), { status: 404, headers: HTML_HEADERS });

  const parent = token ? null : await currentParent().catch(() => null);
  const r = await renderLesson(n, { token, banner: !token, parent: parent ? { name: parent.name } : null });
  return new NextResponse(r.body, { status: r.status, headers: HTML_HEADERS });
}
