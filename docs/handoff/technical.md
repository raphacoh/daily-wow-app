# Technical reference

For whoever changes the code: a developer, or Claude Code driven by the editor. The [app README](../../README.md) has the architecture diagram and the main code map. This page adds what you only learn by running the app.

## Stack

| | |
|---|---|
| Framework | Next.js 16 (App Router), React 19, TypeScript. **Breaking changes from older Next.js:** read `node_modules/next/dist/docs/` before writing Next code. `src/proxy.ts` is what used to be called middleware |
| Node | 20.9 or later |
| Data | Postgres via `pg` in production (Supabase, transaction pooler). PGlite, an embedded Postgres that runs every migration itself, in tests and local dev (`src/lib/db.ts`) |
| Auth | Supabase: magic links, plus a first-party Google sign-in (`/auth/google` → Google → `/auth/google/callback` → `signInWithIdToken`) |
| Mail | Resend: sending, plus inbound mail to hello@, forwarded by webhook |
| Payments | Dodo Payments: one recurring product, plus a webhook at `/api/webhooks/dodo` |
| Assistant | Anthropic SDK (`src/lib/arto.ts`). The model is set in `/admin` or by the `MODEL` env var |
| Tests | vitest on PGlite; Playwright scripts in `tests/e2e/` |

## Code map: additions to the README table

| Piece | Where |
|---|---|
| Gamification: pure derivation, plus a rebuild replayed on each completion | `src/lib/gamification.ts` (`deriveProgress`, `rebuildProgress`), `src/lib/roots.ts`, `src/lib/progress.ts` |
| Per-lesson metadata the builder writes (`WOW_META`) | `src/lib/wow-meta.ts`. It is evaluated inside `vm.runInNewContext` with a timeout |
| The runtime injected into every lesson (rewards drawer, resume) | `public/wow-runtime.js`, injected by `src/lib/lesson-page.ts`. Bump `WOW_RUNTIME_VERSION` (`lesson-page.ts:12`) whenever it changes |
| Kid links: stored hashed for lookup **and** AES-GCM-encrypted with `LINK_KEY`, so the same link can be shown again | `src/lib/tokens.ts`, `src/lib/kids.ts` |
| Unsubscribe, per address | `src/lib/unsubscribe.ts`, `/api/unsubscribe` |
| Founding-family importer | `src/lib/importer.ts`, `POST /api/admin/import` |
| Edition gate: lint, then gamification hooks, then smoke test | `scripts/gate-edition.mjs` (`npm run gate:edition -- <fragment>`) |
| Configuration | `src/lib/config.ts`. Precedence: **env var > `app_config` table (edited in `/admin`) > defaults**. If Vercel sets an env var, editing the same key in `/admin` does nothing |

## Run it locally

No accounts are needed. Everything degrades to "not configured".

```bash
npm install
npm run dev     # or, in the Claude desktop app, start the "daily-wow" preview from .claude/launch.json
```

The `daily-wow` configuration wipes `.pglite-dev` and starts on port 3000 with `DATABASE_URL=pglite://./.pglite-dev DEV_SEED=1`. Then create the tables and the test family:

```bash
curl -X POST localhost:3000/api/dev/migrate
```

```bash
curl -X POST localhost:3000/api/dev/seed
```

The seed returns the test kids' personal links. `/l/1` is the demo lesson. The dev routes return 404 in production.

## Tests

```bash
npm run typecheck
```

```bash
npm test
```

On 2026-10-14: **211 pass, 3 fail.** The three failures are known, date-dependent, and come from the tests rather than the product:

- `tests/unit/queue.test.ts`, two tests. `releaseEdition` stamps the database's `now()` (`src/lib/admin.ts:185-186`), not the test clock, so "released today" depends on the real date.
- `tests/unit/analytics.test.ts`, one test. It counts events from fixed 2026-09-08 dates.

Fixing them means passing the clock through `releaseEdition`, and making the analytics fixtures relative to "now".

Other checks:

| Command | What it proves |
|---|---|
| `npm run test:e2e` | Edition 1 completed on a phone viewport by a demo visitor and by three real kids (all levels). The completion lands in the DB |
| `npm run test:e2e:resume` | Leave halfway, come back, and every answer is still there |
| `node tests/e2e/join.mjs` | The sign-up wizard |
| `npm run smoke:edition -- <fragment>` | Any edition loads and completes, whatever its content |
| `npm run gate:edition -- <fragment>` | Lint, then gamification hooks, then smoke. Use it before staging any hand-edited edition |
| `node kit/template/check.js` and `node kit/template/lint.js <file>` | The kit's own checks. Lint must print `LINT: ok` |

Set `E2E_CHROMIUM=/path/to/chrome` to use a browser that is already installed, and `E2E_BASE=<url>` to target a running server.

## From a change to production

1. **Work on a branch, never on `main`.** `main` is production: the GitHub repo is connected to Vercel, so a push to `main` deploys https://rootsandwings-edu.com. Confirm this in Vercel → Project → Settings → Git. `vercel deploy --prod` from a linked checkout is the fallback. Branches get Preview deployments.
2. **Open a PR,** with `npm run typecheck` and `npm test` green apart from the known three.
3. **Migrations** are new files in `supabase/migrations/`, with a timestamped name. The unit tests run every migration on PGlite, so a broken migration fails `npm test`. In production, **a human** applies them with `supabase db push` from a linked checkout, **before** deploying code that needs them. Agents are not allowed to touch the production database. Hand the command or the SQL to the owner.
4. **Prompt changes** (`kit/prompts/`) do not deploy anywhere by themselves. Paste the filled-in prompt into the running Cowork task or routine. Keep the repo copy identical.
5. **Edition engine changes** (`kit/template/edition-template.html`) reach production through the builder: it copies edition N−1. Each change therefore reaches the next build only. Already-released editions never change, and `public/wow-runtime.js` is what lets new behaviour reach old editions.

## Traps we already fell into

| Trap | Rule |
|---|---|
| `sslmode=require` in `DATABASE_URL`: `pg` treats it as verify-full and fails on Supabase's certificate authority | No `sslmode` flag in the URL |
| `importLocalEditions` upserts html, title and teaser on conflict | Never run the importer while a routine-staged row with the same `n` exists |
| `wow-runtime.js` loaded with `defer`: the engine's shim had already become a no-op | Inject it synchronously, before the fragment |
| A getter inside a `WOW_META` literal hung the test suite | Keep the evaluation in `vm.runInNewContext` with a timeout |
| The brand name was hard-coded in about 10 files when it changed | User-facing brand strings come from `APP.name` or i18n only (`tasks/lessons.md`) |
| Re-dating an edition to fill a lost day | It resets every kid's streak. Release late; never re-date |
| A scheduled build failed with `403 host_not_allowed`, and edition #5 was never built | The cloud environment's network access. See [operations.md](operations.md#when-something-breaks) |
| The CSP `form-action` blocked the redirect to Google after a form post | The Google button is a link, not a form |
| Google blocks automated browsers at the account chooser | Verify Google sign-in in a real browser |
| Magic links lost their destination | The destination travels in the path, `/auth/cb/<base64url(next)>`, and the Supabase templates use `{{ .RedirectTo }}` |
| A kid with no email of their own never gets their own copy of the daily mail | Recipients are `parents.email` + `kids.email` + `kid_contacts` (`dailyRecipients`). Parents fix it at `/home` |
| QA with real-looking emails polluted the live families | Use plus-addresses for QA, and delete the families **and** their Supabase auth users afterwards |
| Git broke once (Xcode license) and work piled up uncommitted | If `git status` looks suspiciously clean, run `git --version` |
| Rotating `LINK_KEY` | Never: every kid's link and every unsubscribe link stops working |

## Data, in one paragraph

The full schema is in `supabase/migrations/20260908000000_init.sql`, with row-level security. Later migrations add:

- adopt-by-email at first sign-in;
- the cap mail kind and demo caps;
- `events` (analytics);
- gamification tables: `grades`, `kid_progress`, `item_events`, `item_stats`, `kid_notices`, `root_aliases`, `skills`;
- the approval queue: status `approved`, nullable `date`, `revision_note`;
- `unsubscribes`.

**Streak, XP, badges and medals are never stored as counters.** They are derived from completions, answers and grades, so a rules change needs `POST /api/admin/rebuild-progress` and nothing else.

## Branches

| Branch | State |
|---|---|
| `main` | Production |
| `origin/claude/lessons-inbox-delivery-hrjmjm` (2026-09-12) | Not merged. Has the prompt renderer (`scripts/render-prompts.mjs`, `npm run prompts`), a "no edition today" alert in send-daily, and lessons from the lost edition #5. It conflicts with `main` since `a86f9a3`, so port it piece by piece |
| `origin/claude/emma-feedback-dashboard-grades-progress-lbg1yr` | Same tree as the merged PR #1. Safe to delete |
