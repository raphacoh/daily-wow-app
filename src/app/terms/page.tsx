/**
 * Terms (PRD §5.8). Same rules as /privacy: plain Hebrew, a short English summary, no legalese theatre.
 */
import type { Metadata } from "next";
import { APP } from "@/lib/config";
import { t } from "@/i18n";

export const metadata: Metadata = { title: "תנאי שימוש", description: "מה חינם, מה עולה, איך מבטלים, ומה אנחנו לא מבטיחים." };

export default function Terms() {
  return (
    <main className="page">
      <h1>{t("terms.title")}</h1>
      <p className="lede cap">
        מה חינם, מה עולה, איך מבטלים, ומה אני לא יכול להבטיח. עודכן ב־<span className="num">8</span> בספטמבר <span className="num">2026</span>.
      </p>

      <h2>מה זה</h2>
      <p>
        {APP.name} הוא שיעור יומי אחד לילדים, שנבנה בלילה על ידי AI ונקרא ונערך על ידי {APP.editorName} לפני שהוא יוצא. השירות מופעל על ידי אדם פרטי,
        לא על ידי חברה, והוא נועד ללימוד בבית — לא כתחליף לבית ספר ולא כשירות חינוכי מוסדי.
      </p>

      <h2>מי פותח חשבון</h2>
      <p>
        רק הורה או אפוטרופוס, מגיל <span className="num">18</span>. אתם אחראים על החשבון, על הילדים שרשמתם, ועל השמירה של הקישורים האישיים שלהם. הילדים
        לא פותחים חשבון ולא מתחברים.
      </p>

      <h2>מה חינם</h2>
      <p>השיעור עצמו, הסימולציות, המבחן, הסיסמה הסודית, הרצף, הלוח וכל הארכיון — חינם, ובכוונה שיישארו חינם.</p>

      <h2>מה עולה</h2>
      <p>
        רק החלק ששורף טוקנים על כל שימוש: ארטו (העוזר) והבדיקה האוטומטית של ההסבר. <span className="num">10</span> ₪ לחודש לילד/ה, במחיר העלות. בלי
        מנוי, ארטו עונה על <span className="num">3</span> שאלות ביום, וזה עליי. המספרים מתפרסמים כל חודש ב<a href="/open-books">ספרים הפתוחים</a>, ואם
        יתברר שהמחיר גבוה מהעלות — הוא ירד.
      </p>
      <p>
        החיוב חודשי ומתחדש מאליו, דרך ספק התשלומים Dodo Payments. פרטי האשראי לא עוברים דרכנו. אם המחיר ישתנה, תקבלו הודעה במייל לפני שהחיוב הבא יוצא.
      </p>

      <h2>ביטול</h2>
      <p>
        אפשר לבטל בכל רגע, בלחיצה אחת מהלוח. הביטול נכנס לתוקף בסוף תקופת החיוב ששולמה — כלומר ארטו ממשיך לעבוד עד אז, ואין חיוב נוסף. בלי החזרים
        חלקיים על ימים שלא נוצלו, ובלי קנסות. אפשר גם למחוק את החשבון לגמרי; ראו <a href="/privacy">פרטיות</a>.
      </p>

      <h2>על התוכן</h2>
      <p>
        השיעורים נבנים על ידי מודלים של AI ונקראים, מתוקנים ומשופרים על ידי {APP.editorName} לפני הפרסום. זו עריכה של אדם, לא ביקורת עמיתים אקדמית:
        ייתכנו טעויות, פישוטים והשמטות. ארטו, כמו כל מודל שפה, יכול לטעות בביטחון מלא.
      </p>
      <p>
        אם מצאתם טעות — <a href={`mailto:${APP.editorEmail}`}>כתבו לי</a> ואתקן, בדרך כלל באותו יום. זה לא טופס תמיכה, זה המייל שלי.
      </p>

      <h2>שימוש הוגן</h2>
      <p>
        הקישור האישי של הילד/ה נועד לילד/ה אחד/ת. אל תפרסמו אותו ואל תשתפו אותו הלאה — מי שמחזיק בקישור יכול לפתוח את השיעורים ולהשתמש בארטו על
        חשבונכם. אסור לגרד את האתר אוטומטית, לעקוף מגבלות שימוש, או להשתמש בארטו למשהו שהוא לא לימוד. אני יכול לסגור חשבון שעושה את זה, ולהחזיר כסף
        על תקופה שלא נוצלה.
      </p>

      <h2>קוד ותוכן פתוחים</h2>
      <p>
        המנוע וההנחיות פתוחים ב־<a href={APP.kitRepo} rel="noopener">GitHub</a>, וגם הגיליונות עצמם. מותר להריץ את זה בעצמכם, ללמד איתו ולשנות אותו,
        לפי הרישיון שבמאגר. השירות כאן הוא הדלת הנוחה, לא חומה.
      </p>

      <h2>מה אני לא מבטיח</h2>
      <p>
        השירות ניתן כמו שהוא. אני לא מבטיח שהוא יעבוד בלי הפסקה, שהמייל יגיע בדיוק בשעה, שלא יהיו טעויות בתוכן, או שילד יאהב דווקא את השיעור של יום
        שלישי. אין אחריות מכל סוג, ואין אחריות לנזק עקיף. אם משהו נשבר, האחריות שלי מוגבלת למה ששילמתם בשלושת החודשים האחרונים — ובפועל, כנראה פשוט
        אתקן את זה.
      </p>

      <h2>שינויים ודין</h2>
      <p>
        אם התנאים ישתנו מהותית, תקבלו מייל. הדין החל הוא הדין הישראלי, וסמכות השיפוט הבלעדית נתונה לבתי המשפט במחוז חיפה.
      </p>

      <hr />
      <h2 lang="en" dir="ltr">
        In short (English)
      </h2>
      <div lang="en" dir="ltr">
        <p>
          The daily lesson, the test, the password, the streak and the whole archive are free and meant to stay free. Only the part that burns tokens
          per use — the Arto assistant and the AI grading of the &quot;explain it back&quot; answer — costs money: ₪10 per kid per month, at cost, with
          the monthly figures published on the open books page. Without a subscription Arto still answers 3 questions a day, on me.
        </p>
        <p>
          Cancel any time from your dashboard; cancellation takes effect at the end of the period you already paid for, with no partial refunds and no
          penalties. Only a parent or guardian may open an account, and a child&apos;s personal link is for that child — don&apos;t share it.
        </p>
        <p>
          Lessons are built by AI models and then read, corrected and improved by {APP.editorName} before release. That is one person&apos;s editing,
          not peer review: mistakes are possible, and Arto can be confidently wrong. Found one? Write to {APP.editorEmail} and I will fix it. The
          service is provided as is, with no warranty of any kind. Israeli law applies; the courts of the Haifa district have exclusive jurisdiction.
        </p>
      </div>
    </main>
  );
}
