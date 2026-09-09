import { NextResponse } from "next/server";
import { guard } from "@/lib/adminAuth";
import { hasDb } from "@/lib/db";
import { getEdition } from "@/lib/editions";
import { activeFamilies, dailyRecipients } from "@/lib/jobs";
import { kidLink, liveStreak } from "@/lib/kids";
import { dailyMail } from "@/lib/emails";
import { APP } from "@/lib/config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/admin/editions/N/send-manifest — everything needed to send the daily email from a second sender
 * (the editor's own Gmail, via the release routine): per family, the recipients, the subject and the plain-text
 * body with each kid's personal link. Same content the app sends from hello@; the parent's reply still reaches
 * the editor. Editor only.
 */
export async function GET(req: Request, ctx: { params: Promise<{ n: string }> }) {
  const denied = await guard(req);
  if (denied) return denied;
  if (!hasDb()) return NextResponse.json({ error: "no_db" }, { status: 503 });
  const { n: nRaw } = await ctx.params;
  const n = Number(nRaw);
  const edition = await getEdition(n, { includeStaged: true });
  if (!edition) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const families = await activeFamilies(edition.language || "he");
  const now = new Date();
  const out = [];
  for (const f of families) {
    const kids = [];
    for (const k of f.kids) {
      kids.push({
        name: k.name,
        feminine: k.feminine,
        link: kidLink(k, APP.url, n) ?? `${APP.url}/l/${n}`,
        streak: await liveStreak(String(k.id), f.parent.timezone || APP.timezone, now),
      });
    }
    const mail = dailyMail({
      to: dailyRecipients(f),
      editionN: n,
      editionTitle: edition.title,
      editionDate: String(edition.date).slice(0, 10),
      teaser: edition.teaser || "",
      editorNote: edition.editor_note ?? undefined,
      kids,
      replyTo: APP.editorEmail,
    });
    out.push({ parent: f.parent.name, to: mail.to, subject: mail.subject, text: mail.text });
  }
  return NextResponse.json({ n, title: edition.title, status: edition.status, families: out.length, messages: out }, { headers: { "cache-control": "no-store" } });
}
