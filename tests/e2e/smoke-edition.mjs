/**
 * Smoke test for any edition fragment in app (demo) mode: wraps it like the server does, loads it on a phone
 * viewport, checks the runtime bootstrap, the demo sliders, the picker, the chat panel and that there are no
 * page errors. Content-agnostic (unlike the kit's check.js, which walks edition 1's interactives).
 *
 *   node tests/e2e/smoke-edition.mjs editions/e/002/edition.html
 */
import { chromium } from "playwright";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

/** Playwright's own download, or a chromium already on the machine (E2E_CHROMIUM). */
function launchOpts(o = {}) {
  return process.env.E2E_CHROMIUM ? { ...o, executablePath: process.env.E2E_CHROMIUM } : o;
}


const file = process.argv[2];
const frag = readFileSync(file, "utf8");
const rt = { api: "/api", kidToken: "", edition: { n: 2, code: "WOW-002", date: "2026-09-08", title: "x" }, library: "/library" };
const doc = `<!doctype html><html lang="he" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:0}</style></head><body><script>window.RUNTIME=${JSON.stringify(rt)};</script>${frag}</body></html>`;
const out = path.resolve("tests/e2e/_smoke.html");
writeFileSync(out, doc);

const errors = [];
const browser = await chromium.launch(launchOpts());
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
page.on("pageerror", (e) => errors.push("page: " + e.message));
page.on("console", (m) => { if (m.type() === "error" && !/net::ERR_|fonts\.g|favicon/.test(m.text() + " " + (m.location()?.url || ""))) errors.push("console: " + m.text()); });
await page.goto("file://" + out);
await page.waitForTimeout(800);
const state = await page.evaluate(() => ({
  runtime: document.body.dataset.runtime,
  picker: [...document.querySelectorAll(".track")].map((b) => b.dataset.pick),
  sliders: !!document.getElementById("demoGrade") && !!document.getElementById("demoLevelSel"),
  brand: document.querySelector(".brand .t")?.textContent,
  title: document.title,
}));
console.log("state:", JSON.stringify(state));
if (state.runtime !== "demo") errors.push("not in demo mode");
if (!state.sliders) errors.push("demo sliders missing");
if (!state.picker.includes("guest_f")) errors.push("guest picker missing");
if (/הוואו/.test(state.brand + state.title)) errors.push("old brand name still present");
// level slider → advanced → older track with the advanced layer
await page.$eval("#demoLevelSel", (el) => { el.value = "2"; el.dispatchEvent(new Event("input")); });
await page.click(".track[data-pick=guest_m]");
const lvl = await page.evaluate(() => ({ level: document.body.dataset.level, track: document.body.dataset.track, push: document.body.dataset.push, tracks: [...new Set([...document.querySelectorAll("[data-track]")].map((e) => e.dataset.track))] }));
console.log("advanced:", JSON.stringify(lvl));
const both = lvl.tracks.includes("younger") && lvl.tracks.includes("older");
if (lvl.level !== "advanced" || (both ? lvl.track !== "older" : !lvl.tracks.includes(lvl.track))) errors.push("advanced mapping: " + JSON.stringify(lvl));
// grade ג + support → younger
await page.$eval("#demoLevelSel", (el) => { el.value = "0"; el.dispatchEvent(new Event("input")); });
await page.$eval("#demoGrade", (el) => { el.value = "1"; el.dispatchEvent(new Event("input")); });
await page.click(".track[data-pick=guest_f]");
const sup = await page.evaluate(() => document.body.dataset.track);
if (both ? sup !== "younger" : !lvl.tracks.includes(sup)) errors.push("support mapping: " + sup);
// start, walk every step by goTo (content-agnostic), open the chat
await page.click("#startBtn");
await page.evaluate(() => { for (let s = 2; s <= 8; s++) goTo(s); });
await page.waitForTimeout(500);
await page.click("#fab");
await page.waitForTimeout(300);
const chat = await page.evaluate(() => ({ open: document.getElementById("chat").classList.contains("open"), bodyClass: document.body.classList.contains("chat-open"), h: Math.round(document.getElementById("chat").getBoundingClientRect().height), vh: innerHeight }));
console.log("chat:", JSON.stringify(chat));
if (!chat.open || !chat.bodyClass || chat.h < chat.vh - 5) errors.push("chat not full-screen on phone: " + JSON.stringify(chat));
const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
if (overflow) errors.push("horizontal overflow");
await browser.close();
console.log("SMOKE ERRORS:", errors.length ? errors : "none");
process.exit(errors.length ? 1 : 0);
