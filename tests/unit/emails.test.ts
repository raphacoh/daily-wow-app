import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { APP } from "../../src/lib/config";
import {
  esc,
  layout,
  sendMail,
  sendBatch,
  welcomeMail,
  dailyMail,
  completionMail,
  weeklyMail,
  streakRiskMail,
  billingMail,
  magicLinkMail,
  type Mail,
} from "../../src/lib/emails";

/** Anything that looks like a tag means the plain-text part leaked HTML. */
const TAG = /<[^>]+>/;

function assertPlainText(mail: Mail) {
  expect(mail.text.trim().length).toBeGreaterThan(0);
  expect(mail.text).not.toMatch(TAG);
  expect(mail.text).not.toContain("&nbsp;");
  expect(mail.text).not.toContain("&amp;");
}

function assertShell(mail: Mail) {
  expect(mail.html).toContain('<html lang="he" dir="rtl">');
  expect(mail.html).toContain("#FBF5E6");
  expect(mail.html).toContain("#1E2140");
  expect(mail.html).toContain("Rubik, Arial, sans-serif");
  expect(mail.html).toContain("max-width:560px");
  // footer
  expect(mail.html).toContain("כל הגיליונות");
  expect(mail.html).toContain("הספרים הפתוחים");
  expect(mail.html).toContain(`${APP.url}/library`);
  expect(mail.html).toContain(`${APP.url}/open-books`);
  expect(mail.html).toContain(APP.kitRepo);
  expect(mail.html).toContain("להשיב למייל הזה");
  // plain-text footer mirrors it
  expect(mail.text).toContain(`${APP.url}/library`);
  expect(mail.text).toContain(`${APP.url}/open-books`);
  expect(mail.text).toContain(APP.kitRepo);
  assertPlainText(mail);
}

describe("esc", () => {
  it("escapes every HTML-significant character", () => {
    expect(esc(`<a href="x">&'`)).toBe("&lt;a href=&quot;x&quot;&gt;&amp;&#39;");
  });

  it("returns an empty string for null/undefined and stringifies numbers", () => {
    expect(esc(null)).toBe("");
    expect(esc(undefined)).toBe("");
    expect(esc(7)).toBe("7");
  });
});

describe("layout", () => {
  it("renders the RTL shell, the brand header and an optional footer note", () => {
    const html = layout({ title: "כותרת", bodyHtml: "<p>גוף</p>", footerNote: "הערה קטנה" });
    expect(html).toContain('<html lang="he" dir="rtl">');
    expect(html).toContain(APP.name);
    expect(html).toContain("#F4A100"); // sun disc / accent
    expect(html).toContain("#167C8A"); // teal links
    expect(html).toContain("<p>גוף</p>");
    expect(html).toContain("הערה קטנה");
  });

  it("escapes the title", () => {
    expect(layout({ title: '<script>x</script>', bodyHtml: "" })).not.toContain("<script>");
  });
});

describe("welcomeMail", () => {
  const mail = welcomeMail({
    to: "parent@example.com",
    parentName: "דנה",
    editionTitle: "למה השמיים כחולים",
    editionN: 12,
    kids: [
      { name: "יעל", feminine: true, link: "https://app.test/l/yael-abc" },
      { name: "איתי", feminine: false, link: "https://app.test/l/itay-def" },
    ],
  });

  it("addresses the parent and carries the subject", () => {
    expect(mail.to).toEqual(["parent@example.com"]);
    expect(mail.subject).toContain(APP.name);
    expect(mail.replyTo).toBe(APP.editorEmail);
    expect(mail.html).toContain("היי דנה,");
  });

  it("explains tomorrow, the password ritual and where to change the level", () => {
    expect(mail.html).toContain("11:00");
    expect(mail.html).toContain("סיסמה סודית");
    expect(mail.html).toContain(`${APP.url}/home`);
    expect(mail.text).toContain(`${APP.url}/home`);
  });

  it("gives one button per kid, pointing at that kid's own link", () => {
    expect(mail.html).toContain("לשיעור של יעל");
    expect(mail.html).toContain("לשיעור של איתי");
    expect(mail.html).toContain("https://app.test/l/yael-abc");
    expect(mail.html).toContain("https://app.test/l/itay-def");
    expect(mail.text).toContain("https://app.test/l/yael-abc");
    expect(mail.text).toContain("https://app.test/l/itay-def");
  });

  it("mentions today's edition", () => {
    expect(mail.html).toContain("למה השמיים כחולים");
    expect(mail.html).toContain('<span dir="ltr">12</span>');
  });

  it("has a clean plain-text alternative and the shared shell", () => assertShell(mail));
});

describe("dailyMail", () => {
  const base = {
    to: ["parent@example.com"],
    editionN: 37,
    editionTitle: "איך דגים ישנים",
    editionDate: "8.9.2026",
    teaser: "יש דגים שממשיכים לשחות בזמן שהם ישנים. איך אפשר בכלל לישון תוך כדי תנועה?",
    kids: [
      { name: "יעל", feminine: true, streak: 4, link: "https://app.test/l/yael-37" },
      { name: "איתי", feminine: false, streak: 0, link: "https://app.test/l/itay-37" },
    ],
    replyTo: APP.editorEmail,
  };
  const mail = dailyMail(base);

  it("uses the exact subject format", () => {
    expect(mail.subject).toBe(`🤯 ${APP.name} #37 · איך דגים ישנים`);
  });

  it("replies to the editor", () => {
    expect(mail.to).toEqual(["parent@example.com"]);
    expect(mail.replyTo).toBe(APP.editorEmail);
    expect(dailyMail({ ...base, replyTo: undefined }).replyTo).toBe(APP.editorEmail);
  });

  it("carries the teaser, the date and each kid's own link", () => {
    expect(mail.html).toContain("יש דגים שממשיכים לשחות");
    expect(mail.html).toContain("8.9.2026");
    expect(mail.html).toContain("https://app.test/l/yael-37");
    expect(mail.html).toContain("https://app.test/l/itay-37");
    expect(mail.html).toContain("לשיעור של יעל");
    expect(mail.html).toContain("לשיעור של איתי");
  });

  it("renders a gendered streak line", () => {
    expect(mail.html).toContain("רצף של");
    expect(mail.html).toContain('<span dir="ltr">4</span>');
    expect(mail.html).toContain("עוד לא התחיל רצף — היום זה היום");
    const feminineZero = dailyMail({
      ...base,
      kids: [{ name: "יעל", feminine: true, streak: 0, link: "https://app.test/l/yael-37" }],
    });
    expect(feminineZero.html).toContain("עוד לא התחילה רצף — היום זה היום");
  });

  it("shows the daily mission line and the catch-up link", () => {
    expect(mail.html).toContain("המשימה של היום");
    expect(mail.text).toContain("המשימה של היום");
    expect(mail.html).toContain(`${APP.url}/library`);
  });

  it("labels the editor's note only when there is one", () => {
    expect(mail.html).not.toContain("הערה מרף");
    const withNote = dailyMail({ ...base, editorNote: "הפעם הרחבתי קצת על שינה." });
    expect(withNote.html).toContain("הערה מרף");
    expect(withNote.html).toContain("הפעם הרחבתי קצת על שינה.");
    expect(withNote.text).toContain("הערה מרף");
  });

  it("never leaks a password value", () => {
    // The mission line legitimately mentions the concept, but nothing may look
    // like "סיסמה: VALUE" / "הסיסמה של היום ...".
    for (const part of [mail.html, mail.text]) {
      expect(part).not.toMatch(/סיסמה\s*[:=-]\s*\S/);
      expect(part).not.toContain("הסיסמה של היום");
    }
    // And the argument type simply has no place to put one.
    // @ts-expect-error - dailyMail accepts no `password` field, by design.
    dailyMail({ ...base, password: "BANANA" });
  });

  it("has a clean plain-text alternative and the shared shell", () => assertShell(mail));
});

describe("completionMail", () => {
  const mail = completionMail({
    to: "parent@example.com",
    kidName: "יעל",
    feminine: true,
    editionN: 37,
    score: 4,
    max: 5,
    streak: 5,
    late: false,
    password: "TURTLE-9",
  });

  it("uses a gendered subject with the score", () => {
    expect(mail.subject).toBe("✓ יעל סיימה את #37 — 4/5");
    expect(
      completionMail({
        to: "parent@example.com",
        kidName: "איתי",
        feminine: false,
        editionN: 37,
        score: 5,
        max: 5,
        streak: 1,
        late: false,
        password: "X",
      }).subject,
    ).toBe("✓ איתי סיים את #37 — 5/5");
  });

  it("contains the score, the streak and the password in both parts", () => {
    expect(mail.html).toContain('<span dir="ltr">4/5</span>');
    expect(mail.html).toContain("רצף של");
    expect(mail.html).toContain("TURTLE-9");
    expect(mail.html).toContain("הסיסמה של היום");
    expect(mail.text).toContain("TURTLE-9");
    expect(mail.text).toContain("4/5");
  });

  it("says late completions carry no streak", () => {
    const late = completionMail({
      to: "parent@example.com",
      kidName: "יעל",
      feminine: true,
      editionN: 37,
      score: 3,
      max: 5,
      streak: 0,
      late: true,
      password: "OWL",
    });
    expect(late.html).toContain("השלמה מאוחרת — בלי רצף");
    expect(late.text).toContain("השלמה מאוחרת — בלי רצף");
    expect(late.html).not.toContain("רצף של");
  });

  it("escapes the password", () => {
    const evil = completionMail({
      to: "parent@example.com",
      kidName: "יעל",
      feminine: true,
      editionN: 1,
      score: 1,
      max: 1,
      streak: 1,
      late: false,
      password: "<img src=x>",
    });
    expect(evil.html).not.toContain("<img src=x>");
    expect(evil.html).toContain("&lt;img src=x&gt;");
  });

  it("has a clean plain-text alternative and the shared shell", () => assertShell(mail));
});

describe("weeklyMail", () => {
  const days = (pattern: boolean[]) =>
    pattern.map((done, i) => ({ date: `2026-09-0${i + 1}`, done, score: done ? 4 : undefined }));

  const mail = weeklyMail({
    to: "parent@example.com",
    parentName: "דנה",
    weekLabel: "1–7 בספטמבר",
    editorLine: "בשבוע הבא נתעכב קצת על אור וצבע.",
    kids: [
      {
        name: "יעל",
        feminine: true,
        days: days([true, true, false, true, true, false, true]),
        badges: ["חמישה ימים ברצף", "ניחוש נועז"],
      },
      { name: "איתי", feminine: false, days: days([false, false, false, false, false, false, false]), badges: [] },
    ],
  });

  it("has the week label in the subject and greets the parent", () => {
    expect(mail.to).toEqual(["parent@example.com"]);
    expect(mail.subject).toContain("1–7 בספטמבר");
    expect(mail.html).toContain("היי דנה,");
  });

  it("draws seven squares per kid, sun-yellow for done and grey for missed", () => {
    const doneSquares = mail.html.match(/background:#F4A100;border-radius:8px/g) ?? [];
    const missedSquares = mail.html.match(/background:#E3DCCB;border-radius:8px/g) ?? [];
    expect(doneSquares.length).toBe(5); // 5 done for יעל, 0 for איתי
    expect(missedSquares.length).toBe(9); // 2 + 7
    expect(mail.html).toContain("✓");
  });

  it("lists badges and the editor's line about next week", () => {
    expect(mail.html).toContain("חמישה ימים ברצף");
    expect(mail.html).toContain("ניחוש נועז");
    expect(mail.html).toContain("עוד אין תגים השבוע");
    expect(mail.html).toContain("בשבוע הבא נתעכב קצת על אור וצבע.");
    expect(mail.text).toContain("חמישה ימים ברצף");
    expect(mail.text).toContain("בשבוע הבא נתעכב קצת על אור וצבע.");
  });

  it("omits the editor line when absent", () => {
    const bare = weeklyMail({ to: "p@e.com", weekLabel: "שבוע", kids: [], editorLine: undefined });
    expect(bare.html).not.toContain("בשבוע הבא נתעכב");
    assertPlainText(bare);
  });

  it("has a clean plain-text alternative and the shared shell", () => assertShell(mail));
});

describe("streakRiskMail", () => {
  const mail = streakRiskMail({
    to: "parent@example.com",
    kidName: "יעל",
    feminine: true,
    streak: 6,
    link: "https://app.test/l/yael-38",
  });

  it("names the kid, the streak and links to the lesson", () => {
    expect(mail.to).toEqual(["parent@example.com"]);
    expect(mail.subject).toContain("יעל");
    expect(mail.html).toContain("עוד לא סיימה");
    expect(mail.html).toContain('<span dir="ltr">6</span>');
    expect(mail.html).toContain("https://app.test/l/yael-38");
    expect(mail.text).toContain("https://app.test/l/yael-38");
  });

  it("uses the masculine form when needed", () => {
    const m = streakRiskMail({
      to: "p@e.com",
      kidName: "איתי",
      feminine: false,
      streak: 2,
      link: "https://app.test/l/itay-38",
    });
    expect(m.html).toContain("עוד לא סיים");
    expect(m.html).not.toContain("עוד לא סיימה");
  });

  it("has a clean plain-text alternative and the shared shell", () => assertShell(mail));
});

describe("billingMail", () => {
  it("payment_failed states the facts and links the portal", () => {
    const mail = billingMail({
      to: "parent@example.com",
      kind: "payment_failed",
      kidName: "יעל",
      portalUrl: "https://billing.test/portal/abc",
    });
    expect(mail.to).toEqual(["parent@example.com"]);
    expect(mail.subject).toContain("יעל");
    expect(mail.html).toContain("לא עבר");
    expect(mail.html).toContain("https://billing.test/portal/abc");
    expect(mail.text).toContain("https://billing.test/portal/abc");
    assertShell(mail);
  });

  it("ended mentions the period end and keeps the library open", () => {
    const mail = billingMail({ to: "parent@example.com", kind: "ended", kidName: "איתי", periodEnd: "30.9.2026" });
    expect(mail.html).toContain("הסתיים");
    expect(mail.html).toContain('<span dir="ltr">30.9.2026</span>');
    expect(mail.html).not.toContain("portal");
    assertShell(mail);
  });

  it("active thanks the parent and explains the ₪10 with the open-books link", () => {
    const mail = billingMail({ to: "parent@example.com", kind: "active", kidName: "יעל" });
    expect(mail.html).toContain("תודה");
    expect(mail.html).toContain(`₪${APP.priceIls}`);
    expect(mail.html).toContain("עלות הטוקנים של העוזר");
    expect(mail.html).toContain("המספרים פומביים");
    expect(mail.html).toContain(`${APP.url}/open-books`);
    expect(mail.text).toContain(`₪${APP.priceIls}`);
    assertShell(mail);
  });
});

describe("magicLinkMail", () => {
  const mail = magicLinkMail({ to: "parent@example.com", link: "https://app.test/auth/abc123" });

  it("carries the link, the 15-minute validity and the ignore line", () => {
    expect(mail.to).toEqual(["parent@example.com"]);
    expect(mail.html).toContain("https://app.test/auth/abc123");
    expect(mail.html).toContain('<span dir="ltr">15</span>');
    expect(mail.html).toContain("אם לא ביקשתם את הקישור הזה");
    expect(mail.text).toContain("https://app.test/auth/abc123");
    expect(mail.text).toContain("15 דקות");
  });

  it("has a clean plain-text alternative and the shared shell", () => assertShell(mail));
});

describe("no price reaches a kid-facing mail", () => {
  it("daily and welcome mails never mention money", () => {
    const daily = dailyMail({
      to: "p@e.com",
      editionN: 1,
      editionTitle: "כותרת",
      editionDate: "1.1.2026",
      teaser: "שאלה",
      kids: [{ name: "יעל", feminine: true, streak: 1, link: "https://app.test/l/1" }],
    });
    const welcome = welcomeMail({
      to: "p@e.com",
      kids: [{ name: "יעל", feminine: true, link: "https://app.test/l/1" }],
      editionTitle: "כותרת",
      editionN: 1,
    });
    for (const m of [daily, welcome]) {
      expect(m.html).not.toContain("₪");
      expect(m.text).not.toContain("₪");
      expect(m.html).not.toContain(String(APP.priceIls) + " ש");
    }
  });
});

describe("recipient handling", () => {
  it("dedupes case-insensitively and drops empties", () => {
    const mail = welcomeMail({
      to: ["A@Example.com", "a@example.com", "  ", "b@example.com", "B@EXAMPLE.COM"],
      kids: [],
      editionTitle: "כותרת",
      editionN: 1,
    });
    expect(mail.to).toEqual(["A@Example.com", "b@example.com"]);
  });
});

describe("sendMail / sendBatch without RESEND_API_KEY", () => {
  const saved = process.env.RESEND_API_KEY;

  beforeEach(() => {
    delete process.env.RESEND_API_KEY;
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    if (saved === undefined) delete process.env.RESEND_API_KEY;
    else process.env.RESEND_API_KEY = saved;
  });

  const mail = magicLinkMail({ to: "parent@example.com", link: "https://app.test/auth/x" });

  it("sendMail resolves with skipped instead of throwing", async () => {
    const res = await sendMail(mail);
    expect(res).toEqual({ id: null, skipped: "resend_not_configured" });
    expect(console.warn).toHaveBeenCalledTimes(1);
  });

  it("sendBatch resolves with skipped instead of throwing", async () => {
    const res = await sendBatch([mail, mail, mail]);
    expect(res.skipped).toBe("resend_not_configured");
    expect(res.ids).toEqual([]);
    expect(res.sent).toBe(0);
    expect(console.warn).toHaveBeenCalledTimes(1);
  });
});
