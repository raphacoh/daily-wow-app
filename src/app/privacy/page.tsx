/**
 * Privacy (PRD §5.8, §10). Plain-language Hebrew — the whole point is that a parent can read it in
 * three minutes — with a short English summary at the end. Prose lives here rather than in the
 * dictionary: it is a document, not UI, and the numbers inside it need their own `.num` isolation.
 */
import type { Metadata } from "next";
import { APP } from "@/lib/config";
import { t } from "@/i18n";

export const metadata: Metadata = { title: "פרטיות", description: "מה אנחנו שומרים על הילד/ה שלכם, למה, לכמה זמן, ואיך מוחקים הכל." };

export default function Privacy() {
  return (
    <main className="page">
      <h1>{t("privacy.title")}</h1>
      <p className="lede cap">
        בלי עורכי דין ובלי אותיות קטנות. זה מה שאנחנו שומרים, למה, לכמה זמן, ואיך מוחקים את הכל. עודכן ב־<span className="num">8</span> בספטמבר{" "}
        <span className="num">2026</span>.
      </p>

      <h2>מה אנחנו שומרים על הילד/ה</h2>
      <ul>
        <li>שם פרטי — כדי שהשיעור ידבר אליו/אליה בשם.</li>
        <li>בן או בת — רק בשביל הדקדוק. בעברית כל פועל בשיעור מנוסח בלשון זכר או נקבה, ואין דרך לכתוב משפט בלי לבחור.</li>
        <li>גיל, כיתה ורמה — כדי לבחור את גרסת השיעור המתאימה.</li>
        <li>מייל של הילד/ה — רק אם מילאתם אותו. אפשר בלי, ואז הקישור מגיע רק אליכם.</li>
        <li>תוצאות: ניקוד לכל גיליון, האם הושלם, מתי, ורצף הימים.</li>
        <li>מוני שימוש בעוזר (ארטו): כמה שאלות נשאלו ובאיזה יום, ותג שאומר אם השאלה הייתה בנושא השיעור.</li>
      </ul>
      <p>
        מה שהילד/ה כותב/ת בשדה &quot;עכשיו אתם המורים&quot; — ההסבר במילים שלו/שלה — נשלח לבדיקה ונמחק מיד אחריה. הוא נשמר אצלנו רק אם אתם מדליקים את
        האפשרות &quot;לשמור את ההסברים&quot; בלוח שלכם. ברירת המחדל היא כבוי.
      </p>

      <h2>מה אנחנו שומרים עליכם, ההורים</h2>
      <p>שם, כתובת מייל (זו גם הכניסה), אזור זמן, והעדפות ההתראות. אם הוספתם מבוגר נוסף שמקבל את השיעור — שם ומייל שלו. זה הכל.</p>

      <h2>למה</h2>
      <p>
        כדי לבנות את השיעור בגרסה הנכונה, לשלוח אותו למייל, לספור את הרצף והנקודות, ולתת לעוזר להסביר. אין פרסומות, אין פרופיילינג, ואנחנו לא מוכרים
        ולא משתפים את המידע עם אף אחד. הבסיס החוקי הוא ההסכמה שלכם בהרשמה, לפי חוק הגנת הפרטיות, התשמ&quot;א־<span className="num">1981</span>.
      </p>

      <h2>ילדים מתחת לגיל 13</h2>
      <p>
        ההורה נרשם, ההורה מסכים, וההורה יכול למחוק. הילד/ה לא נרשם/ת, לא מתחבר/ת, ולא מזין/ה שום דבר מלבד התשובות בשיעור. הוא/היא נכנס/ת דרך קישור
        אישי אחד — בלי סיסמה ובלי חשבון.
      </p>

      <h2>העוזר (ארטו)</h2>
      <p>
        ארטו נעול על החומר של השיעור: הוא לא שואל שאלות אישיות, לא נותן קישורים החוצה, ולא נכנס לנושאים רפואיים, משפטיים או מבוגרים. שאלה שחורגת
        מהתחום מקבלת תשובה בסגנון &quot;זו שאלה להורים שלך&quot;.
      </p>
      <p>
        אנחנו לא שומרים את השיחות. לכל שאלה נשמרת שורת שימוש עם תג התחום בלבד. שאלות שחרגו מהנושא נשמרות באופן אנונימי (בלי שם ובלי קישור לילד/ה)
        למשך <span className="num">7</span> ימים, כדי שנוכל לשפר את הגבולות של ארטו, ואז נמחקות אוטומטית.
      </p>

      <h2>לכמה זמן</h2>
      <p>
        כל עוד החשבון פעיל. מחקתם ילד/ה — הנתונים שלו/שלה נמחקים. מחקתם חשבון — נמחקים ההורים, הילדים, התוצאות ואנשי הקשר. מה שנשאר הוא מספרים
        מצטברים ואנונימיים (כמה שאלות, כמה עלו) שמזינים את דף <a href="/open-books">הספרים הפתוחים</a>, ואי אפשר לחזור מהם לאף אדם.
      </p>

      <h2>איך מוציאים או מוחקים</h2>
      <p>
        מהלוח שלכם: &quot;ייצוא המידע שלי&quot; מוריד קובץ JSON עם הכל, ו&quot;מחיקת חשבון&quot; מוחקת. אם משהו לא עובד או שאתם רוצים מחיקה מלאה
        בכתב — <a href={`mailto:${APP.editorEmail}`}>כתבו לי</a> ואטפל בזה בעצמי.
      </p>

      <h2>מי עוד רואה את המידע</h2>
      <ul>
        <li>Supabase — מסד הנתונים והכניסה.</li>
        <li>Resend — שליחת המיילים.</li>
        <li>Anthropic — העוזר והבדיקה של ההסבר. נשלח אליהם החומר של השיעור והשאלה, בלי שם ובלי מייל.</li>
        <li>Dodo Payments — התשלום. פרטי האשראי מגיעים אליהם ישירות ולא עוברים דרכנו אף פעם.</li>
      </ul>
      <p>
        באתר עצמו אין סקריפטים של צד שלישי, אין כלי אנליטיקה, אין פיקסלים ואין קובצי מעקב. אם נצטרך לספור כניסות, נספור בשרת שלנו.
      </p>

      <h2>שאלות</h2>
      <p>
        זה פרויקט של הורה אחד, לא חברה עם מוקד. <a href={`mailto:${APP.editorEmail}`}>{APP.editorEmail}</a> — אני קורא הכל ועונה. הדין החל הוא הדין
        הישראלי, וסמכות השיפוט היא של בתי המשפט בישראל.
      </p>

      <hr />
      <h2 lang="en" dir="ltr">
        In short (English)
      </h2>
      <div lang="en" dir="ltr">
        <p>
          About your child we store: first name, boy/girl (Hebrew grammar needs it), age, grade, level, an optional email address, lesson results, and
          assistant usage counters. The &quot;explain it back&quot; text is graded and discarded unless you switch on &quot;keep explanations&quot;
          (off by default). About you: name, email, timezone, notification preferences.
        </p>
        <p>
          We use it to build and send the right version of the lesson and to run the assistant. No ads, no tracking, no third-party scripts, nothing
          sold or shared. The assistant is scope-locked to the lesson; we log a scope tag, not conversations, and off-topic prompts are kept
          anonymised for 7 days, then deleted. Kids never register or sign in — a parent registers and consents, and children under 13 enter nothing
          but their lesson answers.
        </p>
        <p>
          Export everything as JSON or delete your account from your dashboard, or write to {APP.editorEmail} and I will do it. Data is kept while the
          account is open; only anonymous aggregates survive deletion, for the open books page. Israeli law applies (Privacy Protection Law,
          1981).
        </p>
      </div>
    </main>
  );
}
