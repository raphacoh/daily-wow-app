/**
 * Rendering helpers for Hebrew, RTL text: every number that sits inside a Hebrew sentence has to be
 * isolated as a left-to-right run (`.num`), otherwise the bidi algorithm reorders it. See PRD §9.4 —
 * this is the #1 bug in Hebrew pages, so the dictionaries stay plain strings and the wrapping happens here.
 */
import React from "react";

const HE_MONTHS = [
  "ינואר",
  "פברואר",
  "מרץ",
  "אפריל",
  "מאי",
  "יוני",
  "יולי",
  "אוגוסט",
  "ספטמבר",
  "אוקטובר",
  "נובמבר",
  "דצמבר",
];

/** Wrap every digit run in a `.num` span. Use for any dictionary string that may contain numbers. */
export function nums(text: string): React.ReactNode[] {
  return text.split(/(\d[\d.,:/–—-]*\d|\d)/g).map((part, i) =>
    /\d/.test(part) ? (
      <span className="num" key={i}>
        {part}
      </span>
    ) : (
      <React.Fragment key={i}>{part}</React.Fragment>
    ),
  );
}

/** "יום שני, 7 בספטמבר 2026" — the digits isolated. `iso` is `YYYY-MM-DD`. */
export function heDate(iso: string): React.ReactNode {
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  if (!y || !m || !d) return iso;
  const weekday = new Intl.DateTimeFormat("he-IL", { weekday: "long", timeZone: "UTC" }).format(new Date(Date.UTC(y, m - 1, d)));
  return (
    <>
      {weekday}, <span className="num">{d}</span> ב{HE_MONTHS[m - 1]} <span className="num">{y}</span>
    </>
  );
}

/** "ספטמבר 2026" from a `YYYY-MM` key. */
export function heMonth(key: string): React.ReactNode {
  const [y, m] = key.split("-").map(Number);
  return (
    <>
      {HE_MONTHS[(m || 1) - 1]} <span className="num">{y}</span>
    </>
  );
}

/** A shekel amount, digits isolated. */
export function ils(n: number): React.ReactNode {
  return (
    <>
      <span className="num">{n.toFixed(2)}</span> ₪
    </>
  );
}

/** A bare integer, digits isolated. */
export function n(value: number): React.ReactNode {
  return <span className="num">{value}</span>;
}
