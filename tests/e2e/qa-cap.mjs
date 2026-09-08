/** QA: kid hits the free cap on production, then asks the parents. Delete after the run. */
import { chromium, devices } from "playwright";
import fs from "node:fs";

const BASE = "https://rootsandwings-edu.com";
const KT = process.env.QA_KID_TOKEN;
const OUT = process.env.QA_OUT || "/tmp/qa-cap-log.json";
const SHOTS = "/Users/rapha/arto/tests/e2e/shots";
const log = [];
const say = (o) => { log.push(o); console.log(JSON.stringify(o)); };

const b = await chromium.launch();
const ctx = await b.newContext({ ...devices["iPhone 13"] });
const page = await ctx.newPage();
page.on("console", (m) => { if (m.type() === "error") say({ consoleError: m.text().slice(0, 200) }); });

await page.goto(`${BASE}/l/today?k=${KT}`, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(1500);
say({ step: "open", url: page.url(), title: await page.title() });
say({ runtime: await page.evaluate(() => ({ api: window.RUNTIME?.api, kid: window.RUNTIME?.profile?.kid?.name, edition: window.RUNTIME?.edition?.n })) });

await page.waitForFunction(() => { const b = document.getElementById("startBtn"); return b && !b.disabled; }, null, { timeout: 15000 });
await page.click("#startBtn");
await page.waitForTimeout(600);
say({ step: "startBtn", ok: true, bodyTrack: await page.evaluate(() => document.body.dataset.track) });

await page.click("#fab");
await page.waitForTimeout(1500);
say({ step: "openChat", greeting: (await page.textContent(".msgs .msg.bot")).slice(0, 90) });

async function ask(text, i) {
  await page.fill("#chatIn", text);
  await page.click("#chatSend");
  await page.waitForFunction(
    () => { const m = document.querySelectorAll(".msgs .msg"); const last = m[m.length - 1]; return last && !last.querySelector(".typing"); },
    null,
    { timeout: 90000 },
  );
  await page.waitForTimeout(400);
  const last = await page.evaluate(() => {
    const m = document.querySelectorAll(".msgs .msg");
    const l = m[m.length - 1];
    return { cls: l.className, text: l.innerText.trim(), hasBtn: !!l.querySelector("button") };
  });
  say({ step: "msg" + i, sent: text, replyClass: last.cls, reply: last.text.slice(0, 300), hasButton: last.hasBtn });
  return last;
}

await ask("למה המקל באלכסנדריה הטיל צל ובסיינה לא?", 1);
await ask("איך ידעו את המרחק בין שתי הערים?", 2);
await ask("מה זה בעצם מעלה במעגל?", 3);
const capped = await ask("ולמה כדור הארץ עגול בכלל?", 4);

await page.screenshot({ path: `${SHOTS}/qa-cap-bubble.png` });
const btn = await page.$(".msgs .msg:last-child button");
say({ step: "capButton", found: !!btn, label: btn ? (await btn.textContent()).trim() : null, capText: capped.text.slice(0, 200) });

if (btn) {
  await btn.click();
  await page.waitForTimeout(4000);
  const after = await page.evaluate(() => document.querySelector(".msgs .msg:last-child").innerText.trim());
  say({ step: "askParentClicked", confirmation: after.slice(0, 300) });
  await page.screenshot({ path: `${SHOTS}/qa-cap-sent.png` });
}
say({ step: "inputDisabled", disabled: await page.evaluate(() => document.getElementById("chatIn").disabled), placeholder: await page.evaluate(() => document.getElementById("chatIn").placeholder) });

fs.writeFileSync(OUT, JSON.stringify(log, null, 2));
await b.close();
