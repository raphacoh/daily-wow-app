/**
 * End-to-end: the sign-up wizard on a touch phone. Email → two kids (sliders, chips) → name + consent → done,
 * and the family exists in the database with the right levels/grades.
 *
 *   node tests/e2e/join.mjs            (starts its own dev server on :3124 with an embedded PGlite database)
 */
import { chromium, devices } from "playwright";
import { spawn } from "node:child_process";
import { rmSync } from "node:fs";

const PORT = 3124;
const BASE = `http://localhost:${PORT}`;
let server = null;

async function startServer() {
  rmSync(".pglite-e2e-join", { recursive: true, force: true });
  server = spawn("npx", ["next", "dev", "-p", String(PORT)], {
    env: { ...process.env, DATABASE_URL: "pglite://./.pglite-e2e-join", DEV_SEED: "1", NEXT_PUBLIC_APP_URL: BASE, SESSION_SECRET: "e2e-secret" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  server.stderr.on("data", (d) => process.stderr.write(d));
  for (let i = 0; i < 120; i++) {
    try {
      const r = await fetch(BASE + "/join");
      if (r.ok) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error("dev server did not start");
}

const setRange = async (page, selector, value) => page.$eval(selector, (el, v) => { const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set; set.call(el, String(v)); el.dispatchEvent(new Event("input", { bubbles: true })); el.dispatchEvent(new Event("change", { bubbles: true })); }, value);

(async () => {
  const errors = [];
  try {
    await startServer();
    await fetch(BASE + "/api/dev/seed", { method: "POST" }); // editions
    const browser = await chromium.launch();
    const ctx = await browser.newContext({ ...devices["iPhone 13"] });
    const page = await ctx.newPage();
    page.on("pageerror", (e) => errors.push("page: " + e.message));
    page.on("console", (m) => { if (m.type() === "error" && !/net::ERR_|fonts\.g|favicon|status of 502/.test(m.text())) errors.push("console: " + m.text()); });

    await page.goto(BASE + "/join", { waitUntil: "domcontentloaded" });
    // no auto-focus on touch: the keyboard must not pop before the parent taps
    await page.waitForSelector("input[type=email]");
    const focused = await page.evaluate(() => document.activeElement?.tagName);
    if (focused === "INPUT") errors.push("email field auto-focused on a touch device");
    if (!/(אחת עשרה|שיעור)/.test(await page.textContent(".wiz-p"))) errors.push("email screen copy missing");

    // wrong email → inline error; right email → kid screen
    await page.fill("input[type=email]", "not-an-email");
    await page.tap(".wiz-acts .btn");
    await page.waitForSelector(".wiz-err");
    await page.fill("input[type=email]", "family@example.com");
    await page.tap(".wiz-acts .btn");
    await page.waitForFunction(() => document.querySelector(".wiz-h")?.textContent === "מי לומד?");

    // kid 1: name, girl, grade ג (index 1) → younger band, level standard
    await page.fill(".wiz-in", "ליה");
    await page.tap(".chips button:nth-child(2)");
    await setRange(page, "input[id^=grade-]", 1);
    if ((await page.textContent(".wiz-val")) !== "ג") errors.push("grade slider label not updated");
    await page.tap("text=עוד ילד/ה");
    await page.waitForFunction(() => document.querySelector(".wiz-h")?.textContent === "ועוד מי?");
    const prog = await page.$$eval(".wiz-prog i", (els) => els.length);
    if (prog !== 4) errors.push("progress segments: " + prog);

    // kid 2: boy, grade ז, advanced
    await page.fill(".wiz-in", "אדם");
    await page.tap(".chips button:nth-child(1)");
    await setRange(page, "input[id^=grade-]", 5);
    await setRange(page, "input[id^=lvl-]", 2);
    if (!/מתקדם/.test(await page.textContent("label[for^=lvl-] .wiz-val"))) errors.push("level slider label not updated");
    // missing name check: clear and try to continue
    await page.fill(".wiz-in", "");
    await page.tap("text=זהו, נמשיך");
    await page.waitForSelector(".wiz-err");
    await page.fill(".wiz-in", "אדם");
    await page.tap("text=זהו, נמשיך");
    await page.waitForFunction(() => document.querySelector(".wiz-h")?.textContent === "כמעט סיימנו");

    // final: name + consent
    const summary = await page.textContent(".wiz-p");
    if (!/ליה, אדם/.test(summary) || !/family@example.com/.test(summary)) errors.push("summary: " + summary);
    await page.tap(".wiz-acts .btn"); // without name/consent → errors
    await page.waitForSelector(".wiz-err");
    await page.fill(".wiz-in", "רף");
    await page.tap(".wiz-consent input");
    await page.tap(".wiz-acts .btn");
    await page.waitForFunction(() => document.querySelector(".wiz-h")?.textContent === "הכל מוכן", null, { timeout: 20000 });
    const links = await page.$$eval(".wiz-acts a", (as) => as.map((a) => a.getAttribute("href")));
    if (links.length !== 2 || !links.every((l) => /\/l\/today\?k=/.test(l))) errors.push("kid links: " + JSON.stringify(links));

    // horizontal overflow never
    const ov = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
    if (ov) errors.push("horizontal overflow on the done screen");

    // the database has the family
    const r = await fetch(BASE + "/api/dev/inspect", { method: "POST" }).then((x) => x.json());
    const noa = r.kids.find((k) => k.name === "ליה"), adam = r.kids.find((k) => k.name === "אדם" && k.level === "advanced");
    if (!noa || noa.level !== "standard") errors.push("kid 1 not stored: " + JSON.stringify(noa));
    if (!adam) errors.push("kid 2 not stored");
    console.log("kids:", JSON.stringify(r.kids.map((k) => [k.name, k.level])), "parents:", JSON.stringify(r.parents));
    await browser.close();
  } catch (e) {
    errors.push("fatal: " + (e && e.stack || e));
  } finally {
    if (server) server.kill("SIGTERM");
  }
  console.log("JOIN E2E ERRORS:", errors.length ? errors : "none");
  process.exit(errors.length ? 1 : 0);
})();
