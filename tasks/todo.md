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
