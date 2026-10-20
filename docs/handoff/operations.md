# Operations: how a day runs

Two kinds of machinery run the service:

- **Three scheduled Claude agents.** Their prompts are in `kit/prompts/`; they run on the editor's Claude account.
- **Vercel crons.** Defined in `vercel.json`; they run inside the app.

The agents make the lesson. The app owns everything about families. The agents never read or write a child's name, streak or email (see [the prompts README](../../kit/prompts/README.md)).

## The daily timeline

Israel is UTC+3 until Sunday 25 October 2026, then UTC+2 until spring.

| Israel time | UTC (summer / winter) | What | Runs on | Defined in |
|---|---|---|---|---|
| 02:00 | 23:00 the day before / 00:00 | **Nightly builder.** Picks the topic, builds edition N from N−1, runs the browser check, `lint.js` and a reviewer agent across the four levels, stages the edition in the app, and emails the editor a review | Cowork scheduled task (UTC cron: shift by hand at each clock change) | `kit/prompts/nightly-builder.md` |
| 03:00–04:00 | 01:00 | Cleanup: off-topic prompts older than 7 days, expired assistant sessions | Vercel cron `/api/jobs/nightly` | `src/lib/jobs.ts` `nightly()` |
| 07:30 | 04:30 / 05:30 | **Topic menu.** Emails the editor five candidates for tomorrow and records them | Cowork scheduled task (UTC cron) | `kit/prompts/topic-menu.md` |
| 11:00 | 08:00 / 09:00 | **Release routine.** Reads the editor's verdict in Gmail, mirrors the edition into `daily-wow-editions`, calls release, sends a Gmail copy per family | Claude Code routine with the content repo attached (local time) | `kit/prompts/release-routine.md` |
| 11:05 | 08:05 and 09:05 | Release the oldest **approved** edition; warn the editor if the queue is empty or low | Vercel cron `/api/jobs/release` | `src/lib/admin.ts` `releaseQueued()` |
| 11:10 | 08:10 and 09:10 | Send today's released edition to every family not yet sent (this is also the retry) | Vercel cron `/api/jobs/send-daily` | `src/lib/jobs.ts` `sendDaily()` |
| 19:00 | 16:00 and 17:00 | Streak-at-risk nudge (families opt in; off by default) | Vercel cron `/api/jobs/streak-risk` | `jobs.ts` `sendStreakRisk()` |
| 23:30 | 20:30 and 21:30 | Close the day: per-question statistics, every kid's progress, "rare success" notices | Vercel cron `/api/jobs/close-day` | `src/lib/gamification.ts` `closeDay()` |
| Sunday 18:00 | Sunday 15:00 and 16:00 | Weekly summary to parents | Vercel cron `/api/jobs/weekly` | `jobs.ts` `sendWeekly()` |

Some details behind the table:

- **Why each Vercel cron appears twice.** Vercel crons have no timezone. A local-time gate turns one of the two runs into a no-op (`send_time`, 11:05 by default, editable in `/admin`). Running twice is safe: every send is first "claimed" with a row in `sends`, and unique indexes stop duplicates.
- **Cron authentication.** Every cron needs `Bearer $CRON_SECRET`. Without it the crons return 503.
- **Retrying the daily send by hand.** Without `force`, a manual run re-sends only to families that have not received it:
  ```bash
  curl -H "Authorization: Bearer $CRON_SECRET" "https://rootsandwings-edu.com/api/jobs/send-daily?n=N"
  ```

### Two release paths

Today two mechanisms can release a lesson:

- **The release routine (repo prompts).** It releases the staged edition unless the editor replied HOLD. Silence counts as approval.
- **The 11:05 cron (app code since 2026-09-11).** It releases only editions the editor approved in `/admin`.

Which one is really in charge depends on the prompts actually running in claude.ai/code/routines and in the Cowork tasks, which may differ from the repo. Risks while both exist:

- If editions are approved in `/admin` **and** the routine also releases, two lessons go out the same day. `releaseEdition` has no same-day guard (`src/lib/admin.ts:178-199`).
- If the routine runs late, the cron sends a false "no lesson went out" alarm.

**Decision for the editors.** The app-side approval queue is the safer design: nothing reaches children without an explicit yes, and editions can be built days ahead. With two editors it is also the only path that works for both. The release routine reads only replies from `{{PARENT_EMAIL}}`, while `/admin` approvals count for both editors. Choosing it means:

1. The release routine stops calling `release` and only mirrors released editions to the content repo.
2. The builder stops assuming "today" and reads `revision_note` (the API has to return it first).
3. Add a same-day guard to `releaseEdition`.
4. Update `kit/prompts/*.md` so the repo copy matches what runs.

## The editor's normal day (about 15 minutes)

1. **Morning (optional).** Reply to the topic menu with a number or your own idea. No reply means the ★ default.
2. **Before 11:00.** Read the review email (link, all the answers, the password, the reviewer's verdict) or open `/admin/preview/N`. Then do one of:
   - approve in `/admin`, or reply "ok" (silence also counts with the repo prompts);
   - reply **HOLD**;
   - describe the changes you want.
3. **After 11:10.** Check the routine's "Released — mailed to X" reply and the **job runs** panel in `/admin`. Look in the details for `bad_address`, `no_link_token`, `send_failed` and `resend_daily_limit_warning`.
4. **Through the day.** Mail to hello@ and parents' replies arrive in the editor's inbox: family mail has reply-to set to `EDITOR_EMAIL`.

What `/admin` does:

- Editions table: preview, approve, hold, request changes, release now with a note, republish, and a test email to yourself.
- Off-topic assistant audit, with an alert above 10%.
- Families: search, grant free assistant until a date, edit name or email, delete.
- Roots/wings registries and a recompute-progress button.
- Topic menus and the parents' topic ideas.
- The last 20 job runs and the last 20 sends.
- Settings: caps, model, send time.

`/admin/analytics` has the funnel and the daily series.

## When something breaks

| Symptom | Likely cause | What to do |
|---|---|---|
| No review email in the morning; the routine says "nothing staged" | The builder failed. If its log shows `403` / `host_not_allowed`, the cloud environment's network access was changed | Fix the environment first. In claude.ai/code, open the cloud icon above the message box, then the environment's settings, then **Network access**. Allow `rootsandwings-edu.com`, `raw.githubusercontent.com` and `api.github.com`. Then **Run now** on the builder (its STEP 0 makes a same-day re-run safe), then release. The app itself looks healthy when this happens, so it is easy to misdiagnose |
| Builder ran, but no lesson went out | The routine's git push failed (it then refuses to release), or nothing was approved | Release from `/admin`, mirror to the content repo afterwards. **Never re-date an edition**: it resets every kid's streak |
| Some families did not get the mail | Failed sends release their own claims | The 11:10 run retries them, or run send-daily by hand (above). Use **Republish** only if everyone should get it again |
| A family's address bounces | Bad addresses are skipped one by one | Fix it in `/admin` → family → edit |
| Nobody got mail, but the job reports "sent" | `RESEND_API_KEY` missing: skipped mails are counted as sent | Restore the key in Vercel, redeploy, then Republish |
| Kids say "Arto doesn't answer" | Anthropic key missing or expired, or the kid hit the cap (3 a day free, 30 subscribed) | Check `/admin` integrations. Grant free assistant per kid if needed |
| HOLD pressed on an edition already out | `holdEdition` has no status check: the lesson is now offline | Release it again from `/admin` (fix tracked in [README](README.md#fix-first-ranked)) |
| Two editions went out the same day | Both release paths fired | See [two release paths](#two-release-paths) |

## Clock changes

- **Israel.** The clocks change at 02:00 on Sunday 25 October 2026 (back to UTC+2) and again in late March. On each change:
  - shift the two Cowork tasks by one hour;
  - the routine follows local time;
  - the Vercel crons are already paired.
- **A Paris deployment** needs its own pairs. See [localization.md](localization.md#time-and-schedules).

## Limits to watch as families grow

- **Resend.** The app's daily send limit is `RESEND_DAILY_LIMIT` (default 100). The admin warns at 80%. The limit counts families, but every recipient gets a separate copy, so the real mail count is higher. Magic-link sign-ins come out of the same quota.
- **Gmail.** The routine sends one Gmail copy per family from the editor's Gmail, so consumer Gmail's daily sending limit applies.
- **Gmail connector links (to check).** Another project on this account saw links in connector-sent mail rewritten to `google.com/url?q=…` redirects on 2026-10-13. Check a recent Gmail copy, because those mails carry each kid's personal link.
- **Supabase.** The free tier is fine for now. The README expects Pro at around 500 families.
- **Vercel.** Check the plan in the dashboard. The project has 11 crons, and the plan's cron limits and timing precision apply.
