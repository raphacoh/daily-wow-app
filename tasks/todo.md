# 2026-09-16 — malformed family, mailer resilience, admin family controls

- [x] 1. (done 2026-09-16 via the new /admin control, after deploy) Delete the malformed family `assaflehr@gmai..com` in production (correct duplicate at assaflehr@gmail.com stays)
- [x] 2. Mailer: validate every recipient address, skip bad ones per address, isolate per-copy Resend failures so one bad copy no longer sinks the whole batch (edition #9 went 0/36)
  - [x] `isEmailAddress` (strict: no `..`, real domain labels) in src/lib/emails.ts; family.isEmail delegates to it
  - [x] `copies()` drops invalid addresses; `deliver()` returns per-copy results and falls back to single sends when a batch is rejected
  - [x] `sendBatch` returns per-mail results; `sendDaily` releases only the failed claims and reports `bad_address` / `send_failed`
  - [x] unit tests (emails, jobs)
- [x] 3. /admin: edit (name, email) + delete controls for a family
  - [x] admin.ts `updateFamilyContact`, `deleteFamilyByAdmin` (+ tests)
  - [x] actions.ts + page.tsx forms; recent-signups rows link to the family panel
- [x] Verify: `npm test`, `npx tsc --noEmit`, lint

## Review
- `npm test`: 209 pass, 3 fail — all pre-existing and date-dependent (queue.test expects `releaseQueued` to stamp the test clock but `releaseEdition` stamps the real date; analytics.test counts lessons since a fixed date). Unrelated to this change.
- `tsc --noEmit` and `next build` clean. No `lint` script in the project.
- Not verified in a browser: /admin needs a Supabase session, which is not configured locally.
- Deployed 2026-09-16 (commit a86f9a3, rebased over PR #1's resume runtime; the older local draft of the runtime was dropped in favour of the merged one). Migrations applied by Raph with `supabase db push`. Test mail for #9 sent through the new path; malformed family deleted from /admin, the assaflehr@gmail.com record intact.
