/**
 * End-to-end: the app serves edition 1; an anonymous visitor (demo) and a real kid (personal link) both
 * complete it on a phone-sized viewport and reach the vault; the kid's completion lands in the database.
 *
 *   npm run test:e2e            (starts its own dev server on :3123 with an embedded PGlite database)
 *   E2E_BASE=http://localhost:3000 node tests/e2e/lesson.mjs   (against a running server; needs DEV_SEED=1)
 */
import { chromium } from "playwright";
import { spawn } from "node:child_process";
import { rmSync } from "node:fs";

/** Playwright's own download, or a chromium already on the machine (E2E_CHROMIUM). */
function launchOpts(o = {}) {
  return process.env.E2E_CHROMIUM ? { ...o, executablePath: process.env.E2E_CHROMIUM } : o;
}


const PORT = 3123;
const BASE = process.env.E2E_BASE || `http://localhost:${PORT}`;
let server = null;

async function startServer() {
  rmSync(".pglite-e2e", { recursive: true, force: true });
  server = spawn("npx", ["next", "dev", "-p", String(PORT)], {
    env: { ...process.env, DATABASE_URL: "pglite://./.pglite-e2e", DEV_SEED: "1", NEXT_PUBLIC_APP_URL: BASE, SESSION_SECRET: "e2e-secret" },
    stdio: ["ignore", "pipe", "pipe"],
    detached: true, // next dev spawns its own server child; kill the whole group or the port stays taken
  });
  server.stdout.on("data", (d) => process.env.E2E_VERBOSE && process.stdout.write(d));
  server.stderr.on("data", (d) => process.stderr.write(d));
  for (let i = 0; i < 120; i++) {
    try {
      const r = await fetch(BASE + "/l/1");
      if (r.ok) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error("dev server did not start");
}


async function seed() {
  const r = await fetch(BASE + "/api/dev/seed", { method: "POST" });
  if (!r.ok) throw new Error("seed failed: " + r.status + " " + (await r.text()));
  return r.json();
}

/** Walk the lesson like the kit's check.js does (older track answers). */
async function playLesson(page, { pickId, expectNoPicker, url }) {
  await page.goto(url || BASE + "/l/1", { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(800);
  if (expectNoPicker) {
    const visible = await page.isVisible(".tracks");
    if (visible) throw new Error("picker visible in token mode");
    await page.waitForFunction(() => document.getElementById("startBtn") && !document.getElementById("startBtn").disabled, null, { timeout: 8000 });
  } else {
    await page.click(`.track[data-pick=${pickId}]`);
  }
  await page.click("#startBtn");
  await page.click("#roundBtn");
  await page.click("text=שלחו את הספינה");
  await page.waitForTimeout(2200);
  await page.click('.step[data-step="1"] .next .btn');
  await page.fill("#curve", "85");
  await page.$eval("#curve", (e) => e.dispatchEvent(new Event("input")));
  await page.click('#qc2 .opt[data-i="1"]');
  await page.click("#next2");
  await page.click("text=קבעו 7.2°");
  const track = await page.evaluate(() => document.body.dataset.track);
  if (track === "older") {
    await page.fill("#olderDiv", "50");
    await page.click("#olderDivBtn");
    await page.fill("#olderMul", "40000");
    await page.click("#olderStep2 .btn");
  } else {
    for (let i = 0; i < 5; i++) await page.click("#addSlices");
  }
  await page.click('.step[data-step="3"] .next .btn');
  await page.click('.step[data-step="4"] .next .btn');
  await page.click('.step[data-step="5"] .next .btn');
  await page.click("text=למבחן!");
  const answers = [1, 1, 1, track === "older" ? 1 : 2];
  for (let i = 0; i < 4; i++) await page.click(`#mcqs .q:nth-child(${i + 1}) .opt[data-i="${answers[i]}"]`);
  for (const id of ["a", "b", "c", "d", "e"]) await page.click(`#order .card[data-id="${id}"]`);
  await page.click("#orderCheck");
  const level = await page.evaluate(() => document.body.dataset.level);
  if (track === "older" && level === "advanced") {
    await page.fill("#numAdv", "90000");
    await page.fill("#numAdvR", "14300");
    await page.click(".q[data-level=advanced] .btn");
  } else if (track === "older") {
    await page.fill("#numOlder", "40000");
    await page.click(".q[data-track=older][data-level=standard] .btn");
  } else {
    await page.fill("#numYounger", "10");
    await page.click(".q[data-track=younger] .btn");
  }
  await page.fill("#explain", "ארטוסתנס ראה שבסיינה אין צל ובאלכסנדריה יש צל בזווית 7.2 מעלות. זה בגלל שכדור הארץ עגול. הוא חילק 360 ב-7.2 וקיבל 50, ואז הכפיל ב-800 קילומטר וקיבל 40,000.");
  await page.click("#explainBtn");
  await page.waitForTimeout(1500);
  for (const b of await page.$$("#explainFb input[type=checkbox]")) await b.check();
  await page.click("#finishBtn");
  await page.waitForTimeout(2500);
  return page.evaluate(() => ({
    pw: document.querySelector(".vault .pw")?.textContent || null,
    xp: document.getElementById("xpToday").textContent,
    who: document.getElementById("who").textContent,
    runtime: document.body.dataset.runtime,
    track: document.body.dataset.track,
    level: document.body.dataset.level,
    push: document.body.dataset.push,
    status: document.getElementById("rtStatus")?.textContent || "",
    streakLine: document.getElementById("streakLine").textContent,
    scrollW: document.documentElement.scrollWidth,
    vw: innerWidth,
    wow: document.querySelector('[data-wow="progress"] .wow')?.innerText.replace(/\s+/g, " ").slice(0, 3000) || "",
    strip: document.querySelector(".wow-strip")?.innerText.replace(/\s+/g, " ") || "",
    wowLoaded: !!(window.WOW && window.WOW.v),
  }));
}

(async () => {
  const errors = [];
  try {
    if (!process.env.E2E_BASE) await startServer();
    const seeded = await seed();
    const family = seeded.families.created[0];
    if (!family) throw new Error("seed created no family (already seeded?)");
    const links = Object.fromEntries(family.kids.map((k) => [k.name, k.link]));
    console.log("seeded kids:", Object.keys(links).join(", "));

    const browser = await chromium.launch(launchOpts());
    const newPage = async () => {
      const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
      page.on("pageerror", (e) => errors.push("page: " + e.message));
      page.on("console", (m) => { if (m.type() === "error" && !/net::ERR_|fonts\.g|favicon|status of 502/.test(m.text() + " " + (m.location()?.url || ""))) errors.push("console: " + m.text()); });
      // the assistant answers 502 api_key_not_configured without ANTHROPIC_API_KEY — the page must fall back to the rubric; anything else ≥ 500 is a bug
      page.on("response", (r) => { if (r.status() >= 500 && !/\/api\/arto\//.test(r.url())) errors.push("http " + r.status() + " " + r.url()); });
      return page;
    };

    // 1. demo (anonymous)
    let page = await newPage();
    const demo = await playLesson(page, { pickId: "guest_f" });
    console.log("demo:", JSON.stringify(demo));
    if (demo.pw !== "הדגמה") errors.push("demo: vault should show the demo password, got " + demo.pw);
    if (await page.evaluate(() => document.documentElement.outerHTML.includes("15DXmNeRINec16kg15zXpteU"))) errors.push("demo: the real PW_ENC is in the page source");
    if (demo.runtime !== "demo") errors.push("demo: runtime flag missing");
    if (demo.scrollW > demo.vw) errors.push("demo: horizontal overflow");
    if (!demo.wowLoaded) errors.push("demo: wow-runtime not loaded");
    if (!/קישור אישי/.test(demo.wow)) errors.push("demo: progress note missing: " + demo.wow);
    await page.close();

    // 2. a real kid via personal link (on_track → older track, push=ontrack)
    page = await newPage();
    await page.goto(BASE + links["אמה"], { waitUntil: "domcontentloaded" });
    if (!/\/l\/\d+\?k=/.test(page.url())) errors.push("today redirect failed: " + page.url());
    // the walk below is edition 1's (the demo edition, dated today by the seed)
    const url = BASE + "/l/1?k=" + links["אמה"].split("k=")[1];
    const kid = await playLesson(page, { expectNoPicker: true, url });
    console.log("kid:", JSON.stringify(kid));
    if (kid.pw !== "הצל של בטא") errors.push("kid: vault should show the server password, got " + kid.pw);
    if (await page.evaluate(() => /const PW_ENC = '[^']+'/.test(document.documentElement.outerHTML))) errors.push("kid: a PW_ENC value is in the page source");
    if (kid.runtime !== "app") errors.push("kid: runtime flag");
    if (kid.track !== "older" || kid.push !== "ontrack") errors.push("kid: level mapping " + kid.track + "/" + kid.push);
    if (!/אמה/.test(kid.who)) errors.push("kid: name not shown");
    if (!/נשמרה/.test(kid.status)) errors.push("kid: completion not confirmed by server: " + kid.status);
    // gamification P0: the results screen shows the medal, the card and the roots from the server's progress
    if (!/המדליה של היום: (ארד|כסף|זהב|יהלום)/.test(kid.wow)) errors.push("kid: medal block missing: " + kid.wow);
    if (!/הקלף של היום/.test(kid.wow) || !/השורשים שצמחו/.test(kid.wow)) errors.push("kid: card/roots block missing: " + kid.wow);
    if (!/השורשים והכנפיים שלי/.test(kid.wow)) errors.push("kid: drawer button missing");
    // P1: the engine emitted item events, the runtime flushed them, the server folded them into wings
    await page.waitForFunction(() => /נוצות לכנפיים/.test(document.querySelector('[data-wow="progress"]')?.innerText || ""), null, { timeout: 8000 }).catch(() => errors.push("kid: feathers block missing (events not flushed?)"));
    const wow2 = await page.evaluate(() => document.querySelector('[data-wow="progress"] .wow')?.innerText.replace(/\s+/g, " ") || "");
    if (!/הבנה \+/.test(wow2) || !/חישוב \+/.test(wow2) || !/המסע של השבוע/.test(wow2)) errors.push("kid: wings/journey block: " + wow2.slice(0, 300));
    const ev = await page.evaluate(() => window.WOW.events().map((e) => e.t + ":" + (e.p.id || "")));
    for (const need of ["predict:predict", "item:qc:qc2", "item:mcq:shared:0", "item:order", "item:num:older", "item:explain", "finish:"]) if (!ev.includes(need)) errors.push("kid: engine did not emit " + need + " — got " + ev.join(","));
    await page.click('[data-wow-open]');
    await page.waitForSelector(".wow-drawer .grove .tree", { timeout: 8000 });
    const drawer = await page.evaluate(() => ({ trees: document.querySelectorAll(".wow-drawer .tree").length, cards: document.querySelectorAll(".wow-drawer .album .card").length, badges: document.querySelectorAll(".wow-drawer .badge:not(.locked)").length, locked: document.querySelectorAll(".wow-drawer .badge.locked").length }));
    console.log("drawer:", JSON.stringify(drawer));
    if (drawer.trees !== 15 || drawer.cards < 1 || drawer.badges < 1 || drawer.locked < 5) errors.push("drawer: " + JSON.stringify(drawer));
    await page.keyboard.press("Escape");
    // a second visit shows the hero strip with today's medal
    await page.goto(url, { waitUntil: "domcontentloaded" });
    await page.waitForSelector(".wow-strip", { timeout: 8000 });
    const strip = await page.evaluate(() => document.querySelector(".wow-strip").innerText.replace(/\s+/g, " "));
    console.log("strip:", strip);
    if (!/רצף 1/.test(strip) || !/היום כבר יש/.test(strip)) errors.push("strip: " + strip);
    const prog = await fetch(BASE + "/api/kid/progress?k=" + encodeURIComponent(url.split("k=")[1])).then((x) => x.json());
    if (!prog.ok || !prog.progress || !prog.progress.cards.length || !prog.defs.length) errors.push("progress api: " + JSON.stringify(prog).slice(0, 200));
    // the challenge heading variant for on_track
    const heading = await page.evaluate(() => document.querySelector(".panel.challenge h3")?.innerText.replace(/\s+/g, " ").trim());
    if (!/מומלץ בשבילך/.test(heading || "")) errors.push("on_track heading: " + heading);
    await page.close();

    // 3. advanced kid: twins swapped
    page = await newPage();
    await page.goto(BASE + "/l/1?k=" + links["אדם"].split("k=")[1], { waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => document.getElementById("startBtn") && !document.getElementById("startBtn").disabled, null, { timeout: 8000 });
    const adv = await page.evaluate(() => { for (let s = 2; s <= 7; s++) goTo(s); return { level: document.body.dataset.level, adv: !!document.querySelector(".q[data-level=advanced]")?.offsetParent, std: !!document.querySelector(".q[data-track=older][data-level=standard]")?.offsetParent }; });
    console.log("advanced:", JSON.stringify(adv));
    if (adv.level !== "advanced" || !adv.adv || adv.std) errors.push("advanced twins not swapped");
    await page.close();

    // 4. support kid: younger track
    page = await newPage();
    await page.goto(BASE + "/l/1?k=" + links["נועה"].split("k=")[1], { waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => document.body.dataset.track, null, { timeout: 8000 });
    const sup = await page.evaluate(() => document.body.dataset.track);
    if (sup !== "younger") errors.push("support → younger mapping: " + sup);
    await page.close();

    // 4b. the library scoped by the kid's token links every edition as that kid
    const lib = await fetch(BASE + "/library?k=" + encodeURIComponent(links["אמה"].split("k=")[1])).then((r) => r.text());
    if (!/\/l\/1\?k=/.test(lib) || !/הגיליונות של אמה/.test(lib)) errors.push("library: not scoped to the kid's token");

    // 5. the completion is in the database with the right stats (via the dev inspect route)
    const r = await fetch(BASE + "/api/dev/inspect", { method: "POST" }).then((x) => x.json());
    console.log("db:", JSON.stringify(r));
    const emma = r.kids.find((k) => k.name === "אמה");
    if (!emma || emma.completions !== 1 || emma.xp < 135 || emma.streak !== 1) errors.push("db: completion not recorded correctly " + JSON.stringify(emma));
    if (!(emma.item_events >= 8)) errors.push("db: item events not stored: " + emma.item_events);

    await browser.close();
  } catch (e) {
    errors.push("fatal: " + (e && e.stack || e));
  } finally {
    if (server) { try { process.kill(-server.pid, "SIGKILL"); } catch { server.kill("SIGKILL"); } }
  }
  console.log("E2E ERRORS:", errors.length ? errors : "none");
  process.exit(errors.length ? 1 : 0);
})();
