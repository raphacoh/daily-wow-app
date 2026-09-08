/**
 * Renders a lesson page: the edition fragment wrapped with the RUNTIME bootstrap, optionally with the
 * visitor strip on top (the front page shows today's lesson in demo mode — show, don't tell).
 */
import { getEdition, wrapEdition, type RuntimeBootstrap } from "./editions";
import { kidByToken, profileFor } from "./kids";
import { hasDb } from "./db";
import { APP, X_URL } from "./config";

export interface LessonRenderOptions {
  token?: string;
  banner?: boolean;
  index?: boolean;
}

export async function renderLesson(n: number, opts: LessonRenderOptions = {}): Promise<{ status: number; body: string }> {
  const edition = await getEdition(n);
  if (!edition) return { status: 404, body: notFoundPage("הגיליון הזה עוד לא יצא.") };
  const rt: RuntimeBootstrap = {
    api: "/api",
    kidToken: "",
    edition: { n: edition.n, code: edition.code, date: edition.date, title: edition.title },
    library: "/library",
  };
  if (opts.token && hasDb()) {
    const kid = await kidByToken(opts.token);
    if (kid && !kid.paused) {
      rt.kidToken = opts.token;
      rt.profile = await profileFor(kid);
    }
  }
  const dir = edition.language === "en" || edition.language === "fr" ? "ltr" : "rtl";
  const body = wrapEdition(edition.html, rt, edition.language || "he", dir, {
    index: !!opts.index,
    prepend: opts.banner && !rt.kidToken ? visitorStrip() : "",
  });
  return { status: 200, body };
}

/**
 * The strip a visitor sees above the demo lesson: one line, one button, "learn more", dismiss.
 * Self-contained (inline CSS/JS, monochrome, no dependency on the engine's palette). Remembered per device.
 */
export function visitorStrip(): string {
  const links = [
    ["/manifesto", "מניפסט"],
    ["/faq", "שאלות"],
    ["/open", "פתוח"],
    ["/library", "כל הגיליונות"],
    [X_URL, "X"],
  ]
    .map(([href, label]) => `<a href="${href}"${href.startsWith("http") ? ' rel="me noopener"' : ""}>${label}</a>`)
    .join("");
  return `<style>
#rw-strip{position:sticky;top:0;z-index:40;background:#1B1B1B;color:#FAF8F3;font-family:Rubik,"Noto Sans Hebrew",Arial,sans-serif;font-size:15px;line-height:1.5;direction:rtl}
#rw-strip .in{max-width:760px;margin:0 auto;padding:10px 16px;display:flex;flex-wrap:wrap;align-items:center;gap:8px 14px}
#rw-strip .t{flex:1 1 220px;min-width:0}
#rw-strip .t b{font-weight:500}
#rw-strip a{color:inherit}
#rw-strip .cta{background:#FAF8F3;color:#1B1B1B;text-decoration:none;border-radius:999px;padding:7px 14px;font-weight:500;white-space:nowrap}
#rw-strip .more{background:transparent;border:0;color:inherit;font:inherit;cursor:pointer;text-decoration:underline;text-underline-offset:3px;padding:0}
#rw-strip .x{background:transparent;border:0;color:inherit;font-size:22px;line-height:1;cursor:pointer;padding:0 4px;opacity:.8}
#rw-strip .links{display:none;width:100%;gap:6px 18px;flex-wrap:wrap;padding:2px 0 4px;font-size:14px;opacity:.9}
#rw-strip.open .links{display:flex}
#rw-strip[hidden]{display:none}
@media (max-width:640px){#rw-strip{font-size:14px}#rw-strip .in{padding:8px 12px}}
</style>
<div id="rw-strip" role="region" aria-label="שורשים וכנפיים" hidden>
  <div class="in">
    <span class="t"><b>שורשים וכנפיים</b> · זה השיעור של היום. כזה מגיע למייל כל בוקר, חינם.</span>
    <a class="cta" href="/join">לקבל את השיעור למייל</a>
    <button class="more" type="button" onclick="document.getElementById('rw-strip').classList.toggle('open')">עוד</button>
    <button class="x" type="button" aria-label="סגירה" onclick="try{localStorage.setItem('rw-strip','off')}catch(e){};document.getElementById('rw-strip').hidden=true">×</button>
    <nav class="links" aria-label="עוד">${links}</nav>
  </div>
</div>
<script>(function(){try{if(localStorage.getItem('rw-strip')!=='off')document.getElementById('rw-strip').hidden=false;}catch(e){document.getElementById('rw-strip').hidden=false;}})();</script>
`;
}

export function notFoundPage(msg: string): string {
  return `<!doctype html><html lang="he" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${APP.name}</title>
<style>body{font-family:Rubik,Arial,sans-serif;background:#FAF8F3;color:#1B1B1B;display:grid;place-items:center;min-height:100vh;margin:0}main{text-align:center;padding:24px}a{color:#1B1B1B}</style></head>
<body><main><h1>${APP.name}</h1><p>${msg}</p><p><a href="/library">כל הגיליונות ›</a></p></main></body></html>`;
}

export const HTML_HEADERS = { "content-type": "text/html; charset=utf-8", "cache-control": "private, no-store" };
