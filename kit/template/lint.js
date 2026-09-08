#!/usr/bin/env node
'use strict';
/**
 * lint.js — a zero-dependency linter for "Daily Wow" edition HTML fragments
 * (Hebrew, RTL, interactive lesson pages).
 *
 * Usage:
 *   node lint.js edition-template.html [more.html ...]
 *   node lint.js --json edition-template.html      # findings as JSON on stdout
 *
 * Output:  file:line: rule: message            (error   — exits 1)
 *          file:line: warn: rule: message      (warning — does not fail)
 *          LINT: ok                            (printed when there are no errors)
 *
 * Rules
 *   1. math-outside-span   (error) digit-operator-digit (÷ × + − - = / * ≈ %) in markup
 *                          text or in a JS string literal, not wrapped in
 *                          <span class="math">…</span> (or <b|span class="num">).
 *                          RTL text mangles bare LTR expressions.
 *   2. gendered-outside-g  (warn)  second-person singular Hebrew forms in SHARED
 *                          markup (outside any [data-track] block) that are not
 *                          wrapped in <span data-g="masc|fem"> / produced by G('m','f').
 *   3. level-twins         (error) every [data-level=advanced] needs a same-tag
 *                          sibling [data-level=standard] and vice versa; the file
 *                          needs both data-track values, a .panel.challenge, an
 *                          input#numAdv and a checkChallenge function.
 *   4. runtime-bootstrap   (warn)  the script must mention RUNTIME.
 *   5. no-emoji-in-text    (warn)  emoji in main-content markup text (the .lock,
 *                          .fab and .vault decorations are exempt).
 *
 * Deliberate false-positive suppressions (rule 1): dates/ISO/times, unspaced
 * hyphens (8-9 ranges, SVG path data), unspaced simple fractions (1/50),
 * en dashes (– is not a minus), a lone trailing % or °, URLs, and HTML attribute
 * values (the markup scanner only ever looks at text nodes).
 *
 * Manual suppression inside <script>
 *   A JS comment  /* lint-ignore: math *\/  or  // lint-ignore: math
 *   silences math-outside-span for every string/template literal that STARTS on
 *   the comment's own line or on the line immediately after it.  Use `gendered`
 *   for gendered-outside-g, and a comma-separated list for both:
 *       // lint-ignore: math, gendered
 *   This is for literals that never reach the DOM — LLM prompts, log messages,
 *   analytics payloads — where the RTL/markup rules simply do not apply, e.g.
 *       /* lint-ignore: math *\/
 *       const prompt = 'הסבר לילד/ה למה 360 ÷ 7.2 = 50 ...';
 *   The marker only works in JS; markup text nodes are never exempt.
 *
 * Exported for tests:  const { lint } = require('./lint.js'); lint(html, name)
 */

/* ---------------------------------------------------------------- helpers */
const lineStarts = src => { const a = [0]; for (let i = 0; i < src.length; i++) if (src[i] === '\n') a.push(i + 1); return a; };
const lineAt = (starts, off) => { let lo = 0, hi = starts.length - 1; while (lo < hi) { const mid = (lo + hi + 1) >> 1; starts[mid] <= off ? lo = mid : hi = mid - 1; } return lo + 1; };
const classesOf = n => String((n.attrs && n.attrs.class) || '').trim().split(/\s+/);
const hasClass = (n, c) => classesOf(n).includes(c);
const chain = n => { const out = []; for (let p = n; p; p = p.parent) out.push(p); return out; };

/* ------------------------------------------------------- markup scanner */
const VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr']);

function parseTag(src, lt) {
  const m = /^<([a-zA-Z][a-zA-Z0-9-]*)/.exec(src.slice(lt, lt + 40));
  if (!m) return null;
  const attrs = {};
  let i = lt + m[0].length;
  while (i < src.length) {
    while (i < src.length && /\s/.test(src[i])) i++;
    if (src[i] === '>') return { name: m[1].toLowerCase(), attrs, end: i + 1, selfClose: false };
    if (src[i] === '/' && src[i + 1] === '>') return { name: m[1].toLowerCase(), attrs, end: i + 2, selfClose: true };
    const nm = /^[^\s=>/]+/.exec(src.slice(i, i + 200));
    if (!nm) { i++; continue; }
    const an = nm[0].toLowerCase(); i += nm[0].length;
    while (i < src.length && /\s/.test(src[i])) i++;
    let val = '';
    if (src[i] === '=') {
      i++; while (i < src.length && /\s/.test(src[i])) i++;
      const q = src[i];
      if (q === '"' || q === "'") { const e = src.indexOf(q, i + 1); val = src.slice(i + 1, e === -1 ? src.length : e); i = e === -1 ? src.length : e + 1; }
      else { const vm = /^[^\s>]*/.exec(src.slice(i, i + 400)); val = vm[0]; i += vm[0].length; }
    }
    attrs[an] = val;
  }
  return { name: m[1].toLowerCase(), attrs, end: i, selfClose: false };
}

/** Tag-aware walk: returns text nodes (with their element chain), elements and <script> ranges. */
function parseHtml(src) {
  const root = { tag: '#root', attrs: {}, children: [], parent: null, start: 0 };
  const texts = [], elements = [], scripts = [];
  let cur = root, i = 0;
  const pushText = (a, b) => { const t = src.slice(a, b); if (t.trim()) texts.push({ start: a, text: t, parent: cur }); };
  while (i < src.length) {
    const lt = src.indexOf('<', i);
    if (lt === -1) { pushText(i, src.length); break; }
    if (lt > i) pushText(i, lt);
    if (src.startsWith('<!--', lt)) { const e = src.indexOf('-->', lt); i = e === -1 ? src.length : e + 3; continue; }
    if (src.startsWith('<!', lt)) { const e = src.indexOf('>', lt); i = e === -1 ? src.length : e + 1; continue; }
    if (src[lt + 1] === '/') {                                     // close tag: pop to the matching open element
      const e = src.indexOf('>', lt);
      const name = src.slice(lt + 2, e === -1 ? src.length : e).trim().toLowerCase();
      let n = cur; while (n && n !== root && n.tag !== name) n = n.parent;
      if (n && n !== root) cur = n.parent;
      i = e === -1 ? src.length : e + 1; continue;
    }
    const tag = parseTag(src, lt);
    if (!tag) { i = lt + 1; continue; }
    const node = { tag: tag.name, attrs: tag.attrs, children: [], parent: cur, start: lt };
    cur.children.push(node); elements.push(node);
    i = tag.end;
    if (tag.name === 'script' || tag.name === 'style') {           // raw-text elements: never text nodes
      const ce = src.indexOf('</' + tag.name, i);
      if (tag.name === 'script') scripts.push({ start: i, end: ce === -1 ? src.length : ce });
      i = ce === -1 ? src.length : (src.indexOf('>', ce) + 1 || src.length);
      continue;
    }
    if (!tag.selfClose && !VOID.has(tag.name)) cur = node;
  }
  return { root, texts, elements, scripts };
}

/* ------------------------------------------------------ JS string literals */
const REGEX_OK = /[([{,;:=!&|?+\-*%~^<>]$/;
const REGEX_KW = new Set(['return', 'typeof', 'case', 'in', 'of', 'new', 'delete', 'void', 'instanceof', 'do', 'else', 'yield', 'await']);

/**
 * Scans JS, returning every string/template literal with its offset and whether it sits inside a G(...) call.
 * When `comments` is given, every line/block comment is pushed onto it as { start, text } (offsets are absolute).
 */
function scanJsLiterals(src, base, comments) {
  const out = []; let i = 0, prev = '', parens = [];
  const skipTo = (from, s) => { const e = src.indexOf(s, from); return e === -1 ? src.length : e + s.length; };
  const note = (a, b) => { if (comments) comments.push({ start: base + a, text: src.slice(a, b) }); };
  while (i < src.length) {
    const c = src[i];
    if (c === '/' && src[i + 1] === '/') { const e = skipTo(i, '\n'); note(i, e); i = e; prev = ''; continue; }
    if (c === '/' && src[i + 1] === '*') { const e = skipTo(i, '*/'); note(i, e); i = e; prev = ''; continue; }
    if (c === '/' && (prev === '' || REGEX_OK.test(prev) || REGEX_KW.has(prev))) {   // regex literal — skip it whole
      let j = i + 1, cls = false;
      while (j < src.length) { const d = src[j]; if (d === '\\') j += 2; else if (d === '[') { cls = true; j++; } else if (d === ']') { cls = false; j++; } else if (d === '/' && !cls) break; else if (d === '\n') break; else j++; }
      i = j + 1; prev = 'x'; continue;
    }
    if (c === '"' || c === "'" || c === '`') {
      let j = i + 1;
      while (j < src.length) { const d = src[j]; if (d === '\\') j += 2; else if (d === c) break; else if (d === '\n' && c !== '`') break; else j++; }
      out.push({ start: base + i + 1, content: src.slice(i + 1, j), inG: parens.some(Boolean) });
      i = j + 1; prev = 'x'; continue;
    }
    if (c === '(') { parens.push(prev === 'G'); i++; prev = '('; continue; }
    if (c === ')') { parens.pop(); i++; prev = ')'; continue; }
    if (/[A-Za-z_$]/.test(c)) { const m = /^[A-Za-z0-9_$]+/.exec(src.slice(i, i + 80)); prev = m[0]; i += m[0].length; continue; }
    if (/\s/.test(c)) { i++; continue; }
    prev = c; i++;
  }
  return out;
}

/* --------------------------------------------------------- rule 1: math */
const NUM = String.raw`\d[\d,]*(?:\.\d+)?`;
const MATH_RE = new RegExp(String.raw`(${NUM})\s*[°%]?\s*(÷|×|≈|=|\+|\*|−|\/|-)\s*[°%]?\s*(${NUM})`, 'gu');
const DATEISH = /\d{4}-\d{1,2}-\d{1,2}|\d{1,2}\/\d{1,2}\/\d{2,4}|\d{1,2}:\d{2}/g;

function findMath(text) {
  const out = [], blocked = [];
  let m; DATEISH.lastIndex = 0;
  while ((m = DATEISH.exec(text))) blocked.push([m.index, m.index + m[0].length]);
  MATH_RE.lastIndex = 0;
  while ((m = MATH_RE.exec(text))) {
    const s = m.index, e = s + m[0].length, raw = m[0], op = m[2];
    if (blocked.some(([a, b]) => s < b && e > a)) continue;               // dates / ISO / times
    if (text[s - 1] && /[\p{L}\d]/u.test(text[s - 1])) continue;          // part of a longer token
    if (text[e] && /\p{L}/u.test(text[e])) continue;
    if (op === '-' && !/\s-\s/.test(raw)) continue;                       // 8-9 ranges, SVG paths, dates
    if (op === '/' && !/\s\/\s/.test(raw)) continue;                      // 1/50 fractions, paths, urls
    let a = s; while (a > 0 && !/\s/.test(text[a - 1])) a--;              // whitespace-delimited token: skip urls
    if (/:\/\/|www\.|\.com|\?/.test(text.slice(a, e + 10))) continue;
    out.push({ index: s, text: raw.replace(/\s+/g, ' ') });
  }
  return out;
}

/** Blank out <span|b class="math|num">…</span> regions so a wrapped expression inside a JS literal is fine. */
function maskWrapped(s) {
  return s.replace(/<(span|b)[^>]*class=["'][^"']*\b(math|num)\b[^"']*["'][^>]*>[\s\S]*?<\/\1>/g, t => ' '.repeat(t.length));
}

/* ----------------------------------------------------- rule 2: gendered */
const GENDERED = ['אתה', 'שלך', 'תראה', 'תראי', 'בדוק', 'בדקי', 'כתוב', 'כתבי', 'ספר', 'ספרי', 'סיים', 'סיימי', 'נסה', 'נסי', 'לחץ', 'לחצי', 'קרא', 'קראי', 'סמן', 'סמני', 'הקלט', 'הקליטי', 'ניחשת', 'ידעת', 'זכית'];
const HEB = /[֐-׿]/;
const THIRD_PERSON = new Set(['הוא', 'היא', 'הם', 'הן', 'אני', 'אנחנו', 'אתם', 'אתן', 'כשהוא', 'שהוא', 'שהיא']);

function findGendered(text) {
  const out = [];
  for (const w of GENDERED) {
    let idx = -1;
    while ((idx = text.indexOf(w, idx + 1)) !== -1) {
      if (HEB.test(text[idx - 1] || '') || HEB.test(text[idx + w.length] || '')) continue;   // word boundary
      const pre = (text.slice(Math.max(0, idx - 14), idx).trim().split(/\s+/).pop() || '');
      if (THIRD_PERSON.has(pre)) continue;                                                   // "הוא קרא" is not an imperative
      out.push({ index: idx, word: w });
    }
  }
  return out.sort((a, b) => a.index - b.index);
}

/* ------------------------------------------------- lint-ignore markers */
const IGNORE_RE = /lint-ignore\s*:\s*([A-Za-z][A-Za-z,\s]*)/g;
const IGNORE_ALIAS = { math: 'math-outside-span', gendered: 'gendered-outside-g' };

/**
 * Reads `lint-ignore: <rule>[, <rule>]` markers out of JS comments and returns
 * Map<line, Set<ruleId>> covering the marker's own line and the one after it.
 */
function collectIgnores(comments, starts) {
  const map = new Map();
  for (const c of comments) {
    IGNORE_RE.lastIndex = 0;
    let m;
    while ((m = IGNORE_RE.exec(c.text))) {
      const line = lineAt(starts, c.start + m.index);            // the marker's own line, not the comment's first
      for (const name of m[1].split(',')) {
        const rule = IGNORE_ALIAS[name.trim().toLowerCase()];
        if (!rule) continue;
        for (const l of [line, line + 1]) { if (!map.has(l)) map.set(l, new Set()); map.get(l).add(rule); }
      }
    }
  }
  return map;
}

/* -------------------------------------------------------- rule 5: emoji */
const EMOJI_RE = /\p{Extended_Pictographic}/gu;
const EMOJI_OK = new Set(['★', '☆', '°', '™', '©', '®', '·']);

/* --------------------------------------------------------------- linter */
function lint(html, file) {
  const starts = lineStarts(html), findings = [];
  const add = (off, rule, message, level) => findings.push({ file, line: lineAt(starts, off), rule, level: level || 'error', message });
  const { texts, elements, scripts } = parseHtml(html);
  const js = scripts.map(s => html.slice(s.start, s.end)).join('\n');

  /* --- markup text nodes: rules 1, 2, 5 --- */
  for (const t of texts) {
    const anc = chain(t.parent);
    const inMath = anc.some(n => hasClass(n, 'math') || hasClass(n, 'num'));
    const inTrack = anc.some(n => n.attrs && 'data-track' in n.attrs);
    const inDataG = anc.some(n => n.attrs && 'data-g' in n.attrs);
    const decor = anc.some(n => hasClass(n, 'lock') || hasClass(n, 'fab') || hasClass(n, 'vault'));

    if (!inMath) for (const f of findMath(t.text)) add(t.start + f.index, 'math-outside-span', `bare expression "${f.text}" — wrap it in <span class="math">…</span>`);
    if (!inTrack && !inDataG) for (const g of findGendered(t.text)) add(t.start + g.index, 'gendered-outside-g', `"${g.word}" in shared text — use <span data-g="masc|fem">`, 'warn');
    if (!decor) { EMOJI_RE.lastIndex = 0; let m; while ((m = EMOJI_RE.exec(t.text))) if (!EMOJI_OK.has(m[0])) { add(t.start + m.index, 'no-emoji-in-text', `emoji ${m[0]} in body text`, 'warn'); break; } }
  }

  /* --- JS string literals: rules 1, 2 (a `lint-ignore:` marker exempts the literal) --- */
  for (const s of scripts) {
    const comments = [];
    const lits = scanJsLiterals(html.slice(s.start, s.end), s.start, comments);
    const ignores = collectIgnores(comments, starts);
    for (const lit of lits) {
      const off = ignores.get(lineAt(starts, lit.start));        // markers key on the line the literal STARTS on
      const masked = maskWrapped(lit.content);
      if (!(off && off.has('math-outside-span')))
        for (const f of findMath(masked)) add(lit.start + f.index, 'math-outside-span', `bare expression "${f.text}" in a JS string — wrap it in <span class="math">…</span>`);
      if (lit.inG || /data-g=|G\(/.test(lit.content)) continue;
      if (off && off.has('gendered-outside-g')) continue;
      for (const g of findGendered(lit.content)) add(lit.start + g.index, 'gendered-outside-g', `"${g.word}" in a JS string — build it with G('masc','fem')`, 'warn');
    }
  }

  /* --- rule 3: level twins + required scaffolding --- */
  for (const el of elements) {
    const lvl = el.attrs['data-level'];
    if (lvl !== 'advanced' && lvl !== 'standard') continue;
    const want = lvl === 'advanced' ? 'standard' : 'advanced';
    const twin = (el.parent ? el.parent.children : []).some(sib => sib !== el && sib.tag === el.tag && sib.attrs['data-level'] === want);
    if (!twin) add(el.start, 'level-twins', `<${el.tag} data-level="${lvl}"> has no sibling <${el.tag} data-level="${want}">`);
  }
  const need = [
    [elements.some(e => e.attrs['data-track'] === 'younger'), 'no element with data-track="younger"'],
    [elements.some(e => e.attrs['data-track'] === 'older'), 'no element with data-track="older"'],
    [elements.some(e => hasClass(e, 'panel') && hasClass(e, 'challenge')), 'no .panel.challenge element'],
    [elements.some(e => e.tag === 'input' && e.attrs.id === 'numAdv'), 'no input with id="numAdv"'],
    [/function\s+checkChallenge\b|checkChallenge\s*=\s*(?:async\s*)?(?:function|\()/.test(js), 'no checkChallenge function'],
  ];
  for (const [ok, msg] of need) if (!ok) add(0, 'level-twins', msg);

  /* --- rule 4: runtime bootstrap --- */
  if (!/RUNTIME/.test(js)) add(scripts.length ? scripts[0].start : 0, 'runtime-bootstrap', 'no runtime bootstrap; the page will only work with static KIDS', 'warn');

  findings.sort((a, b) => a.line - b.line || a.rule.localeCompare(b.rule));
  return findings;
}

/* ----------------------------------------------------------------- main */
function main(argv) {
  const asJson = argv.includes('--json');
  const files = argv.filter(a => a !== '--json');
  if (!files.length) { console.error('usage: node lint.js [--json] <file.html> [more.html ...]'); return 2; }
  const fs = require('fs');
  const all = [];
  for (const f of files) {
    let html; try { html = fs.readFileSync(f, 'utf8'); }
    catch (e) { all.push({ file: f, line: 0, rule: 'read', level: 'error', message: e.message }); continue; }
    all.push(...lint(html, f));
  }
  const errors = all.filter(f => f.level === 'error'), warns = all.filter(f => f.level !== 'error');
  if (asJson) console.log(JSON.stringify(all, null, 2));
  else {
    for (const f of all) console.log(`${f.file}:${f.line}: ${f.level === 'error' ? '' : 'warn: '}${f.rule}: ${f.message}`);
    if (warns.length) console.log(`LINT: ${warns.length} warning${warns.length > 1 ? 's' : ''}`);
    if (!errors.length) console.log('LINT: ok');
    else console.log(`LINT: ${errors.length} error${errors.length > 1 ? 's' : ''}`);
  }
  return errors.length ? 1 : 0;
}

module.exports = { lint, findMath, findGendered, parseHtml, scanJsLiterals, collectIgnores };
if (require.main === module) process.exit(main(process.argv.slice(2)));
