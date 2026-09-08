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
:root{--rw-h:0px}
#rw-strip{position:fixed;inset-inline:0;bottom:0;z-index:40;background:#1B1B1B;color:#FAF8F3;font-family:Rubik,"Noto Sans Hebrew",Arial,sans-serif;font-size:14px;line-height:1.4;direction:rtl;box-shadow:0 -6px 24px rgba(0,0,0,.18);padding-bottom:env(safe-area-inset-bottom,0px)}
#rw-strip .in{max-width:760px;margin:0 auto;padding:8px 12px 10px;display:grid;grid-template-columns:1fr auto;gap:6px 10px;align-items:center}
#rw-strip .t{grid-column:1;min-width:0}
#rw-strip .t b{font-weight:500}
#rw-strip .x{grid-column:2;grid-row:1;background:transparent;border:0;color:inherit;font-size:24px;line-height:1;cursor:pointer;padding:2px 6px;opacity:.8;align-self:start}
#rw-strip .acts{grid-column:1 / -1;display:flex;align-items:center;gap:14px}
#rw-strip a{color:inherit}
#rw-strip .cta{flex:1;background:#FAF8F3;color:#1B1B1B;text-decoration:none;border-radius:999px;padding:9px 14px;font-weight:500;text-align:center;white-space:nowrap}
#rw-strip .more{background:transparent;border:0;color:inherit;font:inherit;cursor:pointer;text-decoration:underline;text-underline-offset:3px;padding:6px 2px}
#rw-strip .links{display:none;grid-column:1 / -1;gap:6px 18px;flex-wrap:wrap;padding:2px 0 2px;font-size:14px;opacity:.9}
#rw-strip.open .links{display:flex}
#rw-strip[hidden]{display:none}
@media (min-width:640px){#rw-strip{font-size:15px}#rw-strip .in{grid-template-columns:1fr auto auto auto;padding:10px 20px}#rw-strip .acts{display:contents}#rw-strip .cta{flex:none;grid-column:2;grid-row:1}#rw-strip .more{grid-column:3;grid-row:1}#rw-strip .x{grid-column:4}}
/* keep the lesson's own floating pieces above the strip, and leave room at the end of the page */
body.rw-on{padding-bottom:var(--rw-h)}
body.rw-on .fab{bottom:calc(18px + var(--rw-h))}
body.rw-on .chat{bottom:calc(14px + var(--rw-h));height:min(640px,calc(100vh - 28px - var(--rw-h)))}
body.rw-on .toast{bottom:calc(var(--rw-h) + 20px)}
</style>
<div id="rw-strip" role="region" aria-label="שורשים וכנפיים" hidden>
  <div class="in">
    <span class="t"><b>שורשים וכנפיים</b> · שיעור כזה מגיע למייל כל בוקר. חינם.</span>
    <button class="x" type="button" aria-label="סגירה">×</button>
    <div class="acts">
      <a class="cta" href="/join">לקבל את השיעור למייל</a>
      <button class="more" type="button" aria-expanded="false">עוד</button>
    </div>
    <nav class="links" aria-label="עוד">${links}</nav>
  </div>
</div>
<script>(function(){
  var el=document.getElementById('rw-strip'), body=document.body, root=document.documentElement;
  function size(){ if(el.hidden){ root.style.setProperty('--rw-h','0px'); body.classList.remove('rw-on'); return; } root.style.setProperty('--rw-h', el.offsetHeight+'px'); body.classList.add('rw-on'); }
  function show(v){ el.hidden=!v; size(); }
  var off=false; try{ off = localStorage.getItem('rw-strip')==='off'; }catch(e){}
  show(!off);
  el.querySelector('.x').addEventListener('click', function(){ try{ localStorage.setItem('rw-strip','off'); }catch(e){} show(false); });
  el.querySelector('.more').addEventListener('click', function(b){ var o=el.classList.toggle('open'); this.setAttribute('aria-expanded', o?'true':'false'); size(); });
  if(window.ResizeObserver){ new ResizeObserver(size).observe(el); } window.addEventListener('resize', size);
  /* out of the way while typing (mobile keyboards), and never over the chat panel */
  var hiddenForTyping=false;
  document.addEventListener('focusin', function(e){ if(e.target.matches('input,textarea') && !el.hidden){ hiddenForTyping=true; el.style.transform='translateY(110%)'; body.classList.remove('rw-on'); } });
  document.addEventListener('focusout', function(){ setTimeout(function(){ if(hiddenForTyping && !(document.activeElement && document.activeElement.matches('input,textarea'))){ hiddenForTyping=false; el.style.transform=''; size(); } },150); });
})();</script>
`;
}

export function notFoundPage(msg: string): string {
  return `<!doctype html><html lang="he" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${APP.name}</title>
<style>body{font-family:Rubik,Arial,sans-serif;background:#FAF8F3;color:#1B1B1B;display:grid;place-items:center;min-height:100vh;margin:0}main{text-align:center;padding:24px}a{color:#1B1B1B}</style></head>
<body><main><h1>${APP.name}</h1><p>${msg}</p><p><a href="/library">כל הגיליונות ›</a></p></main></body></html>`;
}

export const HTML_HEADERS = { "content-type": "text/html; charset=utf-8", "cache-control": "private, no-store" };
