#!/usr/bin/env node
'use strict';
/**
 * lint.test.js — fixture test for lint.js.  Run:  node lint.test.js
 * Two in-memory fragments: one clean (must produce zero findings) and one with a
 * bare "360 ÷ 7.2" in a text node plus a data-level="advanced" with no standard twin.
 */
const assert = require('node:assert');
const { lint } = require('./lint.js');

/* ---------------------------------------------------------------- clean */
const clean = [
  '<div id="app" dir="rtl" lang="he">',                                                 // 1
  '  <p>ארטוסתנס חילק <span class="math">360 ÷ 7.2 = 50</span> וקיבל חמישים.</p>',      // 2
  '  <div data-track="younger"><p>המסלול הצעיר</p></div>',                              // 3
  '  <div data-track="older">',                                                          // 4
  '    <div class="panel challenge">',                                                   // 5
  '      <h3>אתגר</h3>',                                                                 // 6
  '      <span data-level="standard">רגיל</span><span data-level="advanced">מתקדם</span>',// 7
  '      <input type="number" id="numAdv" inputmode="numeric">',                         // 8
  '    </div>',                                                                          // 9
  '  </div>',                                                                            // 10
  '</div>',                                                                              // 11
  '<script>',                                                                            // 12
  'const RT = window.RUNTIME || null;',                                                  // 13
  'const G = (m,f) => f;',                                                               // 14
  'function checkChallenge(){ document.getElementById("chalFb").innerHTML =',            // 15
  '  \'<span class="math">50 × 800 = 40,000</span> \' + G(\'בדוק\',\'בדקי\'); }',        // 16
  '</script>',                                                                           // 17
].join('\n');

assert.deepStrictEqual(lint(clean, 'clean.html'), [], 'the clean fixture must produce no findings');

/* ---------------------------------------------------------------- dirty */
const dirty = [
  '<div id="app" dir="rtl" lang="he">',                                                  // 1
  '  <p>ארטוסתנס חילק 360 ÷ 7.2 וקיבל חמישים.</p>',                                      // 2
  '  <div data-track="younger"><span data-level="advanced">מתקדם</span></div>',          // 3
  '  <div data-track="older"><div class="panel challenge">',                             // 4
  '    <input type="number" id="numAdv"></div></div>',                                   // 5
  '</div>',                                                                              // 6
  '<script>window.RUNTIME; function checkChallenge(){}</script>',                         // 7
].join('\n');

const found = lint(dirty, 'dirty.html');
const math = found.filter(f => f.rule === 'math-outside-span');
const twins = found.filter(f => f.rule === 'level-twins');

assert.strictEqual(math.length, 1, 'one bare expression expected');
assert.strictEqual(math[0].line, 2);
assert.strictEqual(math[0].level, 'error');
assert.match(math[0].message, /360 ÷ 7\.2/);

assert.strictEqual(twins.length, 1, 'one missing twin expected');
assert.strictEqual(twins[0].line, 3);
assert.match(twins[0].message, /data-level="standard"/);

assert.strictEqual(found.filter(f => f.level === 'error').length, 2, 'exactly two errors');
assert.strictEqual(found.filter(f => f.level === 'warn').length, 0, 'no warnings expected');

/* ------------------------------------------------------- lint-ignore markers */
/* A prompt string never reaches the DOM, so the RTL/gender rules must be silenceable. */
const scaffold = [
  '<div id="app" dir="rtl" lang="he">',
  '  <div data-track="younger"><p>הצעירים</p></div>',
  '  <div data-track="older"><div class="panel challenge">',
  '    <input type="number" id="numAdv"></div></div>',
  '</div>',
  '<script>window.RUNTIME; function checkChallenge(){}',
];
const withPrompt = extra => scaffold.concat(extra, ['</script>']).join('\n');

const PROMPT = "const prompt = 'הסבר לילד/ה: 360 ÷ 7.2 = 50, ואז 50 × 800. כתוב בעברית פשוטה.';";

/* …without a marker the findings appear… */
const bare = lint(withPrompt([PROMPT]), 'bare.html');
assert.strictEqual(bare.filter(f => f.rule === 'math-outside-span').length, 2, 'unmarked prompt: two bare expressions');
assert.ok(bare.some(f => f.rule === 'gendered-outside-g'), 'unmarked prompt: a gendered warning');

/* …a marker on the line before suppresses only what it names… */
const beforeMarker = lint(withPrompt(['/* lint-ignore: math */', PROMPT]), 'before.html');
assert.strictEqual(beforeMarker.filter(f => f.rule === 'math-outside-span').length, 0, 'preceding marker suppresses math');
assert.strictEqual(beforeMarker.filter(f => f.rule === 'gendered-outside-g').length, 1, 'but not gendered');

/* …a // marker on the same line works too… */
const sameLine = lint(withPrompt([PROMPT + ' // lint-ignore: math']), 'same.html');
assert.strictEqual(sameLine.filter(f => f.rule === 'math-outside-span').length, 0, 'same-line marker suppresses math');

/* …both rules at once… */
const both = lint(withPrompt(['// lint-ignore: math, gendered', PROMPT]), 'both.html');
assert.deepStrictEqual(both, [], 'a marker naming both rules leaves a clean fixture');

/* …and the marker does not leak onto the line after next. */
const tooFar = lint(withPrompt(['/* lint-ignore: math */', 'const spacer = 1;', PROMPT]), 'far.html');
assert.strictEqual(tooFar.filter(f => f.rule === 'math-outside-span').length, 2, 'the marker reaches one line only');

console.log('TEST: ok (' + found.length + ' findings on the dirty fixture, 0 on the clean one, lint-ignore honoured)');
