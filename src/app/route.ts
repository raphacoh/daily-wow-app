import { NextResponse } from "next/server";
import { DEMO_EDITION_N, getEdition, latestReleased } from "@/lib/editions";
import { HTML_HEADERS, notFoundPage, renderLesson } from "@/lib/lesson-page";
import { currentParent } from "@/lib/auth";
import { forgetKid, rememberedKidToken } from "@/lib/kidSession";
import { kidByToken } from "@/lib/kids";
import { hasDb } from "@/lib/db";
import { APP } from "@/lib/config";
import { track, visitorHash } from "@/lib/analytics";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** the answer depends on who is asking: never let a proxy cache this door */
const NO_STORE = { "cache-control": "private, no-store" };

/**
 * The front door, by who is knocking:
 *   a signed-in parent  → the dashboard (every lesson is one click away from there, in demo mode);
 *   a remembered kid    → today's lesson, with their profile;
 *   everyone else       → the demo lesson with the visitor strip. Show, don't tell.
 * Always edition 1 for the visitor: the other editions are for followers.
 * Everything that used to be a landing page lives behind "עוד": /manifesto, /faq, /open.
 */
export async function GET(req: Request) {
  const parent = await currentParent().catch(() => null);
  if (parent) return NextResponse.redirect(`${APP.url}/home`, { status: 302, headers: NO_STORE });

  const remembered = await rememberedKidToken();
  const kid = remembered && hasDb() ? await kidByToken(remembered).catch(() => null) : null;
  if (kid && !kid.paused) {
    const today = await latestReleased();
    if (today) return NextResponse.redirect(`${APP.url}/l/${today.n}`, { status: 302, headers: NO_STORE });
  }

  const latest = await getEdition(DEMO_EDITION_N);
  if (!latest) return new NextResponse(notFoundPage("עוד אין גיליון."), { status: 404, headers: HTML_HEADERS });
  track("land", { visitor: visitorHash(req), edition_n: latest.n, props: { signed_in: false } }).catch(() => {});
  const r = await renderLesson(latest.n, { banner: true, index: true });
  const res = new NextResponse(r.body, { status: r.status, headers: HTML_HEADERS });
  // a paused kid keeps the device; only a token that no longer belongs to anyone is dropped
  if (remembered && hasDb() && !kid) forgetKid(res);
  return res;
}
