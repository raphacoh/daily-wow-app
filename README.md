# שורשים וכנפיים — Roots and Wings (app)

The parent front door for the open-source [Daily Wow kit](https://github.com/raphacoh/daily-wow-kit): a parent registers in two minutes, and from the next morning the daily lesson lands in their inbox with a personal link per kid. The lesson is free. The in-page assistant (ארטו) costs real money in tokens, so it sits behind a ₪10 / kid / month subscription presented as *covering costs*. Numbers are public on `/open-books`.

This app **wraps** the kit's page engine, it does not replace it: every edition is a fragment built on `kit/template/edition-template.html`, served by `/l/N` with a small runtime bootstrap injected before it.

## How it fits together

```
02:00  nightly builder (Claude routine)  →  POST /api/admin/editions   (staged, reviewer verdict, review URL)
11:00  release routine (Claude routine)  →  push to the editions repo, POST /api/admin/editions/N/release
11:05  Vercel cron → /api/jobs/send-daily →  one email per family, one personal link per kid  (/l/N?k=…)
       kid opens the link → the page loads their profile → learns → POST /api/kid/complete → vault opens
       parent sees the completion on /home (and gets the ✓ email with the day's password)
```

| Piece | Where |
|---|---|
| Page engine (shared with the kit) | `kit/template/edition-template.html` — runtime bootstrap: `window.RUNTIME = { api, kidToken, edition, profile?, library }` |
| Editions content | `editions/e/NNN/{edition.html,meta.json}`, `editions/editions.json` (seed of the public content repo; also the local store when no DB) |
| Lesson route | `src/app/l/[n]/route.ts` (`/l/today` redirects to the newest released edition) |
| Kid API | `src/app/api/kid/{profile,complete}` |
| Assistant | `src/lib/arto.ts`, `src/app/api/arto/{session,chat,grade}` — system prompt server-side, scope tag, off-topic bridge, counters (30/day subscribed, 3/day free, demo pool) |
| Families | `src/lib/family.ts`, `/join`, `/signin`, `/home`, `/billing` |
| Editor | `src/lib/admin.ts`, `/admin`, `src/app/api/admin/*` (bearer `EDITOR_API_KEY` for the routines) |
| Jobs | `src/lib/jobs.ts`, `src/app/api/jobs/*`, `vercel.json` crons |
| Data | `supabase/migrations/0001_init.sql` (Postgres + RLS), `src/lib/db.ts` (`pg` in prod, PGlite in tests and for `DATABASE_URL=pglite://./.pglite`) |
| Emails | `src/lib/emails.ts` (Resend, Hebrew RTL templates with plain-text alternatives) |

## Run it locally (no accounts needed)

```bash
npm install
cp .env.example .env.local        # set DATABASE_URL=pglite://./.pglite and DEV_SEED=1 for a fully local run
npm run dev
curl -X POST localhost:3000/api/dev/migrate
curl -X POST localhost:3000/api/dev/seed   # imports editions/ and a test family; returns the kids' personal links
```

Open `http://localhost:3000/l/1` (demo mode) or one of the returned links (a real kid: no picker, completion stored, streak/XP server-side). Without `DATABASE_URL` the site still serves the demo lesson, the library and the public pages from the `editions/` folder.

Sign-in needs a Supabase project (`NEXT_PUBLIC_SUPABASE_URL/ANON_KEY`); emails need `RESEND_API_KEY`; the assistant needs `ANTHROPIC_API_KEY`; payments need the Dodo keys. Each integration degrades to "not configured" instead of failing.

## Tests

```bash
npm test            # vitest: progress rules, completions/streaks, assistant caps and scope, billing webhooks, jobs, admin, join, dashboard — all on PGlite
npm run test:e2e    # Playwright: edition 1 completed on a phone viewport as a demo visitor and as three real kids (all four levels), completion in the DB
node kit/template/check.js && node kit/template/lint.js kit/template/edition-template.html   # the kit's own checks
```

## Deploy

1. Supabase: create a project, run `supabase/migrations/0001_init.sql` in the SQL editor, enable Email OTP (magic links) in Auth, set the site URL and `https://<app>/auth/callback` as a redirect URL.
2. Vercel: import the repo, set every variable from `.env.example` (`DATABASE_URL` = the **transaction pooler** string), deploy. `vercel.json` registers the crons (`CRON_SECRET` protects them).
3. Resend: verify the sending domain (DKIM/SPF/DMARC), set `EMAIL_FROM` on it. Free tier ≈ 100 mails/day → paid at ~80 families (`RESEND_DAILY_LIMIT`, the admin page warns at 80 %).
4. Dodo Payments: one recurring product "ארטו — העוזר של שורשים וכנפיים", ₪10 (or USD-equivalent shown as ≈ ₪10), webhook → `https://<app>/api/webhooks/dodo`.
5. Editor account: sign in once, then `update parents set is_editor = true where email = '…'`. Import the founding families with `POST /api/admin/import` (bearer `EDITOR_API_KEY`, body `{ "editions": true, "families": { … } }` — see `src/lib/importer.ts`).
6. Routines: paste the updated prompts from `kit/prompts/` with `{{APP_URL}}` and `{{EDITOR_API_KEY}}` filled in.

## Cost model (PRD §11)

Vercel Hobby/Pro; Supabase free → Pro at ~500 families; Resend free → paid at ~80 families; Anthropic API ≈ ₪1–3 per active assistant kid per month at the 30 messages/day cap (most kids use far less), plus the free 3 messages/day for everyone else (a few agorot per kid per day, carried by the editor and shown on open books), plus the editor's Claude subscription for the nightly build. ₪10/kid/month covers the token cost with margin for the build; `/open-books` keeps it honest.

## Principles that are code, not copy

- Kids never register, never sign in, never see a price. A kid touches one thing: the lesson page, from a personal link.
- Streak, XP and badges are **derived from the completions table** (`src/lib/progress.ts`, `src/lib/kids.ts`); no job ever mutates a counter, so nothing can drift.
- The assistant's system prompt never leaves the server; every reply carries a scope tag; off-topic replies are replaced by a bridge line and audited on `/admin`.
- No third-party scripts, no analytics SDK, no trackers. The only external calls from the lesson page are to this app's own API.
- Hebrew first: every formula in `<span class="math">`, gendered strings from the kid's profile, `kit/template/lint.js` enforces it.

MIT. Editions are the editor's curation of AI-built lessons and may contain mistakes — write to him: raphco@gmail.com.
