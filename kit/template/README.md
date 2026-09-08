# Template

`edition-template.html` is a complete, tested edition (Hebrew, RTL) that doubles as the series engine.
It is a page *fragment* — `<title>`, `<link>` (Google Fonts), `<style>`, markup and one `<script>` — because
the release job wraps it into a full `<html lang dir>` document. To open it locally, wrap it the same way
(the check script does this for you and writes `_test.html`).

Constants at the top of the script are everything an edition needs:

```js
const EDITION = { n, code:'WOW-001', date, title, parent:'parent@example.com' };
const KIDS    = { // kid id → who they are and which CONTENT TRACK they use; several kids can share a track
  younger: { name, f:false, age:'8–9',   grade:'ג–ד', track:'younger' },
  older:   { name, f:true,  age:'10–11', grade:'ה–ו', track:'older' },
  // dani: { name, f:false, age:'11', grade:'ו', track:'older', cc:'their.parent@example.com', level:'advanced' },
};
const STATS   = { younger:{ streak, best, xp, badges }, older:{ … } };   // one entry per kid id, as of yesterday, from the ledger
const PW_ENC  = '…';       // base64 of the reversed UTF-8 daily password
const PROXY   = { url:'https://<project>.vercel.app/api', pwHash:'<sha256 hex of the entrance password>' };
```

Empty `PROXY` = no entrance gate and no assistant on the public site (the page still works, with a self-check rubric).

`library.html` is the static **library page** for the site repo (`e/index.html`): it reads `../editions.json` and lists every edition, newest first, so kids can open and finish old lessons. Copy it once; the release job never touches it.

## Check it

```
npm i -D playwright && npx playwright install chromium
node check.js          # walks the older track at 1100px and the younger at 390px, screenshots every interactive into shots/;
                       # then, if some kid in KIDS has level:'advanced', checks the twin swap, the challenge and the advanced numeric task
GATE_PW=… node check.js   # when PROXY.pwHash is set, unlock the gate with the password
```

It prints each track's final score/XP/password and `ERRORS: none` on success (Google Fonts connection
errors are ignored). Use it as the model for the nightly builder's own check.

## Rules the engine enforces (keep them)

- Track ids are `younger` / `older`; kids are entries of `KIDS` (any number, each with a `track`). Names, gender, age come only from `KIDS`: the picker is generated, `[data-kidpill]`/`[data-kidname]` spans are filled on pick, and every second-person string in a shared track is either plural or gendered through `<span data-g="masc|fem">` (markup) / `G('masc','fem')` (JS).
- `level:'advanced'` on a kid sets `body[data-level=advanced]`: elements with `data-level="advanced"` replace their `data-level="standard"` twins (the older track's numeric task ships as such a pair, `numOlder` / `numAdv`+`numAdvR`), the `.panel.challenge` in chapter 5 (a 2–3-step calculation + a thinking question, visible to every older-track kid, optional for the others) is headed to that kid, `checkChallenge()` awards the Σ badge, and `personaPrompt` / the grading prompt carry a push clause. Both numeric twins are worth the same 2 points.
- Locale knobs when leaving Hebrew: `dir="rtl" lang="he"` on `#app`, `#chat` and `#gate`; `toLocaleString('he-IL')` in `fmt`; `lang='he-IL'` on both speech recognizers; the "send to Dad" strings (`לאבא`) on the results screen and in `copyResults`; and of course every Hebrew string.
- Every formula in an RTL page is inside `<span class="math">` (LTR isolate); bare/signed numbers in `.num`.
- The vault opens only when all four test parts are done; the completion mail carries `WOW-NNN|track|score|max|done`.
- The proxy client (`PX`) and the backend switch (`AI`) time out and fall back — never leave a kid staring at a spinner.
- `LATE` (device date > `EDITION.date`) turns a finished old edition into a late completion: full XP for the score and for finishing, no streak bonus, no streak badges, and the completion line ends in `|late` so the builder can tell. The `.libLink` anchors point at the library (`../` from an archived copy, `e/` from the root) and hide inside Claude.

## Runtime mode (the app)

The same engine serves two hosts. On the static family site it reads the constants above. Inside **the Daily Wow app** the server prepends one line before the fragment:

```js
window.RUNTIME = { api:'/api', kidToken:'<from ?k>', edition:{ n, code, date, title }, library:'/library', profile?:{…} };
```

and the engine's `bootFromRuntime()` takes over: with a kid token it loads the profile (server-injected, or `POST {api}/kid/profile`), fills `KIDS`/`STATS`, picks the kid, hides the picker, and there is no gate; without a token it renders a **demo** guest (בן/בת picker + a level select). The app's level `support|standard|on_track|advanced` maps to `track` (`support` → younger) + `body[data-level]` (`advanced`) + `body[data-push]` (`ontrack`|`advanced`: follow-up questions; the challenge heading shows the `<span data-push="ontrack">` variant "מומלץ בשבילך"). `finish()` POSTs `{token, edition_n, score, max, complete, late, challenge}` to `{api}/kid/complete` and re-renders XP/streak from the server's answer (queued in localStorage when offline). The assistant client `PX` talks to `{api}/arto/{session,chat,grade}` with the kid token, sends only the kid's messages (the system prompt lives on the server), shows a small "עוד N שאלות להיום" counter when ≤ 5 remain, and turns off kindly on `429 cap`. The `mailto:` report is hidden in runtime mode (the app emails the parent itself). Nothing else changes: `check.js` still walks the static mode, and `node lint.js edition-template.html` must print `LINT: ok` before an edition is staged.
