import { NextResponse } from "next/server";
import { HTML_HEADERS, notFoundPage, renderLesson } from "@/lib/lesson-page";
import { NotSignedIn, requireEditor } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /admin/preview/N — the editor's review copy of an edition that has not been released.
 *
 * It goes through the same `renderLesson` path as `/l/N`, so what the editor judges is exactly what a
 * kid will get: the same wrapper, the same runtime bootstrap, the same gamification runtime. Demo mode
 * (no kid token), so previewing never plays on a real child's account, and the daily password is shown
 * in the banner instead of shipped in the page.
 *
 * Editor session only — the bearer key is for the pipeline, not for a page a browser renders.
 */
export async function GET(_req: Request, ctx: { params: Promise<{ n: string }> }) {
  const { n: nRaw } = await ctx.params;
  try {
    await requireEditor();
  } catch (e) {
    if (e instanceof NotSignedIn) {
      return NextResponse.redirect(`/signin?next=${encodeURIComponent(`/admin/preview/${nRaw}`)}`, 302);
    }
    throw e;
  }

  const n = Number(nRaw);
  if (!Number.isInteger(n) || n < 1) {
    return new NextResponse(notFoundPage("כתובת לא תקינה."), { status: 404, headers: HTML_HEADERS });
  }

  const r = await renderLesson(n, { draft: true });
  return new NextResponse(r.body, { status: r.status, headers: HTML_HEADERS });
}
