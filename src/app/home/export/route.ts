import { NextResponse } from "next/server";
import { NotSignedIn, requireParent } from "@/lib/auth";
import { exportFamily } from "@/lib/family";
import { APP } from "@/lib/config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /home/export — everything we hold about this family, as one JSON file (PRD §10). */
export async function GET() {
  let parentId: string;
  try {
    const parent = await requireParent();
    parentId = parent.id;
  } catch (e) {
    if (e instanceof NotSignedIn) return NextResponse.redirect(`${APP.url}/signin`, 302);
    throw e;
  }
  const data = await exportFamily(parentId);
  return new NextResponse(JSON.stringify(data, null, 2), {
    headers: {
      "content-type": "application/json; charset=utf-8",
      "content-disposition": 'attachment; filename="daily-wow-export.json"',
      "cache-control": "no-store",
    },
  });
}
