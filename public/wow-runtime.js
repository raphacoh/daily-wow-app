/* שורשים וכנפיים — gamification runtime (docs/gamification-spec.md §8.1).
 * Served by the app and injected before every edition fragment, so it evolves on deploy and works on old
 * editions too. Renders the results-screen progress block and the "my roots and wings" drawer from the
 * server's truth; buffers WOW.emit() events (P1 posts them). No dependency on the edition beyond a few ids. */
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
    v: 2,
    emit: function (type, payload) {
      var p = payload || {};
      buf.push({ t: type, p: p, at: Date.now() }); if (buf.length > 200) buf.shift();
      if (!TOKEN) return;
      if (type === 'item' || type === 'predict') pending.push({ id: p.id, kind: type === 'predict' ? 'predict' : p.kind, correct: p.correct, partial: p.partial, attempt: p.attempt, stars: p.stars, graded: p.graded, value: p.value, target: p.target });
      else if (type === 'open') pending.push({ id: 'open:' + p.id, kind: 'open', attempt: 1 });
      if (type === 'finish' || pending.length >= 10) flush();
    },
    events: function () { return buf.slice(); },
    flush: flush,
    mount: mount,
    open: openDrawer,
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
    '.wow .card .n{font-size:.8rem;color:var(--muted,#6b6b66)}.wow .card .t{font-weight:700}.wow .card .f{font-size:.92rem;color:var(--muted,#6b6b66)}' +
    '.wow .small{font-size:.9rem;color:var(--muted,#6b6b66);margin:2px 0}.wow .btn{display:inline-block;margin-top:8px;border:0;border-radius:999px;padding:10px 18px;background:var(--ink,#1b1b1b);color:var(--bg,#fff);font:inherit;font-weight:600;cursor:pointer}' +
    '.wow-strip{display:flex;flex-wrap:wrap;gap:8px 14px;align-items:center;margin:0 0 14px;font-size:.95rem}.wow-strip .chip{display:inline-flex;gap:6px;align-items:center;border:1px solid var(--line,#e3dfd5);border-radius:999px;padding:3px 10px;background:var(--card,#fff)}.wow-strip button{background:transparent;border:0;font:inherit;color:inherit;text-decoration:underline;text-underline-offset:3px;cursor:pointer;padding:0}' +
    '.wow-drawer{position:fixed;inset:0;z-index:60;background:var(--bg,#faf8f3);color:var(--ink,#1b1b1b);overflow:auto;direction:rtl;font-family:inherit;padding:16px 16px 40px}.wow-drawer .in{max-width:720px;margin:0 auto}.wow-drawer h2{margin:8px 0 4px;font-size:1.5rem}.wow-drawer h3{margin:22px 0 8px;font-size:1.1rem}' +
    '.wow-drawer .x{position:sticky;top:0;float:left;background:var(--card,#fff);border:1px solid var(--line,#e3dfd5);border-radius:999px;width:40px;height:40px;font-size:22px;cursor:pointer}' +
    '.wow-drawer .grove{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:10px}.wow-drawer .tree{border:1px solid var(--line,#e3dfd5);border-radius:14px;padding:10px 12px;background:var(--card,#fff)}.wow-drawer .tree .g{font-size:1.4rem}.wow-drawer .tree .bar{height:8px;border-radius:4px;background:var(--line,#e3dfd5);overflow:hidden;margin:6px 0 2px}.wow-drawer .tree .bar i{display:block;height:100%;background:var(--ok,#1f8a5b)}' +
    '.wow-drawer .album{display:grid;grid-template-columns:repeat(auto-fill,minmax(210px,1fr));gap:10px}.wow-drawer .album .card{margin:0;grid-template-columns:auto 1fr}.wow-drawer .album a.card{text-decoration:none;color:inherit;opacity:.7;border-style:dashed}' +
    '.wow-drawer .badges{display:flex;flex-wrap:wrap;gap:8px}.wow-drawer .badge{display:inline-flex;align-items:center;gap:6px;border:1px solid var(--line,#e3dfd5);border-radius:999px;padding:4px 12px;font-size:.9rem;background:var(--card,#fff)}.wow-drawer .badge.locked{opacity:.45}.wow-drawer .badge .g{width:22px;height:22px;border-radius:50%;background:var(--ink,#1b1b1b);color:var(--bg,#fff);display:grid;place-items:center;font-size:.75rem;font-weight:700}' +
    '.wow .num,.wow-drawer .num{direction:ltr;unicode-bidi:isolate;font-variant-numeric:tabular-nums}' +
    '@keyframes wow-pop{0%{transform:scale(.6);opacity:0}70%{transform:scale(1.08)}100%{transform:scale(1);opacity:1}}.wow .medal .m,.wow .card{animation:wow-pop .5s ease-out both}@media (prefers-reduced-motion:reduce){.wow .medal .m,.wow .card{animation:none}}';
  function style() { if (document.getElementById('wow-css')) return; var s = document.createElement('style'); s.id = 'wow-css'; s.textContent = css; document.head.appendChild(s); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function num(n) { return '<span class="num">' + esc(n) + '</span>'; }
  function stageOf(xp) { var i = 0; for (var k = 0; k < STAGES.length; k++) if (xp >= STAGES[k][0]) i = k; return i; }
  function medalHtml(m, big) { return '<span class="m ' + (m || 'none') + '">' + (m ? esc(MEDAL[m]) : '—') + '</span>'; }

  /* ---------- observe the completion (no engine change needed): the response carries `progress` ---------- */
  var of = window.fetch;
  window.fetch = function (input) {
    var url = typeof input === 'string' ? input : (input && input.url) || '';
    var p = of.apply(this, arguments);
    if (/\/kid\/complete(\?|$)/.test(url)) p.then(function (r) { try { r.clone().json().then(function (j) { if (j && j.ok) { mount(j); refresh(); } }).catch(function () {}); } catch (e) {} }).catch(function () {});
    return p;
  };

  var lastToday = null;
  function refresh() {
    flush().then(function () { return of(API + '/kid/progress?k=' + encodeURIComponent(TOKEN)); }).then(function (r) { return r.json(); }).then(function (j) { if (j && j.progress) mount({ ok: true, progress: j.progress, today: lastToday }); }).catch(function () {});
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
      out.push('<h4>הקלף של היום</h4><div class="card ' + card.medal + '">' + medalHtml(card.medal) + '<div><div class="n">#' + num(card.n) + ' · ' + esc(card.date.split('-').reverse().join('.')) + '</div><div class="t">' + esc(card.hero || card.title) + '</div><div class="f">' + esc(card.hero ? card.fact || card.title : card.fact || '') + '</div></div></div>');
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
    var el = document.createElement('div'); el.className = 'wow-strip';
    var parts = ['<span class="chip">רצף ' + num(before.streak) + '</span>'];
    if (before.shields > 0) parts.push('<span class="chip">מגן ' + num(before.shields) + '</span>');
    parts.push('<span class="chip">' + num(before.cards) + ' קלפים</span>');
    parts.push(before.medal ? '<span class="chip">היום כבר יש: ' + esc(MEDAL[before.medal]) + ' — אפשר לשפר</span>' : '<span class="chip">היום: קלף חדש מחכה</span>');
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
    if (!drawer) { drawer = document.createElement('div'); drawer.className = 'wow-drawer'; drawer.setAttribute('role', 'dialog'); drawer.setAttribute('aria-label', 'השורשים והכנפיים שלי'); document.body.appendChild(drawer); }
    drawer.innerHTML = '<div class="in"><button class="x" type="button" aria-label="סגירה">×</button><h2>השורשים והכנפיים שלי</h2><p class="small">טוענים…</p></div>';
    drawer.hidden = false; document.body.style.overflow = 'hidden';
    drawer.querySelector('.x').addEventListener('click', closeDrawer);
    of(API + '/kid/progress?k=' + encodeURIComponent(TOKEN)).then(function (r) { return r.json(); }).then(render).catch(function () { drawer.querySelector('.in').innerHTML += '<p>לא הצלחנו לטעון. נסו שוב עוד רגע.</p>'; });
  }
  function closeDrawer() { if (drawer) drawer.hidden = true; document.body.style.overflow = ''; }
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') closeDrawer(); });
  function render(j) {
    if (!j || !j.progress) return;
    var p = j.progress, defs = j.defs || [], out = [];
    out.push('<button class="x" type="button" aria-label="סגירה">×</button><h2>השורשים והכנפיים שלי</h2>');
    out.push('<p class="small">רצף ' + num(p.streak) + (p.shields ? ' · מגן ' + num(p.shields) : '') + ' · ' + num(p.xp) + ' נקודות · ' + num(p.cards.length) + ' קלפים · ' + num(p.badges.length) + ' עיטורים</p>');
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
    p.cards.forEach(function (c) { out.push('<div class="card ' + c.medal + '">' + medalHtml(c.medal) + '<div><div class="n">#' + num(c.n) + ' · ' + esc(c.date.split('-').reverse().join('.')) + '</div><div class="t">' + esc(c.hero || c.title) + '</div><div class="f">' + esc(c.hero ? c.fact || c.title : c.fact || '') + '</div></div></div>'); });
    p.missing.forEach(function (m) { out.push('<a class="card" href="/l/' + m.n + '?k=' + encodeURIComponent(TOKEN) + '">' + medalHtml(null) + '<div><div class="n">#' + num(m.n) + ' · ' + esc(m.date.split('-').reverse().join('.')) + '</div><div class="t">' + esc(m.title) + '</div><div class="f">עוד לא — אפשר להשלים מהספרייה</div></div></a>'); });
    out.push('</div>');
    var have = {}; p.badges.forEach(function (b) { have[b.id] = b; });
    out.push('<h3>העיטורים</h3><div class="badges">');
    p.badges.forEach(function (b) { out.push('<span class="badge" title="' + esc(b.earned_at.slice(0, 10)) + '"><span class="g">' + esc(b.glyph) + '</span>' + esc(b.name) + '</span>'); });
    defs.forEach(function (d) { if (have[d.id] || /^(root|wing)_/.test(d.id)) return; out.push('<span class="badge locked" title="' + esc(d.hint || '') + '"><span class="g">' + (d.hidden ? '?' : esc(d.glyph)) + '</span>' + (d.hidden ? 'עיטור סודי' : esc(d.name)) + '</span>'); });
    out.push('</div><p class="small">עיטורי השורשים (שתיל, עץ, עץ עתיק) מגיעים כשהשורשים גדלים.</p>');
    drawer.querySelector('.in').innerHTML = out.join('');
    drawer.querySelector('.x').addEventListener('click', closeDrawer);
  }

  /* the engine fills #badges in finish(): that is the results screen appearing (demo mode never POSTs, so this is
     the only signal there; in kid mode the completion response then replaces the placeholder with the server's truth) */
  function watchResults() {
    var bb = document.getElementById('badges');
    if (!bb || !window.MutationObserver) return;
    new MutationObserver(function () { if (!mounted) mount(null); }).observe(bb, { childList: true });
  }
  function init() { strip(); watchResults(); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
