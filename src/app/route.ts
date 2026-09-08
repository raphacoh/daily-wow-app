import { NextResponse } from "next/server";
import { latestReleased } from "@/lib/editions";
import { HTML_HEADERS, notFoundPage, renderLesson } from "@/lib/lesson-page";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The front page IS today's lesson, in demo mode, with the visitor strip on top. Show, don't tell.
 * Everything that used to be a landing page lives behind "עוד": /manifesto, /faq, /open.
 */
export async function GET() {
  const latest = await latestReleased();
  if (!latest) return new NextResponse(notFoundPage("עוד אין גיליון."), { status: 404, headers: HTML_HEADERS });
  const r = await renderLesson(latest.n, { banner: true, index: true });
  return new NextResponse(r.body, { status: r.status, headers: { ...HTML_HEADERS, "cache-control": "public, max-age=0, s-maxage=300, stale-while-revalidate=600" } });
}
