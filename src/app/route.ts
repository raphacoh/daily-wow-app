import { NextResponse } from "next/server";
import { DEMO_EDITION_N, getEdition } from "@/lib/editions";
import { HTML_HEADERS, notFoundPage, renderLesson } from "@/lib/lesson-page";
import { currentParent } from "@/lib/auth";
import { track, visitorHash } from "@/lib/analytics";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The front page IS a lesson, in demo mode, with the visitor strip on top. Show, don't tell.
 * Always edition 1: the other editions are for followers (a personal link or a signed-in parent).
 * Everything that used to be a landing page lives behind "עוד": /manifesto, /faq, /open.
 */
export async function GET(req: Request) {
  const latest = await getEdition(DEMO_EDITION_N);
  if (!latest) return new NextResponse(notFoundPage("עוד אין גיליון."), { status: 404, headers: HTML_HEADERS });
  const parent = await currentParent().catch(() => null);
  track("land", { visitor: visitorHash(req), edition_n: latest.n, props: { signed_in: !!parent } }).catch(() => {});
  const r = await renderLesson(latest.n, { banner: true, index: true, parent: parent ? { name: parent.name } : null });
  return new NextResponse(r.body, { status: r.status, headers: HTML_HEADERS });
}
