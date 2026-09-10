/**
 * End-to-end: a kid walks half of edition 1, leaves the page, and comes back to find the work still there.
 * Also checks the header bar (the collection is visible from the lesson itself) and that coming back does
 * not send the answers to the server a second time.
 *
 *   npm run test:e2e:resume
 *   E2E_BASE=http://localhost:3000 node tests/e2e/resume.mjs   (against a running server; needs DEV_SEED=1)
 */
import { chromium } from "playwright";
import { spawn } from "node:child_process";
import { rmSync } from "node:fs";

/** Playwright's own download, or a chromium already on the machine (E2E_CHROMIUM). */
function launchOpts(o = {}) {
  return process.env.E2E_CHROMIUM ? { ...o, executablePath: process.env.E2E_CHROMIUM } : o;
}


const PORT = 3124;
const BASE = process.env.E2E_BASE || `http://localhost:${PORT}`;
let server = null;

async function startServer() {
  rmSync(".pglite-resume", { recursive: true, force: true });
  server = spawn("npx", ["next", "dev", "-p", String(PORT)], {
    env: { ...process.env, DATABASE_URL: "pglite://./.pglite-resume", DEV_SEED: "1", NEXT_PUBLIC_APP_URL: BASE, SESSION_SECRET: "e2e-secret" },
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

/** Everything about the lesson a kid would notice was lost: where they are, what they answered, what is on screen. */
const SNAPSHOT = () => ({
  step: S.step,
  started: S.started,
  world: S.world,
  guess: S.guess,
  qc: JSON.stringify(S.qc),
  mcq: JSON.stringify(S.mcq),
  order: JSON.stringify(S.order),
  orderScore: S.orderScore,
  num: S.num,
  shown: document.querySelectorAll(".step.shown").length,
  feedback: document.querySelectorAll(".fb.show, .show").length,
  locked: document.querySelectorAll(".q.locked").length,
  marked: document.querySelectorAll(".opt.right, .opt.wrong").length,
  picked: document.querySelectorAll("#order .card.picked").length,
  curve: document.getElementById("curve").value,
  shipMsg: (document.getElementById("shipMsg").textContent || "").slice(0, 40),
  qc2: (document.querySelector("#qc2 .fb").textContent || "").slice(0, 40),
});

/** Walk the first half of edition 1 — far enough to have real work to lose, short of finishing it. */
async function playHalf(page, url) {
  await page.goto(url, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => document.getElementById("startBtn") && !document.getElementById("startBtn").disabled, null, { timeout: 15000 });
  await page.click("#startBtn");
  await page.click("#roundBtn");
  await page.click("text=שלחו את הספינה");
  await page.waitForTimeout(2400);
  await page.click('.step[data-step="1"] .next .btn');
  await page.fill("#curve", "85");
  await page.click('#qc2 .opt[data-i="1"]');
  await page.click("#next2");
  await page.click("text=קבעו 7.2°");
  const track = await page.evaluate(() => document.body.dataset.track);
  if (track === "older") {
    await page.fill("#olderDiv", "50");
    await page.click("#olderDivBtn");
  } else {
    for (let i = 0; i < 5; i++) await page.click("#addSlices");
  }
  await page.click('.step[data-step="3"] .next .btn');
  await page.click('.step[data-step="4"] .next .btn');
  await page.click('.step[data-step="5"] .next .btn');
  await page.click("text=למבחן!");
  // two of the four test questions, and part of the ordering task
  await page.click('#mcqs .q:nth-child(1) .opt[data-i="1"]');
  await page.click('#mcqs .q:nth-child(2) .opt[data-i="1"]');
  await page.click('#order .card[data-id="a"]');
  await page.click('#order .card[data-id="b"]');
  await page.waitForTimeout(600); // let the recorder's debounce write to localStorage
}

/** The rest of the walk: the explanation, the self-check rubric, and the finish that opens the vault. */
async function finishLesson(page) {
  const track = await page.evaluate(() => document.body.dataset.track);
  const level = await page.evaluate(() => document.body.dataset.level);
  for (const i of [3, 4]) await page.click(`#mcqs .q:nth-child(${i}) .opt[data-i="${track === "older" ? 1 : i === 4 ? 2 : 1}"]`);
  for (const id of ["c", "d", "e"]) await page.click(`#order .card[data-id="${id}"]`);
  await page.click("#orderCheck");
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
  await page.waitForTimeout(2000);
  for (const b of await page.$$("#explainFb input[type=checkbox]")) await b.check();
  await page.click("#finishBtn");
  await page.waitForTimeout(2500);
}

(async () => {
  const errors = [];
  try {
    if (!process.env.E2E_BASE) await startServer();
    const seeded = await seed();
    const family = seeded.families.created[0];
    if (!family) throw new Error("seed created no family (already seeded?)");
    const token = Object.fromEntries(family.kids.map((k) => [k.name, k.link.split("k=")[1]]))["אמה"];
    if (!token) throw new Error("no personal link for the test kid");
    const url = BASE + "/l/1?k=" + token;

    const browser = await chromium.launch(launchOpts());
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    const posted = [];
    page.on("pageerror", (e) => errors.push("page: " + e.message));
    // only our own origin: a blocked Google font in a sandbox is not this app's bug
    page.on("console", (m) => { const at = String(m.location()?.url || BASE); if (m.type() === "error" && at.startsWith(BASE) && !/net::ERR_|favicon|status of 502/.test(m.text() + " " + at)) errors.push("console: " + m.text() + " @ " + at); });
    page.on("request", (r) => { if (r.method() === "POST" && /\/api\/kid\//.test(r.url())) posted.push(r.url().replace(BASE, "")); });
    page.on("response", (r) => { // the assistant answers 502 without ANTHROPIC_API_KEY and the page falls back to its rubric — by design
      if (r.status() >= 400 && r.url().startsWith(BASE) && !/favicon|\/api\/arto\//.test(r.url())) errors.push("http " + r.status() + " " + r.url().replace(BASE, "")); });

    await page.addInitScript(`window.SNAP = ${SNAPSHOT.toString()};`);
    await playHalf(page, url);
    const before = await page.evaluate(SNAPSHOT);
    console.log("before:", JSON.stringify(before));
    if (before.step < 7) errors.push("the walk did not reach the test: step " + before.step);
    if (before.marked < 2 || before.picked < 2) errors.push("the walk answered nothing: " + JSON.stringify(before));

    // the header bar: badges and grades on the lesson itself, no inner page to find first
    const hdr = await page.evaluate(() => {
      const el = document.querySelector(".wow-hdr");
      return el ? { text: el.innerText.replace(/\s+/g, " ").trim(), inTopbar: !!el.closest(".topbar"), chips: el.querySelectorAll(".chip").length } : null;
    });
    console.log("header:", JSON.stringify(hdr));
    if (!hdr) errors.push("header bar missing");
    else {
      if (!hdr.inTopbar) errors.push("header bar is not in the top bar");
      if (hdr.chips < 3) errors.push("header bar has too few chips: " + JSON.stringify(hdr));
      if (!/רצף/.test(hdr.text) || !/קלפים/.test(hdr.text) || !/עיטורים/.test(hdr.text)) errors.push("header bar text: " + hdr.text);
    }
    // and it opens the collection without leaving the lesson
    await page.click(".wow-hdr");
    await page.waitForSelector(".wow-drawer .wow-grades, .wow-drawer .grove", { timeout: 8000 });
    const drawerHasGrades = await page.evaluate(() => !!document.querySelector(".wow-drawer h3") && /הציונים שלי/.test(document.querySelector(".wow-drawer .in").innerText));
    if (!drawerHasGrades) errors.push("the collection has no grades section");
    await page.keyboard.press("Escape");

    // 2. she leaves and comes back — the whole point
    const truth = () => fetch(BASE + "/api/kid/progress?k=" + encodeURIComponent(token)).then((r) => r.json());
    const server = await truth();
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForSelector(".wow-resumed", { timeout: 15000 }).catch(() => errors.push("no resume happened at all"));
    await page.waitForTimeout(800);
    const after = await page.evaluate(SNAPSHOT);
    console.log("after: ", JSON.stringify(after));
    for (const k of Object.keys(before)) {
      if (JSON.stringify(before[k]) !== JSON.stringify(after[k])) errors.push(`lost on reload: ${k} was ${JSON.stringify(before[k])}, came back ${JSON.stringify(after[k])}`);
    }
    // coming back is not answering again: the server's record of what she did must be untouched
    const serverAfter = await truth();
    if (JSON.stringify(serverAfter.progress.feathers_by_edition) !== JSON.stringify(server.progress.feathers_by_edition) || JSON.stringify(serverAfter.progress.wings) !== JSON.stringify(server.progress.wings)) {
      errors.push("replay counted the answers twice: " + JSON.stringify(server.progress.wings) + " → " + JSON.stringify(serverAfter.progress.wings));
    }

    // 3. and "start over" really does start over
    await page.click(".wow-resumed [data-restart]");
    await page.waitForFunction(() => document.getElementById("startBtn") && !document.getElementById("startBtn").disabled, null, { timeout: 15000 });
    await page.waitForTimeout(800);
    const fresh = await page.evaluate(SNAPSHOT);
    console.log("fresh: ", JSON.stringify(fresh));
    if (fresh.step !== 0 || fresh.started || fresh.marked !== 0) errors.push("start over did not: " + JSON.stringify(fresh));
    if (await page.evaluate(() => !!document.querySelector(".wow-resumed"))) errors.push("start over still offers to resume");

    // 4. the whole lesson, including the graded explanation — the expensive part must not be paid twice
    await playHalf(page, url);
    await finishLesson(page);
    const end = await page.evaluate(() => ({ ...SNAP(), pw: document.querySelector(".vault .pw")?.textContent || null, res: document.getElementById("resLine")?.textContent || "" }));
    console.log("done:  ", JSON.stringify(end));
    if (!end.pw || end.step !== 8) errors.push("the walk did not finish: " + JSON.stringify(end));
    const graded = posted.filter((u) => /\/arto\/grade/.test(u)).length;
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForSelector(".wow-resumed", { timeout: 20000 }).catch(() => errors.push("a finished lesson did not come back"));
    await page.waitForTimeout(1200);
    const back = await page.evaluate(() => ({ ...SNAP(), pw: document.querySelector(".vault .pw")?.textContent || null, res: document.getElementById("resLine")?.textContent || "" }));
    console.log("back:  ", JSON.stringify(back));
    for (const k of Object.keys(end)) {
      if (k === "pw") continue; // the password comes back from the server, so it lands a beat later
      if (JSON.stringify(end[k]) !== JSON.stringify(back[k])) errors.push(`lost on reload: ${k} was ${JSON.stringify(end[k])}, came back ${JSON.stringify(back[k])}`);
    }
    if (posted.filter((u) => /\/arto\/grade/.test(u)).length !== graded) errors.push("coming back asked ארטו to grade the explanation again — that costs the kid a question");

    await browser.close();
  } catch (e) {
    errors.push("threw: " + (e.stack || e.message));
  } finally {
    if (server) { try { process.kill(-server.pid, "SIGKILL"); } catch { server.kill("SIGKILL"); } }
  }
  if (errors.length) {
    console.error("\nFAILURES:\n" + errors.map((e) => " ✗ " + e).join("\n"));
    process.exit(1);
  }
  console.log("\n✓ the lesson survives leaving the page, and the header shows the collection");
})();
