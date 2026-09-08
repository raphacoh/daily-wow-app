/**
 * Email templates + sending for "שורשים וכנפיים" (Roots and Wings).
 *
 * Self-contained on purpose: the only imports are `./config` and the `resend`
 * package. Every template returns a `Mail` (html + a plain-text alternative),
 * so templates can be unit-tested without touching the network.
 *
 * House rules baked in here:
 *  - Warm, plain, first-person parent voice (the editor talking to parents).
 *  - No marketing exclamation marks, no "unlock", no countdowns.
 *  - No price in anything a kid could read.
 *  - The password of the day NEVER appears in the daily mail — only in the
 *    completion mail, which is a parent-facing receipt.
 */
import { Resend } from "resend";
import { APP } from "./config";

/* ------------------------------------------------------------------ *
 * Types
 * ------------------------------------------------------------------ */

export interface Mail {
  to: string[];
  subject: string;
  html: string;
  text: string;
  replyTo?: string;
}

/** Templates accept either a single address or a list. */
export type Recipients = string | string[];

export interface KidLink {
  name: string;
  feminine: boolean;
  link: string;
}

export interface KidDaily extends KidLink {
  streak: number;
}

export interface WeekDay {
  date: string;
  done: boolean;
  score?: number;
}

export interface KidWeek {
  name: string;
  feminine: boolean;
  days: WeekDay[];
  /** badges earned this week (names) */
  badges: string[];
  /** one line about the week's medals and cards, e.g. "2 זהב, 1 כסף · 3 קלפים חדשים" (gamification P0) */
  collection?: string;
}

export type BillingKind = "payment_failed" | "ended" | "active";

/* ------------------------------------------------------------------ *
 * Small helpers
 * ------------------------------------------------------------------ */

/** HTML-escape anything that gets interpolated into a template. */
export function esc(s: string | number | null | undefined): string {
  if (s === null || s === undefined) return "";
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Latin digits / URLs inside Hebrew text need an explicit LTR run. */
function ltr(s: string | number): string {
  return `<span dir="ltr">${esc(s)}</span>`;
}

function normaliseTo(to: Recipients): string[] {
  const list = Array.isArray(to) ? to : [to];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of list) {
    if (typeof raw !== "string") continue;
    const trimmed = raw.trim();
    if (!trimmed) continue;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(trimmed);
  }
  return out;
}

/** The editor's first name — how she/he signs off. */
const EDITOR_FIRST = APP.editorName.trim().split(/\s+/)[0] || APP.editorName;

const LIBRARY_URL = `${APP.url}/library`;
/** The library scoped to one kid: same token as the personal link, so older editions open as that kid. */
function libraryFor(link: string): string {
  try {
    const k = new URL(link).searchParams.get("k");
    return k ? `${LIBRARY_URL}?k=${encodeURIComponent(k)}` : LIBRARY_URL;
  } catch {
    return LIBRARY_URL;
  }
}
const OPEN_BOOKS_URL = `${APP.url}/open-books`;
const HOME_URL = `${APP.url}/home`;

/* ------------------------------------------------------------------ *
 * Palette / layout
 * ------------------------------------------------------------------ */

const PAPER = "#FBF5E6";
const INK = "#1E2140";
const SUN = "#F4A100";
const TEAL = "#167C8A";
const MUTED = "#6B6A7D";
const LINE = "#E7DFCB";
const FONT = "Rubik, Arial, sans-serif";

const P = `margin:0 0 14px;font-family:${FONT};font-size:16px;line-height:1.7;color:${INK};`;
const SMALL = `margin:0 0 10px;font-family:${FONT};font-size:13px;line-height:1.6;color:${MUTED};`;
const A = `color:${TEAL};text-decoration:underline;`;

/** A table-based, email-client-safe button. */
export function button(href: string, label: string): string {
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 12px;">
  <tr><td style="background:${SUN};border-radius:10px;">
    <a href="${esc(href)}" style="display:inline-block;padding:12px 22px;font-family:${FONT};font-size:16px;font-weight:700;color:${INK};text-decoration:none;">${esc(label)}</a>
  </td></tr>
</table>`;
}

export interface LayoutArgs {
  title: string;
  bodyHtml: string;
  footerNote?: string;
}

/** The shared RTL shell every mail is poured into. Inline styles only. */
export function layout({ title, bodyHtml, footerNote }: LayoutArgs): string {
  return `<!doctype html>
<html lang="he" dir="rtl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title>
</head>
<body style="margin:0;padding:0;background:${PAPER};">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${PAPER};padding:24px 12px;">
  <tr>
    <td align="center">
      <table role="presentation" width="560" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:560px;background:${PAPER};">
        <tr>
          <td style="padding:0 0 18px;">
            <table role="presentation" cellpadding="0" cellspacing="0" border="0">
              <tr>
                <td width="30" style="padding:0 0 0 10px;">
                  <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
                    <td width="22" height="22" style="width:22px;height:22px;background:${SUN};border-radius:11px;line-height:22px;font-size:0;">&nbsp;</td>
                  </tr></table>
                </td>
                <td style="font-family:${FONT};font-size:17px;font-weight:700;color:${INK};letter-spacing:.2px;">${esc(APP.name)}</td>
              </tr>
            </table>
          </td>
        </tr>
        <tr>
          <td style="padding:0 0 8px;font-family:${FONT};font-size:21px;line-height:1.4;font-weight:700;color:${INK};">${esc(title)}</td>
        </tr>
        <tr>
          <td style="padding:8px 0 0;">${bodyHtml}</td>
        </tr>
        <tr>
          <td style="padding:22px 0 0;">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
              <tr><td style="border-top:1px solid ${LINE};font-size:0;line-height:0;">&nbsp;</td></tr>
            </table>
          </td>
        </tr>
        <tr>
          <td style="padding:14px 0 0;">
            ${footerNote ? `<p style="${SMALL}">${esc(footerNote)}</p>` : ""}
            <p style="margin:0 0 8px;font-family:${FONT};font-size:15px;color:${INK};">${esc(EDITOR_FIRST)}</p>
            <p style="${SMALL}">אפשר פשוט להשיב למייל הזה — זה מגיע ישר אליי.</p>
            <p style="${SMALL}">
              <a href="${esc(APP.url)}" style="${A}">${esc(APP.name)}</a>
              &nbsp;·&nbsp;<a href="${esc(LIBRARY_URL)}" style="${A}">כל הגיליונות</a>
              &nbsp;·&nbsp;<a href="${esc(OPEN_BOOKS_URL)}" style="${A}">הספרים הפתוחים</a>
              &nbsp;·&nbsp;<a href="${esc(APP.kitRepo)}" style="${A}">GitHub</a>
            </p>
          </td>
        </tr>
      </table>
    </td>
  </tr>
</table>
</body>
</html>`;
}

/** Plain-text counterpart of the layout footer. Never contains HTML tags. */
function textFooter(footerNote?: string): string {
  const lines: string[] = [];
  if (footerNote) lines.push(footerNote, "");
  lines.push(
    EDITOR_FIRST,
    "אפשר פשוט להשיב למייל הזה — זה מגיע ישר אליי.",
    "",
    `${APP.name}: ${APP.url}`,
    `כל הגיליונות: ${LIBRARY_URL}`,
    `הספרים הפתוחים: ${OPEN_BOOKS_URL}`,
    `GitHub: ${APP.kitRepo}`,
  );
  return lines.join("\n");
}

/** Assemble a plain-text mail body: title, paragraphs, footer. */
function textBody(title: string, blocks: (string | null | undefined)[], footerNote?: string): string {
  const body = blocks.filter((b): b is string => typeof b === "string" && b.trim() !== "").join("\n\n");
  return `${title}\n\n${body}\n\n---\n${textFooter(footerNote)}\n`;
}

function p(html: string): string {
  return `<p style="${P}">${html}</p>`;
}

function small(html: string): string {
  return `<p style="${SMALL}">${html}</p>`;
}

/* ------------------------------------------------------------------ *
 * Sending
 * ------------------------------------------------------------------ */

const NOT_CONFIGURED = "resend_not_configured";

export type Mailer = (mail: Mail) => Promise<{ id: string | null }>;

let mailer: Mailer | null = null;

/**
 * Replace the transport. Tests (and a future "preview outbox" in /admin) set this to observe mails
 * without touching Resend; `setMailer(null)` restores the real one. Templates are unaffected.
 */
export function setMailer(fn: Mailer | null): void {
  mailer = fn;
}

function apiKey(): string | undefined {
  const k = process.env.RESEND_API_KEY;
  return k && k.trim() ? k.trim() : undefined;
}

function warnNotConfigured(what: string): void {
  console.warn(`[emails] RESEND_API_KEY is not set — skipping ${what}`);
}

/**
 * Send one mail. Never throws when Resend isn't configured (local dev, CI):
 * it logs a single line and reports back that it skipped.
 */
export async function sendMail(mail: Mail): Promise<{ id: string | null; skipped?: string }> {
  const to = normaliseTo(mail.to);
  if (mailer) {
    if (to.length === 0) return { id: null, skipped: "no_recipients" };
    return mailer({ ...mail, to });
  }
  const key = apiKey();
  if (!key) {
    warnNotConfigured(`"${mail.subject}"`);
    return { id: null, skipped: NOT_CONFIGURED };
  }
  if (to.length === 0) return { id: null, skipped: "no_recipients" };

  const resend = new Resend(key);
  const { data, error } = await resend.emails.send({
    from: APP.fromEmail,
    to,
    subject: mail.subject,
    html: mail.html,
    text: mail.text,
    ...(mail.replyTo ? { replyTo: mail.replyTo } : {}),
  });
  if (error) throw new Error(`resend: ${error.message ?? String(error)}`);
  return { id: data?.id ?? null };
}

/**
 * Send many mails through Resend's batch endpoint, 100 at a time.
 * Same "not configured" behaviour as `sendMail`.
 */
export async function sendBatch(mails: Mail[]): Promise<{ ids: string[]; sent: number; skipped?: string }> {
  const prepared = mails
    .map((m) => ({ ...m, to: normaliseTo(m.to) }))
    .filter((m) => m.to.length > 0);

  if (mailer) {
    const ids: string[] = [];
    for (const m of prepared) {
      const r = await mailer(m);
      if (r.id) ids.push(r.id);
    }
    return { ids, sent: prepared.length };
  }
  const key = apiKey();
  if (!key) {
    warnNotConfigured(`a batch of ${prepared.length} mails`);
    return { ids: [], sent: 0, skipped: NOT_CONFIGURED };
  }
  if (prepared.length === 0) return { ids: [], sent: 0 };

  const resend = new Resend(key);
  const ids: string[] = [];
  for (let i = 0; i < prepared.length; i += 100) {
    const chunk = prepared.slice(i, i + 100).map((m) => ({
      from: APP.fromEmail,
      to: m.to,
      subject: m.subject,
      html: m.html,
      text: m.text,
      ...(m.replyTo ? { replyTo: m.replyTo } : {}),
    }));
    const { data, error } = await resend.batch.send(chunk);
    if (error) throw new Error(`resend batch: ${error.message ?? String(error)}`);
    for (const row of data?.data ?? []) if (row?.id) ids.push(row.id);
  }
  return { ids, sent: prepared.length };
}

/* ------------------------------------------------------------------ *
 * Shared copy bits
 * ------------------------------------------------------------------ */

function streakLine(streak: number, feminine: boolean): string {
  if (streak > 0) return `רצף של ${streak} ימים`;
  return feminine ? "עוד לא התחילה רצף — היום זה היום" : "עוד לא התחיל רצף — היום זה היום";
}

function streakLineHtml(streak: number, feminine: boolean): string {
  if (streak > 0) return `רצף של ${ltr(streak)} ימים`;
  return esc(streakLine(streak, feminine));
}

function did(feminine: boolean): string {
  return feminine ? "סיימה" : "סיים";
}

function hello(parentName?: string): string {
  return parentName && parentName.trim() ? `היי ${parentName.trim()},` : "היי,";
}

/* ------------------------------------------------------------------ *
 * 1. Welcome
 * ------------------------------------------------------------------ */

export interface WelcomeArgs {
  to: Recipients;
  parentName?: string;
  kids: KidLink[];
  editionTitle: string;
  editionN: number;
}

export function welcomeMail({ to, parentName, kids, editionTitle, editionN }: WelcomeArgs): Mail {
  const title = "נעים מאוד — ככה זה עובד";
  const kidButtons = kids
    .map(
      (k) =>
        `${small(`${esc(k.name)} — גיליון #${ltr(editionN)}`)}${button(k.link, `לשיעור של ${k.name}`)}`,
    )
    .join("\n");

  const bodyHtml = [
    p(esc(hello(parentName))),
    p(
      `נרשמתם ל${esc(APP.name)}. מחר בסביבות ${ltr("11:00")} יגיע לכאן גיליון חדש, ואחריו עוד אחד כל יום — שיעור קצר אחד, שאני עובר עליו בעצמי לפני שהוא נשלח.`,
    ),
    p(`בינתיים, הגיליון של היום מחכה: ${esc(editionTitle)}.`),
    kidButtons,
    p(
      `וגם כל הגיליונות שיצאו לפני שהצטרפתם פתוחים: ${kids.map((k) => `<a href="${esc(libraryFor(k.link))}" style="${A}">הספרייה של ${esc(k.name)}</a>`).join(" · ")}. הנקודות נספרות, הרצף לא.`,
    ),
    p(
      `על הסיסמה: בסוף המבחן הילד או הילדה מקבלים סיסמה סודית, ואומרים לכם אותה בעל פה. מה שאתם עושים עם הסיסמה — זמן מסך, ממתק, סתם ד"ש טוב — זה כבר לגמרי שלכם.`,
    ),
    p(`אפשר לשנות רמה לכל ילד בכל רגע, בלוח הבקרה: <a href="${esc(HOME_URL)}" style="${A}">${esc(HOME_URL)}</a>`),
  ].join("\n");

  const text = textBody(title, [
    hello(parentName),
    `נרשמתם ל${APP.name}. מחר בסביבות 11:00 יגיע לכאן גיליון חדש, ואחריו עוד אחד כל יום — שיעור קצר אחד, שאני עובר עליו בעצמי לפני שהוא נשלח.`,
    `בינתיים, הגיליון של היום מחכה: ${editionTitle}.`,
    ...kids.map((k) => `הספרייה של ${k.name} (כל הגיליונות הקודמים): ${libraryFor(k.link)}`),
    kids.map((k) => `לשיעור של ${k.name} (גיליון #${editionN}): ${k.link}`).join("\n"),
    `על הסיסמה: בסוף המבחן הילד או הילדה מקבלים סיסמה סודית, ואומרים לכם אותה בעל פה. מה שאתם עושים עם הסיסמה — זמן מסך, ממתק, סתם ד"ש טוב — זה כבר לגמרי שלכם.`,
    `אפשר לשנות רמה לכל ילד בכל רגע, בלוח הבקרה: ${HOME_URL}`,
  ]);

  return {
    to: normaliseTo(to),
    subject: `נעים מאוד — ${APP.name} מתחיל מחר`,
    html: layout({ title, bodyHtml }),
    text,
    replyTo: APP.editorEmail,
  };
}

/* ------------------------------------------------------------------ *
 * 2. Daily edition — never contains the password
 * ------------------------------------------------------------------ */

export interface DailyArgs {
  to: Recipients;
  editionN: number;
  editionTitle: string;
  editionDate: string;
  teaser: string;
  editorNote?: string;
  kids: KidDaily[];
  replyTo?: string;
}

export function dailyMail({
  to,
  editionN,
  editionTitle,
  editionDate,
  teaser,
  editorNote,
  kids,
  replyTo,
}: DailyArgs): Mail {
  const subject = `🤯 ${APP.name} #${editionN} · ${editionTitle}`;
  const title = editionTitle;

  const kidBlocks = kids
    .map((k) =>
      [
        `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 14px;">
  <tr><td style="padding:12px 14px;background:#FFFFFF;border:1px solid ${LINE};border-radius:12px;">
    <p style="margin:0 0 4px;font-family:${FONT};font-size:16px;font-weight:700;color:${INK};">${esc(k.name)}</p>
    <p style="margin:0 0 10px;font-family:${FONT};font-size:14px;color:${MUTED};">${streakLineHtml(k.streak, k.feminine)}</p>
    ${button(k.link, `לשיעור של ${k.name}`)}
  </td></tr>
</table>`,
      ].join("\n"),
    )
    .join("\n");

  const bodyHtml = [
    small(`גיליון #${ltr(editionN)} · ${esc(editionDate)}`),
    p(esc(teaser)),
    editorNote
      ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 16px;">
  <tr><td style="padding:12px 14px;background:#FFFFFF;border-right:3px solid ${SUN};border-radius:8px;">
    <p style="margin:0 0 4px;font-family:${FONT};font-size:13px;font-weight:700;color:${SUN};">הערה מרף</p>
    <p style="margin:0;font-family:${FONT};font-size:15px;line-height:1.7;color:${INK};">${esc(editorNote)}</p>
  </td></tr>
</table>`
      : "",
    kidBlocks,
    p(`המשימה של היום: כ־${ltr(25)} דקות, ובסוף — הסיסמה הסודית.`),
    small(
      `פספסתם יום? הכול נשאר פתוח בספרייה, אפשר להשלים מתי שנוח: ${kids.map((k) => `<a href="${esc(libraryFor(k.link))}" style="${A}">${esc(k.name)}</a>`).join(" · ")}.`,
    ),
  ]
    .filter(Boolean)
    .join("\n");

  const text = textBody(title, [
    `גיליון #${editionN} · ${editionDate}`,
    teaser,
    editorNote ? `הערה מרף: ${editorNote}` : "",
    kids
      .map((k) => `${k.name} — ${streakLine(k.streak, k.feminine)}\nלשיעור של ${k.name}: ${k.link}`)
      .join("\n\n"),
    "המשימה של היום: כ־25 דקות, ובסוף — הסיסמה הסודית.",
    `פספסתם יום? הכול נשאר פתוח בספרייה, אפשר להשלים מתי שנוח: ${kids.map((k) => `${k.name}: ${libraryFor(k.link)}`).join(" · ")}`,
  ]);

  return {
    to: normaliseTo(to),
    subject,
    html: layout({ title, bodyHtml }),
    text,
    replyTo: replyTo && replyTo.trim() ? replyTo.trim() : APP.editorEmail,
  };
}

/* ------------------------------------------------------------------ *
 * 3. Completion receipt — the only mail carrying the password
 * ------------------------------------------------------------------ */

export interface CompletionArgs {
  to: Recipients;
  kidName: string;
  feminine: boolean;
  editionN: number;
  score: number;
  max: number;
  streak: number;
  late: boolean;
  password: string;
}

export function completionMail({
  to,
  kidName,
  feminine,
  editionN,
  score,
  max,
  streak,
  late,
  password,
}: CompletionArgs): Mail {
  const subject = `✓ ${kidName} ${did(feminine)} את #${editionN} — ${score}/${max}`;
  const title = `${kidName} ${did(feminine)} את הגיליון`;

  const streakText = late
    ? "השלמה מאוחרת — בלי רצף"
    : streak > 0
      ? `רצף של ${streak} ימים`
      : "בלי רצף הפעם";
  const streakHtml = late
    ? esc("השלמה מאוחרת — בלי רצף")
    : streak > 0
      ? `רצף של ${ltr(streak)} ימים`
      : esc("בלי רצף הפעם");

  const bodyHtml = [
    p(
      `${esc(kidName)} ${esc(did(feminine))} עכשיו את גיליון #${ltr(editionN)} עם ${ltr(`${score}/${max}`)}, ${streakHtml}. הסיסמה של היום למטה — שווה לבקש אותה בעל פה לפני שמסתכלים.`,
    ),
    `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 16px;">
  <tr><td style="padding:14px 22px;background:${SUN};border-radius:12px;">
    <p style="margin:0 0 2px;font-family:${FONT};font-size:12px;color:${INK};">הסיסמה של היום</p>
    <p style="margin:0;font-family:${FONT};font-size:22px;font-weight:700;letter-spacing:1px;color:${INK};" dir="ltr">${esc(password)}</p>
  </td></tr>
</table>`,
  ].join("\n");

  const text = textBody(title, [
    `${kidName} ${did(feminine)} עכשיו את גיליון #${editionN} עם ${score}/${max}, ${streakText}. הסיסמה של היום למטה — שווה לבקש אותה בעל פה לפני שמסתכלים.`,
    `הסיסמה של היום: ${password}`,
  ]);

  return { to: normaliseTo(to), subject, html: layout({ title, bodyHtml }), text, replyTo: APP.editorEmail };
}

/* ------------------------------------------------------------------ *
 * 4. Weekly recap
 * ------------------------------------------------------------------ */

export interface WeeklyArgs {
  to: Recipients;
  parentName?: string;
  weekLabel: string;
  kids: KidWeek[];
  editorLine?: string;
}

function weekGrid(days: WeekDay[]): string {
  const cells = days
    .map((d) => {
      const bg = d.done ? SUN : "#E3DCCB";
      const mark = d.done ? "✓" : "·";
      const label = d.done && typeof d.score === "number" ? `${d.date} · ${d.score}` : d.date;
      return `<td width="36" align="center" title="${esc(label)}" style="width:36px;height:36px;background:${bg};border-radius:8px;font-family:${FONT};font-size:16px;font-weight:700;color:${INK};">${mark}</td>
<td width="6" style="width:6px;font-size:0;line-height:0;">&nbsp;</td>`;
    })
    .join("\n");
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 10px;"><tr>${cells}</tr></table>`;
}

export function weeklyMail({ to, parentName, weekLabel, kids, editorLine }: WeeklyArgs): Mail {
  const title = `השבוע שהיה — ${weekLabel}`;

  const kidBlocks = kids
    .map((k) => {
      const doneCount = k.days.filter((d) => d.done).length;
      const badges = k.badges.length
        ? `<p style="margin:0;font-family:${FONT};font-size:14px;color:${INK};">${k.badges
            .map(
              (b) =>
                `<span style="display:inline-block;padding:4px 10px;margin:0 0 4px 6px;background:#FFFFFF;border:1px solid ${LINE};border-radius:999px;font-size:13px;color:${INK};">${esc(b)}</span>`,
            )
            .join("")}</p>`
        : small("עוד אין תגים השבוע — יש שבוע הבא.");
      return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 18px;">
  <tr><td style="padding:12px 14px;background:#FFFFFF;border:1px solid ${LINE};border-radius:12px;">
    <p style="margin:0 0 8px;font-family:${FONT};font-size:16px;font-weight:700;color:${INK};">${esc(k.name)} — ${ltr(doneCount)} מתוך ${ltr(k.days.length)}</p>
    ${weekGrid(k.days)}
    ${k.collection ? small(esc(k.collection)) : ""}
    ${badges}
  </td></tr>
</table>`;
    })
    .join("\n");

  const bodyHtml = [
    p(esc(hello(parentName))),
    p("ככה נראה השבוע אצלכם — ריבוע צהוב זה יום שנסגר, אפור זה יום שדילגנו עליו. אין כאן ציון להורים, רק תמונה."),
    kidBlocks,
    editorLine ? p(esc(editorLine)) : "",
    small(`כל הגיליונות פתוחים תמיד: <a href="${esc(LIBRARY_URL)}" style="${A}">${esc(LIBRARY_URL)}</a>`),
  ]
    .filter(Boolean)
    .join("\n");

  const text = textBody(title, [
    hello(parentName),
    "ככה נראה השבוע אצלכם — ריבוע צהוב זה יום שנסגר, אפור זה יום שדילגנו עליו. אין כאן ציון להורים, רק תמונה.",
    kids
      .map((k) => {
        const doneCount = k.days.filter((d) => d.done).length;
        const row = k.days.map((d) => (d.done ? "✓" : "·")).join(" ");
        const badges = k.badges.length ? `תגים: ${k.badges.join(", ")}` : "עוד אין תגים השבוע — יש שבוע הבא.";
        return `${k.name} — ${doneCount} מתוך ${k.days.length}\n${row}\n${k.collection ? k.collection + "\n" : ""}${badges}`;
      })
      .join("\n\n"),
    editorLine ?? "",
    `כל הגיליונות פתוחים תמיד: ${LIBRARY_URL}`,
  ]);

  return { to: normaliseTo(to), subject: `${APP.name} — השבוע שהיה (${weekLabel})`, html: layout({ title, bodyHtml }), text, replyTo: APP.editorEmail };
}

/* ------------------------------------------------------------------ *
 * 5. Streak at risk — one line, no guilt
 * ------------------------------------------------------------------ */

export interface StreakRiskArgs {
  to: Recipients;
  kidName: string;
  feminine: boolean;
  streak: number;
  link: string;
}

export function streakRiskMail({ to, kidName, feminine, streak, link }: StreakRiskArgs): Mail {
  const title = `השיעור של ${kidName} עוד פתוח`;
  const verb = feminine ? "סיימה" : "סיים";
  const sentence = `${kidName} עוד לא ${verb} את השיעור של היום, והרצף של ${streak} ימים מחכה בשקט.`;
  const sentenceHtml = `${esc(kidName)} עוד לא ${esc(verb)} את השיעור של היום, והרצף של ${ltr(streak)} ימים מחכה בשקט.`;

  const bodyHtml = [p(sentenceHtml), button(link, `לשיעור של ${kidName}`)].join("\n");
  const text = textBody(title, [sentence, `לשיעור של ${kidName}: ${link}`]);

  return {
    to: normaliseTo(to),
    subject: `${kidName} — השיעור של היום עוד פתוח`,
    html: layout({ title, bodyHtml }),
    text,
    replyTo: APP.editorEmail,
  };
}

/* ------------------------------------------------------------------ *
 * 5b. Free assistant cap reached (to the parent, never to the kid)
 * ------------------------------------------------------------------ */

export interface CapNoticeArgs {
  to: Recipients;
  kidName: string;
  feminine: boolean;
  cap: number;
  billingUrl: string;
  /** the kid pressed "ask my parents" (vs. the automatic once-a-day notice) */
  askedByKid?: boolean;
}

export function capNoticeMail({ to, kidName, feminine, cap, billingUrl, askedByKid }: CapNoticeArgs): Mail {
  const wanted = feminine ? "רצתה" : "רצה";
  const pressed = feminine ? "לחצה" : "לחץ";
  const title = askedByKid ? `${kidName} רוצה שתפעילו את ארטו` : `${kidName} ${wanted} לשאול את ארטו עוד`;
  const verb = feminine ? "שאלה" : "שאל";
  const opener = askedByKid ? `${kidName} ${pressed} על "שלחו להורים בקשה" בתוך השיעור.` : "";
  const sentence = `${opener} ${kidName} ${verb} היום את ${cap} השאלות שארטו עונה עליהן בחינם, ו${wanted} לשאול עוד. אם תרצו, אפשר להפעיל את ארטו ל${kidName}: 10 ₪ לחודש, בדיוק מה שהטוקנים עולים לי, עד 30 שאלות ביום. המספרים פתוחים. ואם לא, גם בסדר גמור: השיעור עצמו תמיד חינם.`.trim();
  const sentenceHtml = `${esc(opener)} ${esc(kidName)} ${esc(verb)} היום את ${ltr(cap)} השאלות שארטו עונה עליהן בחינם, ו${esc(wanted)} לשאול עוד. אם תרצו, אפשר להפעיל את ארטו ל${esc(kidName)}: ${ltr("10 ₪")} לחודש, בדיוק מה שהטוקנים עולים לי, עד ${ltr(30)} שאלות ביום. המספרים פתוחים. ואם לא, גם בסדר גמור: השיעור עצמו תמיד חינם.`.trim();
  const steps = `שלושה צעדים: לוחצים על הכפתור, מאשרים את הכניסה במייל שיגיע, ומשלמים. ארטו נדלק מיד.`;
  const bodyHtml = [p(sentenceHtml), button(billingUrl, `להפעיל את ארטו ל${kidName}`), small(esc(steps))].join("\n");
  const text = textBody(title, [sentence, `להפעיל: ${billingUrl}`, steps]);
  return { to: normaliseTo(to), subject: title, html: layout({ title, bodyHtml }), text, replyTo: APP.editorEmail };
}

/* ------------------------------------------------------------------ *
 * 6. Billing
 * ------------------------------------------------------------------ */

export interface BillingArgs {
  to: Recipients;
  kind: BillingKind;
  kidName: string;
  portalUrl?: string;
  periodEnd?: string;
}

export function billingMail({ to, kind, kidName, portalUrl, periodEnd }: BillingArgs): Mail {
  let title: string;
  let subject: string;
  const paras: string[] = [];
  const textParas: string[] = [];

  if (kind === "payment_failed") {
    title = `התשלום עבור ${kidName} לא עבר`;
    subject = `${APP.name} — התשלום עבור ${kidName} לא עבר`;
    paras.push(
      p(
        `החיוב החודשי עבור ${esc(kidName)} נדחה. זה קורה, בדרך כלל זה כרטיס שפג תוקפו. השיעורים ממשיכים להישלח בינתיים.`,
      ),
    );
    textParas.push(
      `החיוב החודשי עבור ${kidName} נדחה. זה קורה, בדרך כלל זה כרטיס שפג תוקפו. השיעורים ממשיכים להישלח בינתיים.`,
    );
  } else if (kind === "ended") {
    title = `המנוי של ${kidName} הסתיים`;
    subject = `${APP.name} — המנוי של ${kidName} הסתיים`;
    paras.push(
      p(
        periodEnd
          ? `המנוי של ${esc(kidName)} הסתיים ב־${ltr(periodEnd)}. כל הגיליונות שכבר נשלחו נשארים פתוחים בספרייה, בלי תאריך תפוגה.`
          : `המנוי של ${esc(kidName)} הסתיים. כל הגיליונות שכבר נשלחו נשארים פתוחים בספרייה, בלי תאריך תפוגה.`,
      ),
    );
    paras.push(p("אם זה היה בטעות, או שתרצו לחזור מתי שהוא — הדלת פתוחה, בלי תנאים."));
    textParas.push(
      periodEnd
        ? `המנוי של ${kidName} הסתיים ב־${periodEnd}. כל הגיליונות שכבר נשלחו נשארים פתוחים בספרייה, בלי תאריך תפוגה.`
        : `המנוי של ${kidName} הסתיים. כל הגיליונות שכבר נשלחו נשארים פתוחים בספרייה, בלי תאריך תפוגה.`,
      "אם זה היה בטעות, או שתרצו לחזור מתי שהוא — הדלת פתוחה, בלי תנאים.",
    );
  } else {
    title = `המנוי של ${kidName} פעיל`;
    subject = `${APP.name} — המנוי של ${kidName} פעיל`;
    paras.push(p(`תודה. המנוי של ${esc(kidName)} פעיל.`));
    paras.push(
      p(
        `ה־${ltr(`₪${APP.priceIls}`)} מכסים את עלות הטוקנים של העוזר עבור ${esc(kidName)}, והמספרים פומביים: <a href="${esc(OPEN_BOOKS_URL)}" style="${A}">${esc(OPEN_BOOKS_URL)}</a>`,
      ),
    );
    textParas.push(
      `תודה. המנוי של ${kidName} פעיל.`,
      `ה־₪${APP.priceIls} מכסים את עלות הטוקנים של העוזר עבור ${kidName}, והמספרים פומביים: ${OPEN_BOOKS_URL}`,
    );
  }

  if (portalUrl) {
    paras.push(button(portalUrl, "לניהול התשלום"));
    textParas.push(`לניהול התשלום: ${portalUrl}`);
  }

  return {
    to: normaliseTo(to),
    subject,
    html: layout({ title, bodyHtml: paras.join("\n") }),
    text: textBody(title, textParas),
    replyTo: APP.editorEmail,
  };
}

/* ------------------------------------------------------------------ *
 * 7. Magic link
 * ------------------------------------------------------------------ */

export interface MagicLinkArgs {
  to: Recipients;
  link: string;
}

export function magicLinkMail({ to, link }: MagicLinkArgs): Mail {
  const title = "הקישור לכניסה";
  const bodyHtml = [
    p("זה הקישור לכניסה לחשבון. הוא תקף ל־" + ltr(15) + " דקות."),
    button(link, "כניסה לחשבון"),
    small("אם לא ביקשתם את הקישור הזה, אפשר פשוט להתעלם מהמייל."),
  ].join("\n");

  const text = textBody(title, [
    "זה הקישור לכניסה לחשבון. הוא תקף ל־15 דקות.",
    link,
    "אם לא ביקשתם את הקישור הזה, אפשר פשוט להתעלם מהמייל.",
  ]);

  return {
    to: normaliseTo(to),
    subject: `${APP.name} — הקישור לכניסה`,
    html: layout({ title, bodyHtml }),
    text,
    replyTo: APP.editorEmail,
  };
}
