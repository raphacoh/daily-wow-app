/**
 * The footer link of every mail lands here. It asks before removing (link scanners open every URL in a
 * mail, so a GET must never unsubscribe anyone) and offers an undo afterwards.
 */
import type { Metadata } from "next";
import { APP } from "@/lib/config";
import { hasDb } from "@/lib/db";
import { emailFromToken, isUnsubscribed } from "@/lib/unsubscribe";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "הסרה מרשימת התפוצה", robots: { index: false, follow: false } };

export default async function UnsubscribePage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const u = Array.isArray(sp.u) ? sp.u[0] : sp.u;
  const email = emailFromToken(u);

  if (!email) {
    return (
      <main className="page">
        <h1>הסרה מרשימת התפוצה</h1>
        <p className="msg bad">הקישור הזה לא שלם. אפשר פשוט להשיב לאחד המיילים ולכתוב &quot;הסר&quot; — אטפל בזה בעצמי.</p>
      </main>
    );
  }

  const off = hasDb() ? await isUnsubscribed(email) : false;
  const action = `/api/unsubscribe?u=${encodeURIComponent(u!)}`;

  return (
    <main className="page">
      <h1>הסרה מרשימת התפוצה</h1>
      {off ? (
        <>
          <p className="msg ok">
            הכתובת <span dir="ltr">{email}</span> הוסרה. לא יגיעו אליה יותר שיעורים ועדכונים מ{APP.name}.
          </p>
          <form method="post" action={`${action}&undo=1`}>
            <button type="submit" className="btn ghost small">הוסרתי בטעות — להחזיר</button>
          </form>
        </>
      ) : (
        <>
          <p className="lede">
            להפסיק לשלוח מיילים ל־<span dir="ltr">{email}</span>?
          </p>
          <form method="post" action={action}>
            <button type="submit" className="btn">כן, להסיר</button>
          </form>
        </>
      )}
    </main>
  );
}
