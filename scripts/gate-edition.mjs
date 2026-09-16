#!/usr/bin/env node
/**
 * The gate every edition must pass before it is staged.
 *
 *   npm run gate:edition -- path/to/edition.html
 *
 * Three checks, in the order that fails cheapest first:
 *   1. lint    — kit/template/lint.js: RTL maths outside <span class="math">, advanced/standard
 *                twins, the challenge panel. Zero dependencies.
 *   2. hooks   — the gamification contract the app only warns about at staging. Editions 3 and 4
 *                shipped without it and nobody noticed, so here it is an error.
 *   3. smoke   — tests/e2e/smoke-edition.mjs: drives the real fragment in Chromium across both
 *                tracks, three levels and two widths, and collects page errors.
 *
 * Exits non-zero on the first failure, so CI can gate a build on it.
 */
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";

const fragment = process.argv[2];
if (!fragment) {
  console.error("usage: npm run gate:edition -- <fragment.html>");
  process.exit(2);
}

const root = path.resolve(import.meta.dirname, "..");
const run = (label, args) => {
  console.log(`\n=== ${label} ===`);
  const r = spawnSync("node", args, { cwd: root, stdio: "inherit" });
  if (r.status !== 0) {
    console.error(`\nGATE FAILED: ${label}`);
    process.exit(r.status ?? 1);
  }
};

run("lint", [path.join(root, "kit/template/lint.js"), fragment]);

// The hooks the app extracts at staging (src/lib/wow-meta.ts). Missing ones are warnings there and
// the edition still serves, but the kid silently earns no wings, skill leaves or rarity badges.
console.log("\n=== hooks ===");
const html = readFileSync(path.resolve(root, fragment), "utf8");
const missing = [
  ["ENGINE_VERSION", /const\s+ENGINE_VERSION\s*=/],
  ["WOW_META", /const\s+WOW_META\s*=/],
  ["WOW.emit", /WOW\.emit\s*\(/],
  ['data-wow="progress"', /data-wow="progress"/],
].filter(([, re]) => !re.test(html));

if (missing.length) {
  console.error(`missing gamification hooks: ${missing.map(([n]) => n).join(", ")}`);
  console.error("GATE FAILED: hooks");
  process.exit(1);
}
const emits = (html.match(/WOW\.emit\s*\(/g) ?? []).length;
console.log(`hooks ok — ${emits} WOW.emit call sites`);

run("smoke", [path.join(root, "tests/e2e/smoke-edition.mjs"), fragment]);

console.log("\nGATE: ok");
