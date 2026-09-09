import { NextResponse } from "next/server";
import { DEMO_EDITION_N, getEdition, latestReleased } from "@/lib/editions";
import { APP } from "@/lib/config";
import { HTML_HEADERS, membersOnlyPage, notFoundPage, renderLesson } from "@/lib/lesson-page";
import { currentParent } from "@/lib/auth";
import { forgetKid, rememberKid, rememberedKidToken } from "@/lib/kidSession";
import { kidByToken } from "@/lib/kids";
import { hasDb } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /l/N?k=<token> — the lesson page. With a valid kid token the profile is injected; without one the
 * page runs in demo mode. `/l/today` redirects to the newest released edition.
 *
 * A token that works is remembered on the device, so the kid keeps their profile without carrying `?k=`
 * around. A signed-in parent is never treated as the kid: previewing a lesson from the dashboard must
 * stay demo mode, or the parent would be playing on their kid's account.
 */
export async function GET(req: Request, ctx: { params: Promise<{ n: string }> }) {
  const { n: nRaw } = await ctx.params;
  const url = new URL(req.url);
  const fromLink = url.searchParams.get("k") || "";

  const parent = fromLink ? null : await currentParent().catch(() => null);
  const remembered = fromLink || parent ? "" : await rememberedKidToken();
  const token = fromLink || remembered;

  if (nRaw === "today" || nRaw === "latest") {
    const latest = await latestReleased();
    if (!latest) return new NextResponse(notFoundPage("עוד אין גיליון."), { status: 404, headers: HTML_HEADERS });
    const q = fromLink ? `?k=${encodeURIComponent(fromLink)}` : "";
    return NextResponse.redirect(`${APP.url}/l/${latest.n}${q}`, 302);
  }
  const n = Number(nRaw);
  if (!Number.isInteger(n) || n < 1) return new NextResponse(notFoundPage("כתובת לא תקינה."), { status: 404, headers: HTML_HEADERS });

  // only the demo edition is open to everyone; the rest is for followers (a personal link or a signed-in parent)
  if (n !== DEMO_EDITION_N && !token && !parent) {
    if (!(await getEdition(n))) return new NextResponse(notFoundPage("הגיליון הזה עוד לא יצא."), { status: 404, headers: HTML_HEADERS });
    return new NextResponse(membersOnlyPage(n), { status: 200, headers: HTML_HEADERS });
  }
  const r = await renderLesson(n, { token, banner: !token, parent: parent ? { name: parent.name } : null });
  const res = new NextResponse(r.body, { status: r.status, headers: HTML_HEADERS });
  if (fromLink && r.kid) rememberKid(res, fromLink);
  // rendered in demo mode with a remembered token: rotated or deleted, forget it (a paused kid keeps the device)
  if (remembered && !r.kid && hasDb() && !(await kidByToken(remembered).catch(() => null))) forgetKid(res);
  return res;
}
