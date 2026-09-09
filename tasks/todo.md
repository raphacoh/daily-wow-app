# The Daily Wow app — build plan (from daily-wow-app-PRD.md v1)

Working dir: /Users/rapha/arto (new repo). Kit clone: ~/Projects/daily-wow-kit-upload/repo.
No Docker locally → Postgres logic is tested against PGlite (same SQL), prod = Supabase via `pg`.
No provider keys locally (Anthropic/Resend/Dodo/Supabase) → every integration is env-driven,
runs in "not configured" mode locally, and is covered by unit tests with fakes.

## M0 — Foundation
- [x] Engine: `RUNTIME` bootstrap in kit template (profile fetch, auto-pick, level→track mapping, no gate)
- [x] Engine: completion POST in `finish()`, server stats win; mailto kept secondary
- [x] Engine: `PX` speaks to `/api/arto/*` with kid token, no system prompt, counter ≤5, `429 cap` copy
- [x] Engine: `body[data-push]`, challenge heading "מומלץ בשבילך" for on_track
- [x] Kit: `template/lint.js` (math outside .math, gendered forms, level twins); README update
- [x] Editions content: `editions/e/001/edition.html` (family-agnostic fragment) + meta.json + editions.json
- [x] Next.js app scaffold (TS, app router), design tokens from the engine, he.json/en.json
- [x] SQL migration (schema §8 + RLS) ; db layer (`pg` prod / PGlite tests)
- [x] `GET /l/[n]` + `/l/today` runtime injection, demo profile without token
- [x] `GET /api/kid/profile`
- [x] Magic-link sign-in (Supabase Auth via @supabase/ssr), parents row on first sign-in
- [x] Playwright: anonymous visitor completes edition 1 and reaches the vault

## M1 — Families
- [x] Landing `/`, `/join`, `/signin`, `/home`, `/library`, `/privacy`, `/terms`
- [x] `POST /api/kid/complete` (best score, first completed_at, streak derived, XP, badges)
- [x] Emails (Resend): magic link (Supabase), welcome, daily, completion, weekly, streak-risk, billing
- [x] `POST /api/jobs/send-daily` idempotent per (edition, family) + vercel.json crons
- [x] Family migration script (Raph: Adam/Emma; Mik: Milan/Chiara)
- [x] API tests: completion/streak/late/retry

## M2 — Pipeline handshake
- [x] Admin API (bearer EDITOR_API_KEY): editions list/stage/release/hold, menus
- [x] Admin UI `/admin`
- [x] Updated prompts in kit (`prompts/`): builder loses ledger/settle steps, release calls the app

## M3 — Assistant + billing
- [x] `/api/arto/session|chat|grade` server-side system prompt, scope tag, bridge lines, counters (30/3), usage rows, demo pool
- [x] Dodo checkout / portal / webhooks; `isEntitled(kid)`; billing page; billing emails
- [x] `/open-books` public page + monthly aggregation
- [x] Tests: 3-then-stop, cap 30 after subscription, cancel keeps until period end, off-topic bridge, webhook replay

## M4 — Polish
- [x] Accessibility pass, README (cost model, contributors), .env.example, deploy notes
- [x] Playwright: both tracks × four levels; no console errors

## Review (2026-09-08)
- Build: `next build` clean (0 warnings). Unit: 9 files / 146 tests on PGlite. E2E: demo + 3 kids (all four levels) reach the vault; completion → streak 1, XP 135, badges. Kit: check.js ERRORS none, lint.js ok.
- Not verifiable locally (no keys): Supabase magic links, Resend delivery/inbox placement, live Anthropic replies, Dodo checkout. Each path is exercised with fakes (setModel, setMailer, signed Standard-Webhooks payloads) and degrades to "not configured".
- Deviations from the PRD: link tokens are also stored AES-GCM-encrypted (one stable link per kid, shown on the dashboard); the mailto report is hidden in app mode (the app emails the parent); `pglite://` local database mode; a `teaser` column on editions for the daily email.
- Left for the editor (PRD §14): domain + Resend sender, ILS on Dodo, the founding families' real emails (scripts/families.example.json), pushing the updated kit + editions repos, pasting the new prompts into the routines.

## Gamification P0 (Tier 0) — from docs/gamification-spec.md
- [x] Migration: grades, kid_progress; editions.wow_meta/engine_version (`supabase/migrations/20260909000000_gamification.sql`)
- [x] src/lib/roots.ts: canonical roots + alias mapping, root XP split, stages
- [x] src/lib/gamification.ts: medals, cards, badges, deriveProgress (pure), rebuildProgress, progressSummary
- [x] progress.ts: computeStreakDetail (forward walk, streak shields: earn every 7, hold 2, absorb one miss)
- [x] kids.ts: recordCompletion replays kid_progress inside the transaction and returns `progress`
- [x] arto.ts grade(): persists `grades` (server-observed stars) and rebuilds progress
- [x] GET /api/kid/progress ; POST /api/admin/rebuild-progress ; complete response gains `progress` + `today.{medal,next}`
- [x] public/wow-runtime.js injected before every fragment: hero strip, results block (medal, roots, card, new badges, shields), drawer (grove, album with missing cards, badge case), WOW.emit buffer
- [x] /home kid card: shields on the streak pill, medal rings on the 14-day row, roots chips, progress badges
- [x] i18n strings (he/en)
- [x] Tests: tests/unit/gamification.test.ts (11); e2e extended (results block, drawer, strip, progress API)
- [x] P1: engine `WOW.emit` hooks + `ENGINE_VERSION='2'` in the kit template and edition 001 (lint ok); `/api/kid/events` (item_events, first attempt immutable, cap 200); wings/feathers; grit/curiosity/rarity badges; `/api/jobs/close-day` (item_stats, notices) + crons; weekly journeys derived; runtime flushes events (sendBeacon on hide), shows feathers, journey, notices, wings in the drawer; builder prompt + kit README document the hooks
- [x] "השאלה הקשה של השבוע": lowest community first-try rate (n ≥ 8) among a closed week's items; awarded once (badge ids are unique), notice via close-day
- [x] Decided: no XP for journeys (XP has one source, completions); the `perfect_journey` badge stands in — noted in the spec
- [ ] Rollout: one nightly build must start from the kit template (spec §7.4) so ENGINE_VERSION 2 + WOW_META reach new editions; then `POST /api/admin/rebuild-progress` once
- [ ] Not rendered locally: the /admin gamification section (needs a Supabase editor session); data layer is unit-covered
- [x] P2: `src/lib/wow-meta.ts` (balanced-literal extraction, sandboxed serialisation with timeout, field validation → warnings); stored at staging and import (`wow_meta`, `engine_version`); `POST /api/admin/editions` returns `warnings[]`; skills in `deriveProgress` (mastered = 3 first-try across 2 editions); `GET /api/admin/gamification` (per-edition engine/warnings, unmapped topics, skills in use, item stats); WOW_META example in the template and edition 001; `kit/prompts/skills.md`; builder prompt section
- [x] P2 leftovers: `root_aliases` + `skills` registries (migration), `/admin` section (engine/warnings per edition, map unmapped topics to roots, Hebrew names and merges for skills, rebuild button), aliases and canonical slugs flow through `deriveProgress`, skill leaves in the drawer and "כישורים שנרכשו" on the dashboard, weekly email gets the week's medals/cards and the badges earned that week

## Review (2026-09-08, gamification P2 leftovers)
- Unit: 178 tests. Build clean. E2E none. Registry round-trip (alias, skill name, merge) covered in wow-meta.test.ts.

## Review (2026-09-08, gamification P2)
- Unit: 177 tests (5 new). Build clean. E2E none. Kit check.js and the edition 2 smoke test pass.
- Bug caught by a test: evaluating the builder's literal and reading it outside the VM let a getter run without the timeout (hung the suite). Now `JSON.stringify` runs inside the sandbox and only plain data leaves it.

## Review (2026-09-08, gamification P1)
- Unit: 172 tests (17 gamification). Build clean. E2E: events emitted (predict, qc, mcq, order, num, explain, finish), 10 stored for the kid, feathers block ("הבנה +", "חישוב +"), journey line on the strip, drawer 15 trees (8 roots + 7 wings).
- Gotcha found: the runtime must load synchronously (no `defer`) — the fragment's inline engine evaluates `window.WOW` at parse time.
- Journey "+50 XP" from the spec is not implemented (XP is only ever awarded from completions); the ribbon/badge `perfect_journey` is.

## Review (2026-09-08, gamification P0)
- Unit: 13 files / 166 tests on PGlite. `next build` clean. E2E: demo + kid + advanced + support all pass; the kid sees "המדליה של היום: זהב", the card, four roots, two new badges; the drawer renders 8 trees, 2 album cards (1 earned + 1 missing), 23 locked badges; the second visit shows the hero strip.
- Pre-existing e2e breakage fixed on the way: the dev seed dated the highest edition as today, so `/l/today` went to edition 2 (legacy single track) — the seed now dates the demo edition today and the test walks `/l/1` explicitly.
- Not done in P0 by design: weekly email additions (§10), admin alias/skills UI (§9), anything needing per-item events.
- Not committed (not asked).

## Landing by role (2026-09-09)
Signed-in users should not land on the visitor demo. Parents land on the dashboard and can open any
lesson there in demo mode; kids land on today's lesson and reach everything else from a menu.

- [x] `src/lib/kidSession.ts`: httpOnly cookie `rw_kid` (the kid's link token), read/set/clear, safe outside a request scope
- [x] `/l/[n]`: remember a valid `?k=` in the cookie; use the cookie when there is no `?k=` and no signed-in parent; clear a stale cookie
- [x] `/`: signed-in parent → `/home`; remembered kid → today's lesson; everyone else → the demo page as today
- [x] `/library`: same cookie fallback (kid links without the token in the URL)
- [x] Kid menu in the lesson page (button in the edition topbar, not a banner): today, my collection, all editions, parents' page, sign out
- [x] `POST /auth/signout/kid`: forget the kid on this device
- [x] Dashboard: open any edition in demo mode (today's card + history links) and a link to the library
- [x] Tests for the routing rules

## Review (2026-09-09, landing by role)
- Unit: 185 tests, 14 files pass; 6 new in `tests/unit/landing.test.ts` (next/headers and currentParent mocked). `tests/unit/analytics.test.ts` fails on `main` too — `daily()` is date-relative and the fixture is dated 2026-09-08.
- Build clean, typecheck clean, e2e clean (demo + kid + advanced, drawer 15 trees / 2 cards / 3 badges).
- Verified by hand against the dev server: personal link sets `rw_kid`, `/` redirects to today's lesson (`cache-control: private, no-store`), `/l/2` without `?k=` runs in kid mode, `/library` shows "לגיליון של אמה" with token-free links, `POST /auth/signout/kid` clears the cookie and `/` is the visitor demo again, a stale token is dropped on the way through.
- Decisions worth remembering: a signed-in parent always outranks the cookie (otherwise "open for Dana" from the dashboard would turn the parent into the kid, and previews would write to the kid's account); a paused kid keeps the device (only a token that belongs to nobody is dropped); the kid menu is appended into the edition's own `.topbar-in` and only floats when an edition has no top bar.
- Not verified in the browser: the parent dashboard (no Supabase keys locally, so `/home` redirects to `/signin`). Covered by typecheck and build only.
