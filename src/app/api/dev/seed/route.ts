import { NextResponse } from "next/server";
import { hasDb } from "@/lib/db";
import { importFamilies, importLocalEditions } from "@/lib/importer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/dev/seed — development only (NODE_ENV !== 'production' and DEV_SEED=1).
 * Imports the local editions and one test family; returns the kids' personal links so the e2e test can use them.
 */
export async function POST() {
  if (process.env.NODE_ENV === "production" || process.env.DEV_SEED !== "1") return NextResponse.json({ error: "not_found" }, { status: 404 });
  if (!hasDb()) return NextResponse.json({ error: "no_db" }, { status: 503 });
  const editions = await importLocalEditions();
  // dev convenience: today's lesson is edition 1, so a completion counts for the streak
  const { db } = await import("@/lib/db");
  const { localDate } = await import("@/lib/progress");
  await db().query("update editions set date = $1 where n = (select max(n) from editions)", [localDate(new Date(), process.env.EDITOR_TIMEZONE || "Asia/Jerusalem")]);
  const families = await importFamilies({
    families: [
      {
        parentName: "רף",
        email: "dev-parent@example.com",
        consent: true,
        is_editor: true,
        kids: [
          { name: "אמה", feminine: true, age: 11, grade: "ו", level: "on_track" },
          { name: "אדם", feminine: false, age: 9, grade: "ד", level: "advanced" },
          { name: "נועה", feminine: true, age: 8, grade: "ג", level: "support" },
        ],
      },
    ],
  });
  return NextResponse.json({ editions, families });
}
