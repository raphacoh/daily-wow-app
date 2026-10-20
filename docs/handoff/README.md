# Handoff: start here

Roots and Wings (שורשים וכנפיים) changes hands in October 2026. Raphael built it and stays involved. The new owner is an education specialist who runs the service as its editor and makes changes through Claude Code. His roadmap: keep the Hebrew service running, build a French service, then an English one, then optimize all of them.

This folder is for him and for the agents he drives. It sits on top of the existing docs and does not replace them.

> **Not in this folder:** account owners, logins and the account-by-account transfer checklist. This repository is public, so those live in the private handover guide (in French) that Raphael shares directly. No secret, key or family data ever goes in this repo (see issue 1 below).

## Reading order

| # | File | For |
|---|---|---|
| 1 | [operations.md](operations.md) | How a day runs, what the editor does, what to do when something breaks |
| 2 | [localization.md](localization.md) | The plan for French, then English |
| 3 | [optimization.md](optimization.md) | What we measure, the levers (pedagogy, product, money), the backlog |
| 4 | [technical.md](technical.md) | Code map, local dev, tests, deploy, migrations, the traps we already fell into |

Deeper references, unchanged: [the app README](../../README.md), [the gamification spec](../gamification-spec.md), [the prompts README](../../kit/prompts/README.md) (the three scheduled agents and the admin API), [the engine README](../../kit/template/README.md) (the lesson page).

## Where things stand on 2026-10-14

- **Live** at https://rootsandwings-edu.com since 2026-09-08. A new interactive lesson goes out every day, built overnight by a Claude agent and reviewed by the editor.
- **42 families, 50 kids** registered (public `/open-books`, October 2026). They came by word of mouth, with no paid acquisition.
- **0 paying subscriptions.** The lesson is free. Only the assistant ("Arto") is paid, at ₪10 per kid per month, and nobody has subscribed yet. September's token cost was ₪9.61 for the whole service. The demand is real, but nobody has tested the price yet.
- **Code:** `main` at `1eb9a6b`, last deployed 2026-09-16. `npm run typecheck` is clean. `npm test` gives 211 pass and 3 fail. The 3 failures are known and date-dependent (see [technical.md](technical.md#tests)). There is no CI.
- **Two editions in this repo** (`editions/e/001`, `e/002`). Every later edition lives in the database and in the public content repo `raphacoh/daily-wow-editions`.

### Baseline to record at handover

The public page does not show these numbers. Read them on `/admin/analytics` (editor sign-in) on handover day and write them here. Every later optimization is measured against them.

| Metric | Where | Value at handover |
|---|---|---|
| Lessons completed, last 7 days | `/admin/analytics` → daily series | |
| Kids with at least one completion, last 7 days | `/admin` → families | |
| Completion rate of the last 5 editions (completed ÷ kids mailed) | `/admin` → editions | |
| Sign-ups, last 30 days | `/admin/analytics` → funnel | |
| Demo visitors → demo completed → sign-up | `/admin/analytics` → funnel | |
| Assistant: kids who used it, off-topic % | `/admin` → Arto panel | |
| "Ask my parents" mails sent, checkouts started | `/admin/analytics` | |

## What changes in the app when the editor changes

None of this needs code. Do it in this order, on one day, with Raphael.

1. **Admin rights.** The new editor signs in once at `/signin` with his own email. Then, in the Supabase SQL editor (a human runs this, never an agent): `update parents set is_editor = true where email = '<his email>';`
2. **Editor identity.** In Vercel → Environment Variables, set `EDITOR_NAME` and `EDITOR_EMAIL` to his, then redeploy. Every family mail's reply-to, the alerts, and the forwarding of mail sent to hello@ follow `EDITOR_EMAIL` (`src/lib/config.ts:62-63`).
3. **The three scheduled agents.** Re-create them on his Claude account, then turn off Raphael's copies **the same day**: two builders build two editions.
   - First compare the prompts that are actually running with the ones in `kit/prompts/`. They have drifted (issue 4).
   - Then fill in the placeholders with his name and email (`{{PARENT_NAME}}`, `{{PARENT_EMAIL}}`; see the [placeholder table](../../kit/prompts/README.md#placeholders)).
   - Attach `daily-wow-editions` to the release routine. He needs write access to that repo.
   - Give the routine's cloud environment network access to `rootsandwings-edu.com`, `raw.githubusercontent.com` and `api.github.com` (see [operations.md](operations.md#when-something-breaks)).
4. **Tell the families.** On his first release, put a short `editor_note` introducing him. It appears in the daily email.
5. **Keys.**
   - `EDITOR_API_KEY` is inside the prompts. It travels by password manager only, never by email, chat or document. It can be rotated once the handover is done: generate a new one, update Vercel, re-paste the prompts.
   - **Never rotate `LINK_KEY`**: every kid's personal link dies, and so does every unsubscribe link.
   - Rotating `SESSION_SECRET` signs every parent out.
6. **Admin copy.** One admin label still names Raphael: `src/app/admin/page.tsx:685`. Make it read `APP.editorName`.

## Fix first (ranked)

These were all checked against the code on 2026-10-14. The first three matter before any French launch.

1. **Children's names and a relative's email in a public repo.**
   - What: `editions/e/002/edition.html:671-677` carries four real kids' first names, ages and grades, plus a relative's email address as a cc.
   - Where: here and in `daily-wow-editions`, with git history.
   - Fix: replace them with the template's example kids (`kit/template/README.md`). Decide with the family whether the history needs rewriting.
2. **The privacy page promises more than the code does.**
   - It says Anthropic receives the lesson and the question "without name or email" (`src/app/privacy/page.tsx:76`). But the assistant's system prompt includes the kid's first name, age and grade (`src/lib/arto.ts:118-122`).
   - It says off-topic questions are kept anonymously, "with no link to the child" (`privacy/page.tsx:56`). But those rows carry `kid_id` (`src/lib/arto.ts:311-314`).
   - Fix: change the code or change the copy. Under GDPR (France) this is not optional.
3. **The assistant's API key.** Raphael noted it would expire on 2026-10-08. Check `/admin` (integrations) and run one real chat from a kid link. If the key is dead, kids get the self-check rubric instead of Arto.
4. **The prompts predate the approval queue.**
   - On 2026-09-11 the app moved to an explicit approval queue: the editor approves in `/admin`, and the 11:05 cron releases the oldest approved edition. The prompts in `kit/prompts/` still release by silence, through the release routine.
   - Both paths exist, and `releaseEdition` has no same-day guard (`src/lib/admin.ts:178-199`), so both can fire.
   - "Request changes" notes (`revision_note`) never reach the builder, because `GET /api/admin/editions` does not return them (`src/app/api/admin/editions/route.ts`).
   - Fix: pick one path and align the prompts and the code. See [operations.md](operations.md#two-release-paths).
5. **Israel leaves daylight saving time on Sunday 25 October 2026.** The two Cowork tasks (topic menu, builder) run on UTC cron and must be shifted by one hour by hand (`kit/prompts/setup-prompt.md:81`). The Vercel crons are already paired for this.
6. **HOLD on a released edition takes it offline.** `holdEdition` has no status check (`src/lib/admin.ts:262-268`), so every kid's link to that lesson stops working.
7. **No mail key looks like success.** When `RESEND_API_KEY` is missing, the daily send counts the skipped mails as sent and keeps the claims (`src/lib/emails.ts:418-421`, `src/lib/jobs.ts:280-292`). After restoring the key, use Republish.
8. **FAQ copy drift.** The FAQ promises four levels, including "on track" (`src/i18n/he.json:48-50`). Parents choose from three (`src/lib/kids.ts:10-15`).
9. **The routine's Gmail copy skips the unsubscribe filter.** It is built from `send-manifest`, which uses the family's recipients without the unsubscribe filter that the app's own mail applies (`src/app/api/admin/editions/[n]/send-manifest/route.ts:30-50`).
10. **Loose branches.**
    - `origin/claude/lessons-inbox-delivery-hrjmjm` is not merged. It has a prompt renderer (`npm run prompts`), a "no edition today" alert and lessons from the lost edition #5. It conflicts with `main` since `a86f9a3`; port it rather than merge it.
    - `origin/claude/emma-feedback-dashboard-grades-progress-lbg1yr` is already merged as PR #1 and can be deleted.
