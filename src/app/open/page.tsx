import type { Metadata } from "next";
import { APP, DEMO_URL } from "@/lib/config";

export const metadata: Metadata = { title: "פתוח" };
export const dynamic = "force-static";

const REPOS = [
  { name: "daily-wow-kit", url: APP.kitRepo, blurb: "הערכה: מנוע העמוד, ההנחיות לשלושת התהליכים, העוזר. מי שרוצה מריץ את זה בעצמו, בשפה שלו, לילדים שלו." },
  { name: "daily-wow-editions", url: APP.editionsRepo, blurb: "כל הגיליונות שיצאו, אחד לכל יום, לתמיד." },
  { name: "daily-wow-app", url: APP.appRepo, blurb: "האתר הזה: ההרשמה, הלוח להורים, העוזר, המיילים." },
];

export default function Open() {
  return (
    <main className="prose">
      <h1>פתוח</h1>
      <p className="kicker">הקוד, הגיליונות והחשבונות. הכל בחוץ.</p>
      <ul className="list-plain">
        {REPOS.map((r) => (
          <li key={r.name}>
            <b>
              <a href={r.url} rel="noopener">{r.name}</a>
            </b>
            <small>{r.blurb}</small>
          </li>
        ))}
        <li>
          <b>
            <a href={DEMO_URL} rel="noopener">שיעור הדגמה</a>
          </b>
          <small>הגיליון הראשון, כמו שהוא יוצא מהערכה. סיסמת כניסה: demo.</small>
        </li>
        <li>
          <b>
            <a href="/open-books">ספרים פתוחים</a>
          </b>
          <small>כמה משפחות, כמה עלה העוזר, כמה נכנס. כל חודש.</small>
        </li>
        <li>
          <b>
            <a href="/library">ספריית הגיליונות</a>
          </b>
          <small>כל שיעור שיצא, אפשר להשלים מתי שרוצים.</small>
        </li>
      </ul>
      <p className="sig">רישיון MIT. תרומות, תיקונים ורעיונות מתקבלים בשמחה, ב-GitHub או במייל.</p>
    </main>
  );
}
