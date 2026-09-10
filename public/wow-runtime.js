/* שורשים וכנפיים — gamification runtime (docs/gamification-spec.md §8.1).
 * Served by the app and injected before every edition fragment, so it evolves on deploy and works on old
 * editions too. Renders the header bar, the results-screen progress block and the "my roots and wings"
 * drawer from the server's truth; buffers WOW.emit() events (P1 posts them); and brings a half-finished
 * lesson back after the kid leaves the page. No dependency on the edition beyond a few ids. */
(function () {
  'use strict';
  if (window.WOW && window.WOW.v) return;
  var RT = window.RUNTIME || {};
  var TOKEN = RT.kidToken || '';
  var N = (RT.edition && RT.edition.n) || null;
  var API = String(RT.api || '/api').replace(/\/+$/, '');
  var before = RT.progress || null; // summary as of before today's completion
  var buf = [];
  var MEDAL = { bronze: 'ארד', silver: 'כסף', gold: 'זהב', diamond: 'יהלום' };
  var ROOT_ORDER = ['math', 'physics', 'chemistry', 'biology', 'engineering', 'space', 'earth', 'history'];
  var ROOTS = { math: ['מתמטיקה', '∑'], physics: ['פיזיקה', '⚡'], chemistry: ['כימיה', '⚗'], biology: ['ביולוגיה', '❀'], engineering: ['הנדסה', '⚙'], space: ['חלל', '✦'], earth: ['כדור הארץ', '◍'], history: ['היסטוריה', '⌛'] };
  var STAGES = [[0, 'זרע'], [60, 'נבט'], [200, 'שתיל'], [500, 'עץ צעיר'], [1000, 'עץ'], [2000, 'עץ עתיק']];
  var F = !!(RT.profile && RT.profile.kid && RT.profile.kid.feminine);
  function G(m, f) { return F ? f : m; }

  var WINGS = { predict: ['ניבוי', '≈'], understand: ['הבנה', '✓'], sequence: ['סדר', '⇅'], calculate: ['חישוב', '÷'], explain: ['הסבר', '★'], reason: ['חשיבה עמוקה', 'Σ'], curious: ['סקרנות', '?'] };
  var WING_ORDER = ['predict', 'understand', 'sequence', 'calculate', 'explain', 'reason', 'curious'];
  var WING_LEVELS = [0, 10, 30, 60, 100, 150, 210, 280, 360, 450];

  /* ---------- events: the engine emits at its decision points; we batch them to the app (kid mode only) ---------- */
  var EQ_KEY = 'wow-eq', pending = [], flushing = false;
  function qload() { try { return JSON.parse(localStorage.getItem(EQ_KEY) || '[]'); } catch (e) { return []; } }
  function qsave(q) { try { localStorage.setItem(EQ_KEY, JSON.stringify(q.slice(-40))); } catch (e) {} }
  function flush(sync) {
    if (!TOKEN || !N) return Promise.resolve();
    var batches = qload();
    if (pending.length) { batches.push({ token: TOKEN, edition_n: N, events: pending.splice(0, pending.length) }); qsave(batches); }
    if (!batches.length || flushing) return Promise.resolve();
    if (sync && navigator.sendBeacon) { batches.forEach(function (b) { navigator.sendBeacon(API + '/kid/events', new Blob([JSON.stringify(b)], { type: 'application/json' })); }); qsave([]); return Promise.resolve(); }
    flushing = true;
    var rest = [];
    return batches.reduce(function (p, b) {
      return p.then(function () { return of(API + '/kid/events', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b), keepalive: true }).then(function (r) { if (r.status >= 500) rest.push(b); }).catch(function () { rest.push(b); }); });
    }, Promise.resolve()).then(function () { qsave(rest); flushing = false; }, function () { qsave(rest); flushing = false; });
  }
  var W = (window.WOW = {
    v: 3,
    emit: function (type, payload) {
      var p = payload || {};
      buf.push({ t: type, p: p, at: Date.now() }); if (buf.length > 200) buf.shift();
      // a replayed gesture is the kid's old work coming back, not a new answer: never send it twice
      if (!TOKEN || replaying) return;
      if (type === 'item' || type === 'predict') pending.push({ id: p.id, kind: type === 'predict' ? 'predict' : p.kind, correct: p.correct, partial: p.partial, attempt: p.attempt, stars: p.stars, graded: p.graded, value: p.value, target: p.target });
      else if (type === 'open') pending.push({ id: 'open:' + p.id, kind: 'open', attempt: 1 });
      if (type === 'finish' || pending.length >= 10) flush();
    },
    events: function () { return buf.slice(); },
    flush: flush,
    mount: mount,
    open: openDrawer,
    /** forget the saved lesson state (the "start over" path) */
    forget: rsClear,
  });
  document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'hidden') flush(true); });

  var css =
    '.wow{margin:18px 0 0;padding:16px;border:1px solid var(--line,#e3dfd5);border-radius:16px;background:var(--card,#fff);font-size:16px;line-height:1.6}' +
    '.wow h4{margin:0 0 6px;font-size:1.05rem}.wow .row{display:flex;flex-wrap:wrap;gap:8px;margin:6px 0}' +
    '.wow .chip{display:inline-flex;align-items:center;gap:6px;border:1px solid var(--line,#e3dfd5);border-radius:999px;padding:4px 12px;font-size:.92rem;background:var(--card2,#f6f3ec)}' +
    '.wow .chip b{font-weight:600}.wow .chip.up{border-color:var(--ok,#1f8a5b);background:var(--ok-soft,#ddf3e7)}.wow .chip .g{width:22px;height:22px;border-radius:50%;background:var(--ink,#1b1b1b);color:var(--bg,#fff);display:grid;place-items:center;font-size:.8rem;font-weight:700}' +
    '.wow .medal{display:flex;align-items:center;gap:14px;margin:4px 0 10px}.wow .medal .m{width:56px;height:56px;border-radius:50%;display:grid;place-items:center;font-weight:800;font-size:.9rem;color:#2b2416;flex:none;box-shadow:inset 0 0 0 4px rgba(255,255,255,.35)}' +
    '.wow .m.bronze{background:#c98b5a}.wow .m.silver{background:#c9ccd3}.wow .m.gold{background:#f2c14e}.wow .m.diamond{background:linear-gradient(135deg,#bfe8ff,#e6d4ff,#bfe8ff)}.wow .m.none{background:var(--line,#e3dfd5)}' +
    '.wow .card{display:grid;grid-template-columns:auto 1fr;gap:12px;align-items:center;border:2px solid var(--line,#e3dfd5);border-radius:14px;padding:12px 14px;margin:8px 0;background:var(--card2,#f6f3ec)}.wow .card.gold{border-color:#f2c14e}.wow .card.diamond{border-color:#9fd3ff}.wow .card.silver{border-color:#c9ccd3}.wow .card.bronze{border-color:#c98b5a}' +
    '.wow .card .n{font-size:.8rem;color:var(--muted,#6b6b66)}.wow .card .t{font-weight:700}.wow .card .f{font-size:.92rem;color:var(--muted,#6b6b66)}.wow .card .s{font-size:.85rem;color:var(--muted,#6b6b66)}' +
    '.wow .small{font-size:.9rem;color:var(--muted,#6b6b66);margin:2px 0}.wow .btn{display:inline-block;margin-top:8px;border:0;border-radius:999px;padding:10px 18px;background:var(--ink,#1b1b1b);color:var(--bg,#fff);font:inherit;font-weight:600;cursor:pointer}' +
    '.wow-strip{display:flex;flex-wrap:wrap;gap:8px 14px;align-items:center;margin:0 0 14px;font-size:.95rem}.wow-strip .chip{display:inline-flex;gap:6px;align-items:center;border:1px solid var(--line,#e3dfd5);border-radius:999px;padding:3px 10px;background:var(--card,#fff)}.wow-strip button{background:transparent;border:0;font:inherit;color:inherit;text-decoration:underline;text-underline-offset:3px;cursor:pointer;padding:0}' +
    /* the header bar: the collection is visible from the lesson itself, without opening anything */
    '.wow-hdr{display:block;width:100%;box-sizing:border-box;margin:0;border:0;border-top:1px solid var(--line,#e3dfd5);background:transparent;color:inherit;font:inherit;text-align:start;cursor:pointer;padding:0}' +
    '.wow-hdr .in{max-width:760px;margin:0 auto;padding:7px 20px;display:flex;align-items:center;gap:7px;overflow-x:auto;scrollbar-width:none}' +
    '.wow-hdr .in::-webkit-scrollbar{display:none}' +
    '.wow-hdr .chip{display:inline-flex;align-items:center;gap:5px;white-space:nowrap;border:1px solid var(--line,#e3dfd5);border-radius:999px;padding:2px 10px;font-size:.85rem;background:var(--card,#fff);line-height:1.5;flex:none}' +
    '.wow-hdr .chip b{font-weight:700}.wow-hdr .chip .g{opacity:.85}.wow-hdr .chip.grade{border-color:var(--ok,#1f8a5b);background:var(--ok-soft,#ddf3e7)}' +
    /* the way in stays pinned at the start of the row, so a phone-width overflow never hides it */
    '.wow-hdr .go{position:sticky;inset-inline-start:0;z-index:1;flex:none;white-space:nowrap;font-size:.85rem;font-weight:500;color:var(--ink,#1b1b1b);background:var(--bg,#faf8f3);padding-inline-end:8px;text-decoration:underline;text-underline-offset:3px}' +
    /* the "we brought your work back" note */
    '.wow-resumed{position:fixed;inset-inline:12px;bottom:14px;z-index:65;max-width:520px;margin:0 auto;display:flex;align-items:center;gap:10px;flex-wrap:wrap;background:var(--ink,#1b1b1b);color:var(--bg,#faf8f3);border-radius:14px;padding:10px 14px;font-size:.95rem;box-shadow:0 10px 30px rgba(0,0,0,.22)}' +
    '.wow-resumed button{background:transparent;border:0;color:inherit;font:inherit;text-decoration:underline;text-underline-offset:3px;cursor:pointer;padding:0}.wow-resumed .x{margin-inline-start:auto;text-decoration:none;font-size:20px;line-height:1}' +
    '.wow-drawer{position:fixed;inset:0;z-index:60;background:var(--bg,#faf8f3);color:var(--ink,#1b1b1b);overflow:auto;direction:rtl;font-family:inherit;padding:16px 16px 40px}.wow-drawer .in{max-width:720px;margin:0 auto}.wow-drawer h2{margin:8px 0 4px;font-size:1.5rem}.wow-drawer h3{margin:22px 0 8px;font-size:1.1rem}' +
    '.wow-drawer .x{position:sticky;top:0;float:left;background:var(--card,#fff);border:1px solid var(--line,#e3dfd5);border-radius:999px;width:40px;height:40px;font-size:22px;cursor:pointer}' +
    '.wow-drawer .grove{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:10px}.wow-drawer .tree{border:1px solid var(--line,#e3dfd5);border-radius:14px;padding:10px 12px;background:var(--card,#fff)}.wow-drawer .tree .g{font-size:1.4rem}.wow-drawer .tree .bar{height:8px;border-radius:4px;background:var(--line,#e3dfd5);overflow:hidden;margin:6px 0 2px}.wow-drawer .tree .bar i{display:block;height:100%;background:var(--ok,#1f8a5b)}' +
    '.wow-drawer .album{display:grid;grid-template-columns:repeat(auto-fill,minmax(210px,1fr));gap:10px}.wow-drawer .album .card{margin:0;grid-template-columns:auto 1fr}.wow-drawer .album a.card{text-decoration:none;color:inherit;opacity:.7;border-style:dashed}' +
    '.wow-drawer .badges{display:flex;flex-wrap:wrap;gap:8px}.wow-drawer .badge{display:inline-flex;align-items:center;gap:6px;border:1px solid var(--line,#e3dfd5);border-radius:999px;padding:4px 12px;font-size:.9rem;background:var(--card,#fff)}.wow-drawer .badge.locked{opacity:.45}.wow-drawer .badge .g{width:22px;height:22px;border-radius:50%;background:var(--ink,#1b1b1b);color:var(--bg,#fff);display:grid;place-items:center;font-size:.75rem;font-weight:700}' +
    /* the report card: every grade, in one table */
    '.wow-grades{width:100%;border-collapse:collapse;font-size:.95rem}.wow-grades th,.wow-grades td{text-align:right;padding:8px 6px;border-bottom:1px solid var(--line,#e3dfd5);vertical-align:top}.wow-grades th{font-size:.85rem;color:var(--muted,#6b6b66);font-weight:500}' +
    '.wow-grades a{color:inherit}.wow-grades .med{display:inline-block;border-radius:999px;padding:1px 9px;font-size:.8rem;color:#2b2416}.wow-grades .med.bronze{background:#c98b5a}.wow-grades .med.silver{background:#c9ccd3}.wow-grades .med.gold{background:#f2c14e}.wow-grades .med.diamond{background:linear-gradient(135deg,#bfe8ff,#e6d4ff,#bfe8ff)}.wow-grades .med.none{background:var(--line,#e3dfd5);color:var(--muted,#6b6b66)}' +
    '.wow .num,.wow-drawer .num,.wow-hdr .num{direction:ltr;unicode-bidi:isolate;font-variant-numeric:tabular-nums}' +
    '@keyframes wow-pop{0%{transform:scale(.6);opacity:0}70%{transform:scale(1.08)}100%{transform:scale(1);opacity:1}}.wow .medal .m,.wow .card{animation:wow-pop .5s ease-out both}@media (prefers-reduced-motion:reduce){.wow .medal .m,.wow .card{animation:none}}';
  function style() { if (document.getElementById('wow-css')) return; var s = document.createElement('style'); s.id = 'wow-css'; s.textContent = css; document.head.appendChild(s); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function num(n) { return '<span class="num">' + esc(n) + '</span>'; }
  function stageOf(xp) { var i = 0; for (var k = 0; k < STAGES.length; k++) if (xp >= STAGES[k][0]) i = k; return i; }
  function medalHtml(m, big) { return '<span class="m ' + (m || 'none') + '">' + (m ? esc(MEDAL[m]) : '—') + '</span>'; }
  function heDate(d) { return String(d || '').split('-').reverse().join('.'); }
  /** "9/11" — the grade, said plainly, wherever a medal is shown */
  function gradeHtml(r) { return r && typeof r.score === 'number' && r.max ? '<span class="num">' + r.score + '/' + r.max + '</span>' : ''; }

  /* ---------- observe the completion (no engine change needed): the response carries `progress` ---------- */
  var of = window.fetch;
  window.fetch = function (input) {
    var url = typeof input === 'string' ? input : (input && input.url) || '';
    // ארטו's grade costs the kid one of the day's questions. A resume hands back the answer he already
    // gave; with none saved it fails softly, and the page falls back to its own rubric — either way, free.
    if (replaying && /\/arto\/grade(\?|$)/.test(url)) return Promise.resolve(gradeReplay());
    var p = of.apply(this, arguments);
    if (/\/arto\/grade(\?|$)/.test(url)) p.then(cacheGrade).catch(function () {});
    if (/\/kid\/complete(\?|$)/.test(url)) p.then(function (r) { try { r.clone().json().then(function (j) { if (j && j.ok) { mount(j); refresh(); } }).catch(function () {}); } catch (e) {} }).catch(function () {});
    return p;
  };
  var gradeCache = null;
  function cacheGrade(r) { if (r && r.ok) r.clone().text().then(function (t) { gradeCache = t; rsSave(); }).catch(function () {}); }
  function gradeReplay() {
    var body = gradeCache || '{"error":"upstream_error"}';
    return new Response(body, { status: gradeCache ? 200 : 502, headers: { 'content-type': 'application/json' } });
  }

  var lastToday = null;
  function refresh() {
    flush().then(function () { return of(API + '/kid/progress?k=' + encodeURIComponent(TOKEN)); }).then(function (r) { return r.json(); }).then(function (j) {
      if (!j || !j.progress) return;
      mount({ ok: true, progress: j.progress, today: lastToday });
      header(summarize(j.progress));
    }).catch(function () {});
  }
  /** the header bar speaks the same shape whether it came inline with the page or from the API */
  function summarize(p) {
    var results = p.results || [];
    var mine = null;
    for (var i = 0; i < results.length; i++) if (results[i].n === N) mine = results[i];
    return { streak: p.streak, shields: p.shields, cards: (p.cards || []).length, badges: (p.badges || []).length, medal: p.medals ? p.medals[N] || null : null, result: mine };
  }

  /* ---------- the header bar: badges and grades on the lesson itself (no inner page to discover) ---------- */
  var hdr = null;
  function header(p) {
    if (!TOKEN) return;
    p = p || before;
    style();
    if (!hdr) {
      hdr = document.createElement('button');
      hdr.type = 'button';
      hdr.className = 'wow-hdr';
      hdr.setAttribute('data-wow-noreplay', '');
      hdr.setAttribute('aria-label', 'האוסף והציונים שלי');
      hdr.addEventListener('click', openDrawer);
      var tb = document.querySelector('.topbar');
      if (tb) tb.appendChild(hdr);
      else {
        var m = document.querySelector('main') || document.body;
        m.insertAdjacentElement('afterbegin', hdr);
      }
    }
    // the way in first (it survives the overflow), then what the kid has — the streak last, the edition's own
    // top bar already carries it next to their name
    var out = ['<span class="go">האוסף והציונים שלי ›</span>'];
    if (p) {
      out.push('<span class="chip"><span class="g">◆</span><b>' + num(p.cards || 0) + '</b> קלפים</span>');
      out.push('<span class="chip"><span class="g">★</span><b>' + num(p.badges || 0) + '</b> עיטורים</span>');
      if (p.result) out.push('<span class="chip grade">' + (p.result.medal ? esc(MEDAL[p.result.medal]) + ' · ' : 'הציון שלי: ') + gradeHtml(p.result) + '</span>');
      out.push('<span class="chip"><span class="g">🔥</span><b>' + num(p.streak || 0) + '</b> רצף</span>');
      if (p.shields) out.push('<span class="chip"><span class="g">🛡</span><b>' + num(p.shields) + '</b> מגן</span>');
    }
    hdr.innerHTML = '<span class="in">' + out.join('') + '</span>';
  }

  /* ---------- results-screen block ---------- */
  function host() {
    var h = document.querySelector('[data-wow="progress"]');
    if (h) return h;
    var anchor = document.getElementById('badgeNone') || document.getElementById('badges');
    if (!anchor) return null;
    h = document.createElement('div'); h.setAttribute('data-wow', 'progress'); anchor.insertAdjacentElement('afterend', h); return h;
  }
  var mounted = null;
  function mount(j) {
    style();
    var h = host(); if (!h) return;
    if (!TOKEN) { h.innerHTML = '<div class="wow"><p class="small" style="margin:0">עם קישור אישי (ההורים נרשמים, חינם) כל גיליון שמסיימים מוסיף מדליה, קלף לאוסף ושורשים שצומחים לפי הנושא.</p></div>'; return; }
    if (!j || !j.progress) { if (!mounted) h.innerHTML = '<div class="wow"><p class="small" style="margin:0">המדליה, הקלף והשורשים של היום מגיעים ברגע שהתוצאה נשמרת…</p></div>'; return; }
    var p = j.progress, t = j.today || lastToday || {}, out = [];
    if (j.today) lastToday = j.today;
    mounted = p;
    out.push('<div class="medal">' + medalHtml(t.medal) + '<div><h4 style="margin:0">' + (t.medal ? 'המדליה של היום: ' + esc(MEDAL[t.medal]) : 'עוד אין מדליה להיום') + '</h4><p class="small">' + esc(t.next || '') + '</p></div></div>');
    var card = null; for (var i = 0; i < p.cards.length; i++) if (p.cards[i].n === N) card = p.cards[i];
    if (card) {
      var grew = [];
      card.roots.forEach(function (id) { var r = p.roots[id]; if (!r) return; var was = before && before.roots ? before.roots[id] : null; var up = was != null && r.stage > was; grew.push('<span class="chip' + (up ? ' up' : '') + '"><span class="g">' + ROOTS[id][1] + '</span><b>' + esc(ROOTS[id][0]) + '</b> · ' + esc(r.stage_name) + (up ? ' — גדל!' : '') + '</span>'); });
      if (grew.length) out.push('<h4>השורשים שצמחו היום</h4><div class="row">' + grew.join('') + '</div>');
      out.push('<h4>הקלף של היום</h4><div class="card ' + card.medal + '">' + medalHtml(card.medal) + '<div><div class="n">#' + num(card.n) + ' · ' + esc(heDate(card.date)) + '</div><div class="t">' + esc(card.hero || card.title) + '</div><div class="f">' + esc(card.hero ? card.fact || card.title : card.fact || '') + '</div>' + (card.max ? '<div class="s">הציון: ' + gradeHtml(card) + '</div>' : '') + '</div></div>');
    }
    var fresh = p.badges.filter(function (b) { return b.edition_n === N; });
    var shown = {}; Array.prototype.forEach.call(document.querySelectorAll('#badges .badge'), function (b) { var d = b.querySelector('.dot'); shown[(b.textContent.replace(d ? d.textContent : '', '')).trim()] = 1; });
    fresh = fresh.filter(function (b) { return !shown[b.name]; });
    if (fresh.length) out.push('<h4>עיטורים חדשים</h4><div class="row">' + fresh.map(function (b) { return '<span class="chip up"><span class="g">' + esc(b.glyph) + '</span>' + esc(b.name) + '</span>'; }).join('') + '</div>');
    var fe = (p.feathers_by_edition || {})[N];
    if (fe && Object.keys(fe).length) {
      out.push('<h4>נוצות לכנפיים</h4><div class="row">' + WING_ORDER.filter(function (w) { return fe[w]; }).map(function (w) { var lv = p.wings && p.wings[w] ? p.wings[w].level : 1; var was = before && before.wings ? before.wings[w] : null; var up = was != null && lv > was; return '<span class="chip' + (up ? ' up' : '') + '"><span class="g">' + WINGS[w][1] + '</span><b>' + esc(WINGS[w][0]) + '</b> +' + num(fe[w]) + (up ? ' — רמה ' + num(lv) + '!' : '') + '</span>'; }).join('') + '</div>');
    }
    if (p.journey && p.journey.goals) {
      out.push('<h4>המסע של השבוע</h4><div class="row">' + p.journey.goals.map(function (g) { return '<span class="chip' + (g.done ? ' up' : '') + '">' + (g.done ? '✓ ' : '') + esc(g.text) + ' <span class="num">' + g.progress + '/' + g.target + '</span></span>'; }).join('') + '</div>' + (p.journey.complete ? '<p class="small">מסע מושלם השבוע.</p>' : ''));
    }
    if (p.shields > 0 || (before && before.shields > p.shields)) out.push('<p class="small">מגן רצף: ' + num(p.shields) + (before && before.shields > p.shields ? ' — המגן שמר על הרצף.' : ' · כל 7 ימים ברצף מרוויחים מגן, והוא סופג יום אחד שפספסתם.') + '</p>');
    out.push('<p class="small">' + num(p.cards.length) + ' קלפים · ' + num(p.badges.length) + ' עיטורים</p><button class="btn" type="button" data-wow-open>השורשים והכנפיים שלי</button>');
    h.innerHTML = '<div class="wow">' + out.join('') + '</div>';
    h.querySelector('[data-wow-open]').addEventListener('click', openDrawer);
  }

  /* ---------- hero strip: the reward is visible before the work ---------- */
  function strip() {
    if (!TOKEN || !before) return;
    var sb = document.getElementById('startBtn'); if (!sb) return;
    var target = sb.parentElement || sb;
    style();
    var el = document.createElement('div'); el.className = 'wow-strip'; el.setAttribute('data-wow-noreplay', '');
    var parts = ['<span class="chip">רצף ' + num(before.streak) + '</span>'];
    if (before.shields > 0) parts.push('<span class="chip">מגן ' + num(before.shields) + '</span>');
    parts.push('<span class="chip">' + num(before.cards) + ' קלפים</span>');
    parts.push(before.medal ? '<span class="chip">היום כבר יש: ' + esc(MEDAL[before.medal]) + (before.result ? ' · ' + gradeHtml(before.result) : '') + ' — אפשר לשפר</span>' : '<span class="chip">היום: קלף חדש מחכה</span>');
    parts.push('<button type="button">האוסף שלי</button>');
    var notes = (before.notices || []).map(function (n) { var pl = n.payload || {}; if (n.kind === 'badge' && pl.n && pl.n >= 8) return 'בגיליון #' + pl.edition_n + ' רק ' + pl.correct + ' מתוך ' + pl.n + ' ילדים ענו נכון בניסיון הראשון על השאלה הקשה — ו' + G('אתה ביניהם', 'את ביניהם') + '. עיטור חדש: ' + pl.name + '.'; if (n.kind === 'badge') return 'עיטור חדש מאתמול: ' + pl.name + '.'; return ''; }).filter(Boolean);
    if (notes.length) parts.push('<span class="chip up" style="flex-basis:100%">' + notes.map(esc).join(' ') + '</span>');
    if (before.journey && before.journey.goals) { var left = before.journey.goals.filter(function (g) { return !g.done; }); if (left.length) parts.push('<span class="small" style="flex-basis:100%">המסע של השבוע: ' + esc(left[0].text) + ' <span class="num">' + left[0].progress + '/' + left[0].target + '</span></span>'); }
    el.innerHTML = parts.join('');
    el.querySelector('button').addEventListener('click', openDrawer);
    target.insertAdjacentElement('beforebegin', el);
  }

  /* ---------- the drawer ---------- */
  var drawer = null;
  function openDrawer() {
    if (!TOKEN) return;
    style();
    if (!drawer) { drawer = document.createElement('div'); drawer.className = 'wow-drawer'; drawer.setAttribute('role', 'dialog'); drawer.setAttribute('aria-label', 'השורשים והכנפיים שלי'); drawer.setAttribute('data-wow-noreplay', ''); document.body.appendChild(drawer); }
    drawer.innerHTML = '<div class="in"><button class="x" type="button" aria-label="סגירה">×</button><h2>השורשים והכנפיים שלי</h2><p class="small">טוענים…</p></div>';
    drawer.hidden = false; document.body.style.overflow = 'hidden';
    drawer.querySelector('.x').addEventListener('click', closeDrawer);
    of(API + '/kid/progress?k=' + encodeURIComponent(TOKEN)).then(function (r) { return r.json(); }).then(render).catch(function () { drawer.querySelector('.in').innerHTML += '<p>לא הצלחנו לטעון. נסו שוב עוד רגע.</p>'; });
  }
  function closeDrawer() { if (drawer) drawer.hidden = true; document.body.style.overflow = ''; }
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') closeDrawer(); });
  function lessonHref(n) { return '/l/' + n + (RT.kidToken && /[?&]k=/.test(location.search) ? '?k=' + encodeURIComponent(TOKEN) : ''); }
  function render(j) {
    if (!j || !j.progress) return;
    var p = j.progress, defs = j.defs || [], out = [];
    out.push('<button class="x" type="button" aria-label="סגירה">×</button><h2>השורשים והכנפיים שלי</h2>');
    out.push('<p class="small">רצף ' + num(p.streak) + (p.shields ? ' · מגן ' + num(p.shields) : '') + ' · ' + num(p.xp) + ' נקודות · ' + num(p.cards.length) + ' קלפים · ' + num(p.badges.length) + ' עיטורים</p>');
    // the grades first: it is the thing kids come here to look for
    out.push(gradesHtml(p));
    out.push('<h3>שורשים — מה ' + G('למדת', 'למדת') + '</h3><div class="grove">');
    ROOT_ORDER.forEach(function (id) { var r = p.roots[id] || { xp: 0, stage: 0, stage_name: 'זרע', next: 60 }; var floor = STAGES[r.stage][0], span = r.next ? r.next - floor : 1, pct = r.next ? Math.round(((r.xp - floor) / span) * 100) : 100; out.push('<div class="tree"><div class="g">' + ROOTS[id][1] + '</div><b>' + esc(ROOTS[id][0]) + '</b><div class="small">' + esc(r.stage_name) + '</div><div class="bar"><i style="width:' + pct + '%"></i></div><div class="small">' + (r.next ? 'עוד ' + num(r.next - r.xp) + ' לשלב הבא' : 'השלב הגבוה ביותר') + '</div></div>'); });
    out.push('</div>');
    var sk = p.skills ? Object.keys(p.skills) : [];
    if (sk.length) {
      sk.sort(function (a, b) { return (p.skills[b].mastered - p.skills[a].mastered) || (p.skills[b].first_try - p.skills[a].first_try); });
      out.push('<p class="small">עלים — כישורים שפגשת: ' + sk.map(function (k) { var x = p.skills[k]; return '<span class="chip' + (x.mastered ? ' up' : '') + '" title="' + esc(x.first_try + ' הצלחות בניסיון ראשון ב-' + x.editions + ' גיליונות') + '">' + (x.mastered ? '✓ ' : '') + esc(x.name) + '</span>'; }).join(' ') + '</p>');
    }
    out.push('<h3>כנפיים — איך ' + G('אתה חושב', 'את חושבת') + '</h3><div class="grove">');
    WING_ORDER.forEach(function (w) { var x = (p.wings && p.wings[w]) || { feathers: 0, level: 1, next: 10 }; var floor = WING_LEVELS[x.level - 1] || 0, span = x.next ? x.next - floor : 1, pct = x.next ? Math.round(((x.feathers - floor) / span) * 100) : 100; out.push('<div class="tree"><div class="g">' + WINGS[w][1] + '</div><b>' + esc(WINGS[w][0]) + '</b><div class="small">רמה ' + num(x.level) + ' · ' + num(x.feathers) + ' נוצות</div><div class="bar"><i style="width:' + pct + '%"></i></div></div>'); });
    out.push('</div>');
    if (p.journey && p.journey.goals) out.push('<h3>המסע של השבוע</h3><div class="badges">' + p.journey.goals.map(function (g) { return '<span class="badge' + (g.done ? '' : ' locked') + '"><span class="g">' + (g.done ? '✓' : '○') + '</span>' + esc(g.text) + ' <span class="num">' + g.progress + '/' + g.target + '</span></span>'; }).join('') + '</div>');
    out.push('<h3>האלבום — מדליות וקלפים</h3><div class="album">');
    p.cards.forEach(function (c) { out.push('<div class="card ' + c.medal + '">' + medalHtml(c.medal) + '<div><div class="n">#' + num(c.n) + ' · ' + esc(heDate(c.date)) + '</div><div class="t">' + esc(c.hero || c.title) + '</div><div class="f">' + esc(c.hero ? c.fact || c.title : c.fact || '') + '</div>' + (c.max ? '<div class="s">הציון: ' + gradeHtml(c) + '</div>' : '') + '</div></div>'); });
    p.missing.forEach(function (m) { out.push('<a class="card" href="' + lessonHref(m.n) + '">' + medalHtml(null) + '<div><div class="n">#' + num(m.n) + ' · ' + esc(heDate(m.date)) + '</div><div class="t">' + esc(m.title) + '</div><div class="f">עוד לא — אפשר להשלים מהספרייה</div></div></a>'); });
    out.push('</div>');
    var have = {}; p.badges.forEach(function (b) { have[b.id] = b; });
    out.push('<h3>העיטורים</h3><div class="badges">');
    p.badges.forEach(function (b) { out.push('<span class="badge" title="' + esc(b.earned_at.slice(0, 10)) + '"><span class="g">' + esc(b.glyph) + '</span>' + esc(b.name) + '</span>'); });
    defs.forEach(function (d) { if (have[d.id] || /^(root|wing)_/.test(d.id)) return; out.push('<span class="badge locked" title="' + esc(d.hint || '') + '"><span class="g">' + (d.hidden ? '?' : esc(d.glyph)) + '</span>' + (d.hidden ? 'עיטור סודי' : esc(d.name)) + '</span>'); });
    out.push('</div><p class="small">עיטורי השורשים (שתיל, עץ, עץ עתיק) מגיעים כשהשורשים גדלים.</p>');
    drawer.querySelector('.in').innerHTML = out.join('');
    drawer.querySelector('.x').addEventListener('click', closeDrawer);
  }

  /** The report card: every edition the kid answered, grade and medal, newest first. */
  function gradesHtml(p) {
    var rows = p.results || [];
    if (!rows.length) return '<h3>הציונים שלי</h3><p class="small">עוד אין ציונים כאן. הגיליון הראשון ' + G('שתסיים', 'שתסיימי') + ' יופיע ברשימה הזאת.</p>';
    var out = ['<h3>הציונים שלי</h3><table class="wow-grades"><thead><tr><th>גיליון</th><th>ציון</th><th>מדליה</th></tr></thead><tbody>'];
    rows.forEach(function (r) {
      out.push(
        '<tr><td><a href="' + lessonHref(r.n) + '">#' + num(r.n) + ' ' + esc(r.title) + '</a><div class="small">' + esc(heDate(r.date)) + (r.complete ? '' : ' · לא הושלם') + (r.late ? ' · השלמה מאוחרת' : '') + '</div></td>' +
          '<td>' + gradeHtml(r) + '<div class="small">' + num(r.pct + '%') + (r.stars ? ' · הסבר ' + '★'.repeat(r.stars) : '') + '</div></td>' +
          '<td><span class="med ' + (r.medal || 'none') + '">' + (r.medal ? esc(MEDAL[r.medal]) : '—') + '</span></td></tr>',
      );
    });
    out.push('</tbody></table><p class="small">גיליון שכבר סיימתם אפשר לפתוח שוב — ציון טוב יותר מחליף את הקודם.</p>');
    return out.join('');
  }

  /* ---------- resume: leaving the lesson and coming back must not cost the work ----------
   * The engine holds the lesson in one state object and rebuilds its own DOM from its own handlers, so the
   * only faithful way to bring a half-finished lesson back is to replay what the kid actually did: every
   * click and every field value, in order, against the live page. The handlers then produce exactly what
   * they produced the first time — the same feedback, the same score, the same canvases — and none of this
   * has to know what any particular edition looks like.
   * The assistant, the menus and our own chrome are never recorded: replaying a question to ארטו would
   * spend the day's quota on words the kid already read. */
  var RS_V = 1, RS_MAX = 400, RS_AGE = 30 * 24 * 3600e3;
  var RS_KEY = 'wow-resume:' + ((RT.edition && RT.edition.code) || N || 'x') + (TOKEN ? ':' + String(TOKEN).slice(0, 8) : '');
  var RS_SKIP = '#chat,#fab,#gate,#micBtn,#rw-menu,#rw-strip,#toast,.wow,.wow-strip,.wow-hdr,.wow-drawer,.wow-resumed,[data-wow-noreplay]';
  /** anything that reloads or leaves the page: recording it would make the next load bounce for ever */
  var RS_RELOADS = /\b(restart|location\s*\.\s*(reload|href|assign|replace))\s*\(?/;
  var RS_ATTRS = ['data-i', 'data-id', 'data-n', 'data-pick', 'data-step', 'data-wow', 'name', 'type'];
  var log = [], replaying = false, saveTimer = null, appEl = null;

  function app() { return appEl || (appEl = document.getElementById('app') || document.querySelector('main') || document.body); }
  function inLesson(el) { try { return !!(el && app().contains(el) && !el.closest(RS_SKIP)); } catch (e) { return false; } }
  function attr(v) { return String(v).replace(/["\\]/g, '\\$&'); }
  function seg(el) {
    if (el.id) return '#' + el.id.replace(/([^\w-])/g, '\\$1');
    var t = el.tagName.toLowerCase();
    for (var i = 0; i < RS_ATTRS.length; i++) if (el.hasAttribute(RS_ATTRS[i])) return t + '[' + RS_ATTRS[i] + '="' + attr(el.getAttribute(RS_ATTRS[i])) + '"]';
    var idx = 1, s = el;
    while ((s = s.previousElementSibling)) if (s.tagName === el.tagName) idx++;
    return t + ':nth-of-type(' + idx + ')';
  }
  /** A selector anchored either on an id inside the lesson or on the lesson root, so it can never drift. */
  function path(el) {
    var parts = [], node = el, top = app(), byId = false;
    while (node && node !== top && node.nodeType === 1 && parts.length < 12) {
      parts.unshift(seg(node));
      if (node.id) { byId = true; break; }
      node = node.parentElement;
    }
    if (byId) return parts.join('>');
    return (node === top ? ':scope>' : '') + parts.join('>');
  }
  function find(p) { try { return app().querySelector(p); } catch (e) { return null; } }

  function rsClear() { log = []; gradeCache = null; try { localStorage.removeItem(RS_KEY); } catch (e) {} }
  /** one lesson a day for a year is a lot of keys: drop the ones that have aged out */
  function rsSweep() {
    try {
      var kill = [], i, k, d;
      for (i = 0; i < localStorage.length; i++) {
        k = localStorage.key(i);
        if (!k || k.indexOf('wow-resume:') !== 0 || k === RS_KEY) continue;
        try { d = JSON.parse(localStorage.getItem(k) || 'null'); } catch (e) { d = null; }
        if (!d || d.v !== RS_V || Date.now() - (d.at || 0) > RS_AGE) kill.push(k);
      }
      kill.forEach(function (x) { localStorage.removeItem(x); });
    } catch (e) {}
  }
  function rsFlush() {
    if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
    if (replaying) return;
    try {
      if (!log.length) return localStorage.removeItem(RS_KEY);
      localStorage.setItem(RS_KEY, JSON.stringify({ v: RS_V, at: Date.now(), n: N, log: log, grade: gradeCache }));
    } catch (e) {}
  }
  function rsSave() { if (replaying) return; if (saveTimer) clearTimeout(saveTimer); saveTimer = setTimeout(rsFlush, 300); }
  function rsPush(g) { if (log.length >= RS_MAX) return; log.push(g); rsSave(); }
  /** a field keeps its place in the story and only its value moves — the last value is the one that counts */
  function rsValue(p, kind, v) {
    for (var i = 0; i < log.length; i++) if (log[i].s === p && log[i].t === kind) { log[i].v = v; return rsSave(); }
    rsPush({ t: kind, s: p, v: v });
  }

  function watchGestures() {
    document.addEventListener('click', function (e) {
      if (replaying) return;
      var t = e.target;
      if (!t || !t.closest) return;
      var el = t.closest('button,summary,[onclick],[role="button"]');
      if (!el || el.tagName === 'A' || el.tagName === 'INPUT' || el.closest('label') || !inLesson(el)) return;
      // the lesson's own "start over": forget the work rather than record the button that throws it away
      if (RS_RELOADS.test(el.getAttribute('onclick') || '')) return rsClear();
      rsPush({ t: 'c', s: path(el) });
    }, true);
    var onValue = function (e) {
      if (replaying) return;
      var el = e.target;
      if (!el || !el.tagName || !/^(INPUT|SELECT|TEXTAREA)$/.test(el.tagName) || !inLesson(el)) return;
      if (el.type === 'checkbox' || el.type === 'radio') { if (e.type === 'change') rsValue(path(el), 'k', el.checked ? 1 : 0); return; }
      rsValue(path(el), 'v', String(el.value));
    };
    document.addEventListener('input', onValue, true);
    document.addEventListener('change', onValue, true);
    document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'hidden') rsFlush(); });
    window.addEventListener('pagehide', rsFlush);
  }

  function rsLoad() {
    try {
      var d = JSON.parse(localStorage.getItem(RS_KEY) || 'null');
      if (!d || d.v !== RS_V || !d.log || !d.log.length) return null;
      if (Date.now() - (d.at || 0) > RS_AGE) { rsClear(); return null; }
      return d;
    } catch (e) { return null; }
  }
  function fire(el, type) { el.dispatchEvent(new Event(type, { bubbles: true })); }
  function tick() { return new Promise(function (r) { setTimeout(r, 0); }); }
  /** Some of the lesson is written by an await (the graded explanation): give a missing target a moment. */
  function waiting(sel, budget) {
    var el = find(sel);
    if (el || budget.left <= 0) return Promise.resolve(el);
    return new Promise(function (res) {
      var t0 = Date.now();
      (function poll() {
        var e = find(sel), spent = Date.now() - t0;
        if (e || spent >= Math.min(2000, budget.left)) { budget.left -= spent; return res(e); }
        setTimeout(poll, 50);
      })();
    });
  }
  function resume() {
    var d = rsLoad();
    if (!d) return Promise.resolve();
    gradeCache = d.grade || null;
    var gs = d.log, i = 0, done = 0, quiet = window.toast, budget = { left: 5000 };
    replaying = true;
    if (typeof quiet === 'function') { try { window.toast = function () {}; } catch (e) {} }
    function one() {
      if (i >= gs.length) return Promise.resolve();
      var g = gs[i++];
      return waiting(g.s, budget).then(function (el) {
        if (el) {
          try {
            if (g.t === 'c') { if (!RS_RELOADS.test(el.getAttribute('onclick') || '')) { el.click(); done++; } }
            else if (g.t === 'k') { el.checked = !!g.v; fire(el, 'change'); done++; }
            else { el.value = g.v; fire(el, 'input'); fire(el, 'change'); done++; }
          } catch (e) {}
        }
        return tick().then(one);
      });
    }
    return one().then(function () {
      replaying = false;
      if (typeof quiet === 'function') { try { window.toast = quiet; } catch (e) {} }
      if (!done) return;
      log = gs.slice();
      var step = null;
      try { step = typeof S !== 'undefined' && S ? S.step : null; } catch (e) {}
      var sec = step ? document.querySelector('.step[data-step="' + step + '"]') : null;
      if (sec) requestAnimationFrame(function () { try { sec.scrollIntoView({ behavior: 'auto', block: 'start' }); } catch (e) {} });
      resumedNote();
    }, function () {
      replaying = false;
      if (typeof quiet === 'function') { try { window.toast = quiet; } catch (e) {} }
    });
  }
  function resumedNote() {
    style();
    var el = document.createElement('div');
    el.className = 'wow-resumed';
    el.setAttribute('data-wow-noreplay', '');
    el.setAttribute('role', 'status');
    el.innerHTML = '<span>המשכנו מאיפה שהפסקת 👋</span><button type="button" data-restart>להתחיל מחדש</button><button type="button" class="x" aria-label="סגירה">×</button>';
    document.body.appendChild(el);
    el.querySelector('[data-restart]').addEventListener('click', function () {
      rsClear();
      if (typeof window.restart === 'function') { try { return window.restart(); } catch (e) {} }
      location.reload();
    });
    el.querySelector('.x').addEventListener('click', function () { el.remove(); });
    setTimeout(function () { if (el.parentNode) el.remove(); }, 12000);
  }

  /* the engine fills #badges in finish(): that is the results screen appearing (demo mode never POSTs, so this is
     the only signal there; in kid mode the completion response then replaces the placeholder with the server's truth) */
  function watchResults() {
    var bb = document.getElementById('badges');
    if (!bb || !window.MutationObserver) return;
    new MutationObserver(function () { if (!mounted) mount(null); }).observe(bb, { childList: true });
  }
  /** the engine boots asynchronously in kid mode (the profile has to arrive); nothing is replayed before that */
  function whenBooted(cb) {
    var t0 = Date.now();
    (function poll() {
      var sb = document.getElementById('startBtn');
      var mode = document.body.dataset.runtime;
      var ready = mode === 'demo' || (!!mode && !!sb && !sb.disabled) || (!RT.edition && document.readyState !== 'loading');
      if (ready || Date.now() - t0 > 8000) return setTimeout(cb, 0);
      setTimeout(poll, 60);
    })();
  }
  function init() {
    header();
    strip();
    watchResults();
    whenBooted(function () {
      var done;
      try { done = resume(); } catch (e) {}
      Promise.resolve(done).catch(function () {}).then(function () {
        // the engine's own "start over" throws the work away: ours goes with it, however it was reached
        if (typeof window.restart === 'function') { var r0 = window.restart; window.restart = function () { rsClear(); return r0.apply(this, arguments); }; }
        watchGestures();
        rsSweep();
      });
    });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
