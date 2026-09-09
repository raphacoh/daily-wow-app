/**
 * Renders a lesson page: the edition fragment wrapped with the RUNTIME bootstrap, optionally with the
 * visitor strip on top (the front page shows today's lesson in demo mode — show, don't tell).
 */
import { getEdition, wrapEdition, type RuntimeBootstrap } from "./editions";
import { kidByToken, profileFor } from "./kids";
import { progressFor, progressSummary, takeNotices } from "./gamification";
import { hasDb } from "./db";
import { APP, X_URL } from "./config";

/** bump when public/wow-runtime.js changes (cache-busting) */
export const WOW_RUNTIME_VERSION = "3";

export interface LessonRenderOptions {
  token?: string;
  banner?: boolean;
  index?: boolean;
  parent?: { name: string } | null;
}

export interface LessonRender {
  status: number;
  body: string;
  /** the token resolved to a live kid: the caller uses it to remember (or forget) the device */
  kid: boolean;
}

export async function renderLesson(n: number, opts: LessonRenderOptions = {}): Promise<LessonRender> {
  const edition = await getEdition(n);
  if (!edition) return { status: 404, body: notFoundPage("הגיליון הזה עוד לא יצא."), kid: false };
  const rt: RuntimeBootstrap = {
    api: "/api",
    kidToken: "",
    edition: { n: edition.n, code: edition.code, date: edition.date, title: edition.title },
    library: "/library",
  };
  let kidName = "";
  if (opts.token && hasDb()) {
    const kid = await kidByToken(opts.token);
    if (kid && !kid.paused) {
      kidName = kid.name;
      rt.kidToken = opts.token;
      rt.profile = await profileFor(kid);
      rt.library = `/library?k=${encodeURIComponent(opts.token)}`;
      const summary = progressSummary(await progressFor(kid.id), edition.n);
      rt.progress = summary ? { ...summary, notices: await takeNotices(kid.id) } : null;
    }
  }
  const dir = edition.language === "en" || edition.language === "fr" ? "ltr" : "rtl";
  // The daily secret never ships in the page: a kid gets it from the server with the completion, a demo
  // visitor gets a demo password (the real one would otherwise be readable from the source).
  const html = edition.html.replace(/const PW_ENC = '[^']*';/, `const PW_ENC = '${rt.kidToken ? "" : encodePw("הדגמה")}';`);
  const body = wrapEdition(html, rt, edition.language || "he", dir, {
    index: !!opts.index,
    // the gamification runtime is the app's, not the edition's: it evolves on deploy and works on old editions too
    prepend:
      `<script src="/wow-runtime.js?v=${WOW_RUNTIME_VERSION}"></script>` +
      (rt.kidToken ? kidMenu(kidName) : opts.banner ? visitorStrip(opts.parent ?? null) : ""),
  });
  return { status: 200, body, kid: !!rt.kidToken };
}

/**
 * The strip a visitor sees above the demo lesson: one line, one button, "learn more", dismiss.
 * Self-contained (inline CSS/JS, monochrome, no dependency on the engine's palette). Remembered per device.
 */
export function visitorStrip(parent: { name: string } | null = null): string {
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
#rw-strip .in{max-width:760px;margin:0 auto;padding:10px 12px 10px;display:grid;grid-template-columns:1fr auto;gap:8px 10px;align-items:center}
#rw-strip .cta{grid-column:1 / -1;display:block;background:#FAF8F3;color:#1B1B1B;text-decoration:none;border-radius:999px;padding:14px 18px;font-weight:700;font-size:17px;text-align:center;box-shadow:0 0 0 3px rgba(250,248,243,.18);animation:rw-pulse 2.4s ease-in-out 3}
@keyframes rw-pulse{0%,100%{box-shadow:0 0 0 3px rgba(250,248,243,.18)}50%{box-shadow:0 0 0 8px rgba(250,248,243,.06)}}
@media (prefers-reduced-motion:reduce){#rw-strip .cta{animation:none}}
#rw-strip .t{grid-column:1;min-width:0;color:#D9D5CB}
#rw-strip .t b{font-weight:500;color:#FAF8F3}
#rw-strip .x{grid-column:2;grid-row:2;background:transparent;border:0;color:inherit;font-size:22px;line-height:1;cursor:pointer;padding:2px 6px;opacity:.8}
#rw-strip a{color:inherit}
#rw-strip .acts{grid-column:1 / -1;display:flex;align-items:center;gap:16px;font-size:13.5px;opacity:.9}
#rw-strip .more{background:transparent;border:0;color:inherit;font:inherit;cursor:pointer;text-decoration:underline;text-underline-offset:3px;padding:2px 0;white-space:nowrap}
#rw-strip .links{display:none;grid-column:1 / -1;gap:6px 18px;flex-wrap:wrap;padding:2px 0 2px;font-size:13.5px;opacity:.9}
#rw-strip.open .links{display:flex}
#rw-strip[hidden]{display:none}
@media (min-width:640px){#rw-strip{font-size:15px}#rw-strip .in{grid-template-columns:auto 1fr auto auto;padding:12px 20px;align-items:center}#rw-strip .cta{grid-column:1;grid-row:1;padding:12px 26px;font-size:16px}#rw-strip .t{grid-column:2;grid-row:1}#rw-strip .acts{grid-column:3;grid-row:1;display:flex}#rw-strip .x{grid-column:4;grid-row:1}}
/* keep the lesson's own floating pieces above the strip, and leave room at the end of the page */
body.rw-on{padding-bottom:var(--rw-h)}
body.rw-on .fab{bottom:calc(18px + var(--rw-h))}
body.rw-on .toast{bottom:calc(var(--rw-h) + 20px)}
@media (min-width:641px){body.rw-on .chat{bottom:calc(14px + var(--rw-h));height:min(640px,calc(100vh - 28px - var(--rw-h)))}}
</style>
<div id="rw-strip" role="region" aria-label="שורשים וכנפיים" hidden>
  <div class="in">
    <a class="cta" href="${parent ? "/home" : "/join"}">${parent ? "הלוח שלי" : "לקבל את השיעור למייל, חינם"}</a>
    <span class="t"><b>שורשים וכנפיים</b> · ${parent ? `שלום ${esc(parent.name || "")}. זה השיעור של היום.` : "שיעור כזה מגיע למייל כל בוקר. בלי תשלום, בלי פרסומות."}</span>
    <button class="x" type="button" aria-label="סגירה">×</button>
    <div class="acts">
      <button class="more" type="button" aria-expanded="false">עוד</button>
      ${parent ? "" : '<a class="more" href="/signin">כניסה</a>'}
      <button class="more" type="button" data-share>שיתוף</button>
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
  el.querySelector('button.more').addEventListener('click', function(b){ var o=el.classList.toggle('open'); this.setAttribute('aria-expanded', o?'true':'false'); size(); });
  el.querySelector('[data-share]').addEventListener('click', function(){ var url='https://rootsandwings-edu.com/', text='שורשים וכנפיים: שיעור אחד ביום לילדים, מהורים, חינם. נסו את השיעור של היום:'; if(navigator.share){ navigator.share({title:'שורשים וכנפיים', text:text, url:url}).catch(function(){}); return; } try{ navigator.clipboard && navigator.clipboard.writeText(url); }catch(e){} window.open('https://wa.me/?text='+encodeURIComponent(text+' '+url), '_blank', 'noopener'); });
  if(window.ResizeObserver){ new ResizeObserver(size).observe(el); } window.addEventListener('resize', size);
  /* out of the way while typing (mobile keyboards), and never over the chat panel */
  var hiddenForTyping=false, chatOpen=false;
  function apply(){ if(el.hidden) return; var away = hiddenForTyping || chatOpen; el.style.transform = away ? 'translateY(110%)' : ''; if(away){ body.classList.remove('rw-on'); } else { size(); } }
  document.addEventListener('focusin', function(e){ if(e.target.matches('input,textarea') && !e.target.closest('#chat')){ hiddenForTyping=true; apply(); } });
  document.addEventListener('focusout', function(){ setTimeout(function(){ if(hiddenForTyping && !(document.activeElement && document.activeElement.matches('input,textarea'))){ hiddenForTyping=false; apply(); } },150); });
  function watchChat(){ var chatEl=document.getElementById('chat'); if(!chatEl || !window.MutationObserver) return; new MutationObserver(function(){ var o=chatEl.classList.contains('open'); if(o!==chatOpen){ chatOpen=o; apply(); } }).observe(chatEl,{attributes:true,attributeFilter:['class']}); }
  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded', watchChat); else watchChat();
  /* first-party funnel beacons (no cookies, no third party): demo started, demo completed */
  var beaconed={}; function beacon(name){ if(beaconed[name]) return; beaconed[name]=1; var payload=JSON.stringify({name:name, n:(window.RUNTIME&&window.RUNTIME.edition&&window.RUNTIME.edition.n)||null}); try{ if(navigator.sendBeacon) navigator.sendBeacon('/api/e', new Blob([payload],{type:'application/json'})); else fetch('/api/e',{method:'POST',headers:{'content-type':'application/json'},body:payload,keepalive:true}); }catch(e){} }
  function watchLesson(){ var sb=document.getElementById('startBtn'); if(sb) sb.addEventListener('click', function(){ beacon('demo_start'); }); var v=document.getElementById('vault'); if(v && window.MutationObserver){ new MutationObserver(function(){ if(v.classList.contains('open')) beacon('demo_complete'); }).observe(v,{attributes:true,attributeFilter:['class']}); } }
  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded', watchLesson); else watchLesson();
})();</script>
`;
}

/**
 * The kid's menu. A kid is already "inside" the lesson, so everything else (the collection, the other
 * editions, the parents' page) hides behind one button in the edition's own top bar — never a banner
 * across the lesson. Self-contained, and it borrows the edition's palette variables so it belongs.
 */
export function kidMenu(name: string): string {
  const items = [
    ["/l/today", "השיעור של היום"],
    ["/library", "כל הגיליונות"],
    ["/home", "הדף של ההורים"],
  ]
    .map(([href, label]) => `<a role="menuitem" href="${href}">${label}</a>`)
    .join("");
  return `<style>
#rw-menu{position:relative;z-index:30}
#rw-menu:not(.set){visibility:hidden;position:absolute;top:0;inset-inline-start:0}
#rw-menu .b{display:inline-flex;align-items:center;justify-content:center;gap:6px;width:38px;height:38px;border-radius:999px;border:1px solid var(--line,#e3dfd5);background:var(--card,#fff);color:var(--ink,#1b1b1b);cursor:pointer;font-size:17px;line-height:1;flex:none}
#rw-menu .p{position:fixed;top:58px;inset-inline-end:12px;z-index:70;min-width:230px;max-width:min(88vw,300px);background:var(--card,#fff);color:var(--ink,#1b1b1b);border:1px solid var(--line,#e3dfd5);border-radius:16px;box-shadow:0 12px 40px rgba(0,0,0,.18);padding:8px;direction:rtl;text-align:right;font-size:16px}
#rw-menu .p[hidden]{display:none}
#rw-menu .p .who{padding:6px 12px 8px;font-size:.9rem;color:var(--muted,#6b6b66)}
#rw-menu .p a,#rw-menu .p button.i{display:block;width:100%;box-sizing:border-box;text-align:right;padding:10px 12px;border:0;border-radius:10px;background:transparent;color:inherit;font:inherit;text-decoration:none;cursor:pointer}
#rw-menu .p a:hover,#rw-menu .p button.i:hover,#rw-menu .p a:focus-visible,#rw-menu .p button.i:focus-visible{background:var(--card2,#f6f3ec)}
#rw-menu .p hr{border:0;border-top:1px solid var(--line,#e3dfd5);margin:6px 8px}
#rw-menu .p .out{color:var(--muted,#6b6b66);font-size:.9rem}
#rw-menu .veil{position:fixed;inset:0;z-index:69}
#rw-menu .veil[hidden]{display:none}
#rw-menu.float{position:fixed;top:10px;inset-inline-end:10px}
</style>
<div id="rw-menu">
  <button class="b" type="button" aria-haspopup="menu" aria-expanded="false" aria-controls="rw-menu-p" aria-label="תפריט">☰</button>
  <div class="veil" hidden></div>
  <div class="p" id="rw-menu-p" role="menu" hidden>
    <p class="who">${name ? `שלום ${esc(name)}` : "שורשים וכנפיים"}</p>
    <button class="i" type="button" role="menuitem" data-collection>האוסף שלי</button>
    ${items}
    <hr>
    <form method="post" action="/auth/signout/kid"><button class="i out" type="submit" role="menuitem">זה לא אני — יציאה</button></form>
  </div>
</div>
<script>(function(){
  var el=document.getElementById('rw-menu'), btn=el.querySelector('.b'), panel=el.querySelector('.p'), veil=el.querySelector('.veil');
  function open(v){ panel.hidden=!v; veil.hidden=!v; btn.setAttribute('aria-expanded', v?'true':'false'); if(v){ var f=panel.querySelector('a,button'); f && f.focus(); } }
  btn.addEventListener('click', function(){ open(panel.hidden); });
  veil.addEventListener('click', function(){ open(false); });
  document.addEventListener('keydown', function(e){ if(e.key==='Escape' && !panel.hidden){ open(false); btn.focus(); } });
  var coll=panel.querySelector('[data-collection]');
  coll.addEventListener('click', function(){ open(false); if(window.WOW && window.WOW.open) window.WOW.open(); else location.href='/library'; });
  /* live inside the edition's own top bar; float in the corner only if this edition has none */
  function place(){ var bar=document.querySelector('.topbar-in'); if(bar){ bar.appendChild(el); } else { el.classList.add('float'); } el.classList.add('set'); }
  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded', place); else place();
})();</script>
`;
}

function esc(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c] as string);
}

/** The engine's PW_ENC: base64 of the reversed UTF-8 string. */
export function encodePw(pw: string): string {
  return Buffer.from(pw.split("").reverse().join(""), "utf8").toString("base64");
}

/** A visitor without a link or an account asked for a followers-only edition. */
export function membersOnlyPage(n: number): string {
  return `<!doctype html><html lang="he" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${APP.name}</title>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Frank+Ruhl+Libre:wght@500&family=Rubik:wght@400;500&display=swap">
<style>body{font-family:Rubik,Arial,sans-serif;background:#FAF8F3;color:#1B1B1B;display:grid;place-items:center;min-height:100vh;margin:0;line-height:1.6}main{max-width:520px;padding:32px 24px;text-align:right}h1{font-family:"Frank Ruhl Libre",Georgia,serif;font-weight:500;font-size:2rem;margin:0 0 10px}p{margin:0 0 1em}.btn{display:inline-block;background:#1B1B1B;color:#FAF8F3;text-decoration:none;border-radius:999px;padding:12px 24px;font-weight:500}a{color:#1B1B1B}.small{color:#6B6B66;font-size:.95rem}</style></head>
<body><main><h1>גיליון ${n} הוא לעוקבים</h1><p>השיעור של היום מגיע כל בוקר למייל, עם קישור אישי לכל ילד/ה. חינם, בלי פרסומות.</p><p><a class="btn" href="/join">לקבל את השיעור למייל</a></p><p class="small">כבר נרשמתם? <a href="/signin?next=${encodeURIComponent(`/l/${n}`)}">כניסה</a> · <a href="/">לנסות את שיעור ההדגמה</a> · <a href="/library">כל הגיליונות</a></p></main></body></html>`;
}

export function notFoundPage(msg: string): string {
  return `<!doctype html><html lang="he" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${APP.name}</title>
<style>body{font-family:Rubik,Arial,sans-serif;background:#FAF8F3;color:#1B1B1B;display:grid;place-items:center;min-height:100vh;margin:0}main{text-align:center;padding:24px}a{color:#1B1B1B}</style></head>
<body><main><h1>${APP.name}</h1><p>${msg}</p><p><a href="/library">כל הגיליונות ›</a></p></main></body></html>`;
}

export const HTML_HEADERS = { "content-type": "text/html; charset=utf-8", "cache-control": "private, no-store" };
