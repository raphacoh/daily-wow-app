# QA — cap → "ask the parents" → billing → checkout → activation (production)

**When:** 2026-09-08, ~13:40–13:50 UTC (16:40–16:50 Asia/Jerusalem)
**Where:** https://rootsandwings-edu.com (live), Supabase `gvwzpfoqeheciteetewv`, Dodo **live_mode** (no payment completed)
**QA family:** parent `raphco+qa@gmail.com` ("QA הורה"), kid "בדיקה" (male, 10, כיתה ה, standard)
kid id `2411be4e-7b84-475e-aa4d-9e1b9c6f47e7`, kid link `/l/today?k=…` → served as `/l/1?k=…`
**Browser:** Playwright chromium; kid = iPhone 13 profile, parent = 1200×900 desktop
**Cleanup:** family deleted, Supabase auth user deleted, QA scripts and log/state files removed. Only `tests/e2e/shots/qa-checkout.png` and this report remain.

---

## Step table

| # | Step | Result | Evidence |
|---|------|--------|----------|
| 1 | `POST /api/admin/import` creates the family | **PASS** | HTTP 200, `{"families":{"created":[{"email":"raphco+qa@gmail.com","kids":[{"name":"בדיקה","link":"/l/today?k=…"}]}],"existed":[]}}` |
| 1b | `POST /api/kid/profile {token}` → kid id | **PASS** | HTTP 200, `kid.id = 2411be4e-7b84-475e-aa4d-9e1b9c6f47e7`, `name "בדיקה"`, `timezone "Asia/Jerusalem"` |
| 2a | Kid link opens, `#startBtn` enables, chat opens | **PASS** | title `שורשים וכנפיים #1 · המקל שמדד את כדור הארץ`; `RUNTIME = {api:"/api", profile.kid "בדיקה", edition 1}`; body track `older`; greeting `שלום בדיקה! אני ארטו, הספרן של אלכסנדריה…` |
| 2b | 3 real Hebrew answers from Arto | **PASS** | 3 `.msg.bot` bubbles with real content (Eratosthenes / distance / degrees). DB `usage`: 3 rows `kind=chat, scope=lesson, model=claude-sonnet-5` (in/out tokens 1980/300, 2285/290, 2585/276) at 13:41:40–13:41:59Z |
| 2c | 4th message → cap message | **PASS** | network 429; bubble class `msg sys`, text **`ארטו ענה על 3 שאלות היום. רוצה עוד? ההורים יכולים להפעיל אותו.`** |
| 2d | Button "שלח להורים בקשה" present | **PASS** | button label exactly `שלח להורים בקשה` (masculine form via `G()`), inside the cap bubble |
| 2e | Click → confirmation "שלחנו להורים מייל…" | **PASS (with bug — see B1)** | text shown: `שלחנו להורים מייל היום. כשהם יפעילו, ארטו חוזר.` — i.e. the API answered `already:true` on the **first** click |
| 2f | DB: one `sends` row `kind='cap'`, `week_key` = today, `resend_id` not null | **PASS** | `id 461aa87a-…, kind cap, week_key '2026-09-08', edition_n null, to_emails {raphco+qa@gmail.com}, resend_id 91a0efc9-73e7-46c6-8a01-4a43cd222823, sent_at 2026-09-08T13:42:00.999Z`. (`resend_id` was still NULL when read ~1 s after the 429 and filled a few seconds later — see B2.) |
| 2g | `POST /api/kid/ask-parent` again → `already:true`, still one row | **PASS** | HTTP 200 `{"ok":true,"already":true}`; `select count(*) … kind='cap'` → **1** |
| 2h | Chat locks after the cap | **PASS** | `#chatIn.disabled = true`, placeholder `ארטו נח — נתראה מחר!` |
| 3a | Magic link lands signed in on `/billing?kid=…` | **PASS** | `GET /auth/cb/L2JpbGxpbmc_a2lkPTI0MTFiZTRlLTdiODQtNDc1ZS1hYTRkLTllMWI5YzZmNDdlNw?token_hash=…&type=email` → final URL `https://rootsandwings-edu.com/billing?kid=2411be4e-…` (this is exactly the production template shape `{{ .RedirectTo }}?token_hash={{ .TokenHash }}&type=email`) |
| 3b | Highlighted kid card, free status, enabled button | **PASS** | card `#kid-2411be4e-…` present, `border-color: rgb(27,27,27)` = `--sun` (`#1B1B1B` in the light palette — the highlight is deliberately monochrome); pill `חינם`; status line **`חינם (3 שאלות ביום)`**; button **`הפעילו את ארטו ל-בדיקה — 10 ₪ לחודש`**, `disabled=false`; no "ניהול / ביטול" link |
| 3c | `/home` shows the cap hint linking to billing | **PASS** | anchor text `ארטו סיים היום את 3 השאלות של בדיקה ורצה לשאול עוד — להפעיל (10 ₪ לחודש)`, `href="/billing?kid=2411be4e-…"` |
| 3d | Signed-out `/billing?kid=` bounces to sign-in keeping the destination | **PASS** | `307 → /signin?next=%2Fbilling%3Fkid%3D2411be4e-…` |
| 4 | Activate → Dodo hosted checkout, ₪10.00/month | **PASS — stopped there, nothing paid** | `https://checkout.dodopayments.com/session/cks_0Nn9x1cEjP47bl47th2rg`; page text: `Roots And Wings EDU · Pay in ILS · ארטו — העוזר של שורשים וכנפיים · ₪10.00 / Month (sales tax incl.) · Subtotal ₪10.00 · VAT ₪0.00 · Total ₪10.00`; name/email prefilled `QA הורה / raphco+qa@gmail.com`. Screenshot: `tests/e2e/shots/qa-checkout.png` |
| 5a | `POST /api/admin/dodo-setup {action:"simulate", type:"subscription.active"}` | **PASS** | HTTP 200 `{"applied":{"applied":true,"kid_id":"2411be4e-…","status":"active"},"event":"subscription.active"}` |
| 5b | `subscriptions` row | **PASS** | `provider dodo, provider_subscription_id sub_qa_1788875144, status active, current_period_end 2026-10-08T13:45:45.642Z, cancel_at_period_end false` |
| 5c | `sends` row `kind='billing'` | **PASS** | `kind billing, week_key null, to_emails {raphco+qa@gmail.com}, resend_id present, sent_at 2026-09-08T13:45:46.983Z` |
| 5d | `/billing` reload: "פעיל עד …" + "ניהול / ביטול" | **PASS** | pill `פעיל`; status line **`פעיל עד 8 באוקטובר 2026`**; activate form gone; link `ניהול / ביטול` → `/api/billing/portal`. `/home` cap hint gone. |
| 6a | `POST /api/arto/session {kidToken, edition_n:1}` → `cap:30, subscribed:true` | **PASS** | HTTP 200 `{"remaining":27,"cap":30,"subscribed":true,"demo":false}` |
| 6b | 5th message in the UI gets a real reply (no cap) | **PASS** | reply class `msg bot`: `לפי החישוב של ארטוסתנס יצא בערך 40,000 ק"מ היקף לכדור הארץ…`; `arto_counters.messages` 3 → 4 (the capped 4th never counted) |
| 6c | Bonus: `wow-artotip` cleared → `goTo(2)` → `#artoTip.on` | **PASS** | `#artoTip` exists, class `on`, text `לא בטוח? שאל את ארטו — הוא כאן בשביל בדיוק זה: להסביר שוב, לתת רמז, לא לתת תשובה.` |
| 7 | Cleanup | **PASS** | `{"deleted":["raphco+qa@gmail.com"]}`; parents/kids/subscriptions/sends rows for the QA family = 0; auth user `2135cebb-…` `DELETE` → 200, 8 users remain (same as before the run), 0 matching `+qa` |

**No failures.** Two behaviour bugs and two cosmetic/robustness issues below.

---

## The subject line the parent sees for the cap email

From `capNoticeMail()` (`src/lib/emails.ts:674-685`), the subject is the same string as the mail title:

- **What was actually sent in this run** (`askedByKid = false`, the automatic cap notice):
  **`בדיקה רצה לשאול את ארטו עוד`**
  (generic form: `<שם הילד/ה> רצה לשאול את ארטו עוד`)
- The kid-initiated variant (`askedByKid = true`) would be:
  **`בדיקה רוצה שתפעילו את ארטו`**
  — but see **B1**: in practice it is unreachable.

Body (both variants) ends with the CTA button `להפעיל את ארטו לבדיקה` → `https://rootsandwings-edu.com/billing?kid=<id>`, plus `שלושה צעדים: לוחצים על הכפתור, מאשרים את הכניסה במייל שיגיע, ומשלמים. ארטו נדלק מיד.` Reply-To is the editor's address.

---

## Bugs

### B1 — The kid's "שלח להורים בקשה" is always a no-op; the parent never gets the kid-asked email (medium)

The automatic notice fires the moment the cap is hit (`consumeForSession` → `notifyCapHit(kid, day, cap)` with `askedByKid = false`, `src/lib/arto.ts:242`), and `notifyCapHit` de-duplicates on `(kid_id, kind='cap', week_key)`. So when the kid then presses the button, `/api/kid/ask-parent` always returns `already:true`.

Consequences:
1. The kid is told `שלחנו להורים מייל היום…` ("we already sent them a mail today") instead of the intended first-time copy `שלחנו להורים מייל עם קישור…` — reads as if the button did nothing.
2. The `askedByKid = true` email — subject `… רוצה שתפעילו את ארטו`, opener `בדיקה לחץ/ה על "שלחו להורים בקשה" בתוך השיעור.` — is effectively dead code: the parent always gets the weaker automatic variant.

**Repro:** create a family; as the kid, send 4 messages in one day; the 4th returns 429 with the button; click it → `{"ok":true,"already":true}` and the "already" copy. Verified: single `sends` row with `sent_at 13:42:00.999Z` (the cap hit), button clicked ~3 s later, no second row.

**Suggested fix (not applied — no app code was modified):** either don't auto-notify on cap-hit and let the kid's button be the trigger, or let an explicit kid request upgrade the existing same-day notice (send the `askedByKid` mail once even if the automatic one already went out, e.g. a second `sends` kind or a flag on the row).

### B2 — The cap notice is fire-and-forget inside a serverless response (medium, intermittent)

`notifyCapHit(...)` is called without `await` (`.catch(() => {})`) from `consumeForSession`, so the Resend call races the function returning the 429. In this run the mail did complete (`resend_id` appeared a few seconds after the response), but the same table shows a real family from earlier today whose cap row never got an id:

```
6ede0847-…  kind=cap  week_key=2026-09-08  to=[mikael.cohen@gmail.com]  resend_id=NULL  sent_at 12:58:22.934Z
```

4 of the 5 `cap` rows in production have a `resend_id`; that one does not — i.e. a parent whose kid hit the cap most likely never received the mail, while the dedupe row exists, so it will never be retried. On Vercel this needs `waitUntil()`/`after()` (or an await) so the send outlives the response.

### B3 — Hebrew gender in the automatic cap subject (cosmetic)

`capNoticeMail` hardcodes masculine forms in the non-`askedByKid` copy: title `${kidName} רצה לשאול את ארטו עוד` and body `…ורצה לשאול עוד`. For a girl it should be `רצתה`. (`emails.ts:676,679-680`.) Also `const wants = feminine ? "רוצה" : "רוצה";` (`emails.ts:675`) is a no-op ternary — both branches are identical.

### B4 — `/auth/cb/*` fails silently on an implicit-flow landing (low)

Supabase's admin `generate_link` returns an `action_link` that uses the **implicit** flow. Following it lands on
`/auth/cb/<b64>#access_token=…&refresh_token=…&type=magiclink` — no `code`, no `token_hash` in the query — and the route falls through to `NextResponse.redirect('/signin?error=1&next=…')` even though the session tokens are right there in the fragment (unreadable server-side). Verified in this run: landed on `/signin?error=1&next=%2Fbilling%3Fkid%3D…`.

This does **not** affect production email links (the templates use `{{ .RedirectTo }}?token_hash={{ .TokenHash }}&type=email`, which works — step 3a), but any implicit-flow link (an admin-generated link, or a provider config change) shows a bare error. A small client-side fallback on `/signin?error=1` that reads `location.hash` and calls `setSession` would close it.

---

## Non-issues checked and cleared

- **Supabase redirect allow-list is fine.** `admin/generate_link` first appeared to strip the path (`redirect_to` came back as the bare site URL) — that was the wrong request shape: for the **admin** endpoint `redirect_to` is a **top-level** body field, not nested under `options` (which is the client-SDK shape and is ignored). With `{"type":"magiclink","email":…,"redirect_to":"https://rootsandwings-edu.com/auth/cb/<b64>"}` the full path is echoed back and the `verify` redirect preserves it. `additional_redirect_urls` in `supabase/config.toml` (`https://rootsandwings-edu.com/**`) is live on the project.
- **Kid-card highlight on `/billing`** computes to `rgb(27,27,27)`, which *is* `--sun` in the light palette (`globals.css:5`) — the highlight works; the palette is monochrome by design.
- **`sends` uniqueness** holds: repeated `ask-parent` calls never create a second row.
- **Counter accounting** is correct: the capped message does not consume the quota (3 → still 3 after the 429; 4 after the post-subscription question).
- **Portal link** appears as soon as a subscription exists (`ניהול / ביטול` → `/api/billing/portal`), even for the synthetic `cus_qa` customer.

## Housekeeping — action needed

Commit `e999e10` ("Sender: hello@rootsandwings-edu.com (Resend verified)", 16:43, made in a parallel session while this run was in flight) swept in two of this run's throwaway scripts: `tests/e2e/qa-cap.mjs` and `tests/e2e/qa-db.mjs`. Both are deleted in the working tree now (`git status` shows ` D` for them), but they are still in `HEAD` — a follow-up commit is needed to drop them. Neither file contains a secret: they read the DB password and the kid token from the environment / the session scratchpad, nothing is inlined.

## Note for the next run

The mailer now sends from `hello@rootsandwings-edu.com` (Resend domain verified 2026-09-08 ~16:27), not `hello@haggl.ai`. Inbox verification of the two mails (cap + billing) was not possible in this session — the Gmail connector reported an invalidated connection — so the subject line above is taken from `capNoticeMail()` in `src/lib/emails.ts` plus the `resend_id` recorded on the `sends` row.
