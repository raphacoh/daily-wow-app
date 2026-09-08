# Prompts

The Daily Wow is run by an AI agent (Claude) on three schedules. Each schedule has one prompt here.
They are the exact prompts running in production, with the family-specific values replaced by placeholders.

| File | Runs | Where | What it does |
|---|---|---|---|
| [`setup-prompt.md`](setup-prompt.md) | once | a Claude **Cowork** session | The stand-alone bootstrap for running the kit **without the app**: builds edition #1 from the template, creates the dashboard, creates the scheduled tasks. Paste this first if you are self-hosting. Ignore it if you run against the app. |
| [`topic-menu.md`](topic-menu.md) | daily, morning | Cowork scheduled task | Emails the editor five topic candidates for tomorrow and records the menu in the app (`POST /api/admin/menus/{n}`). |
| [`nightly-builder.md`](nightly-builder.md) | daily, night | Cowork scheduled task | Picks the topic, builds a **family-agnostic** edition from the previous one, runs the browser check, `lint.js` and the reviewer agent across all four levels, stages it in the app (`POST /api/admin/editions`), and emails the editor a review. |
| [`release-routine.md`](release-routine.md) | daily, late morning | Claude Code **routine** with the content repo attached | Unless the editor replied HOLD, mirrors the edition into `daily-wow-editions` and calls `POST /api/admin/editions/{n}/release`. The **app** then mails every family. |

Why two different schedulers: Claude Code routines can have a GitHub repository attached and can push; Cowork tasks cannot. So the nightly task builds and stages through the app's API, and the routine does the git push and the release call.

**The app owns everything about families.** The three prompts above never read or write a child's name, streak, XP or email. They talk to one small signed API (`Authorization: Bearer {{EDITOR_API_KEY}}`) that gives them exactly what a builder needs — the do-not-repeat list, the topic menus, the parents' topic ideas — and takes back one staged edition. The old artifact "ledger" is gone; `setup-prompt.md` still describes it because the self-hosted kit path has no app and no database.

## Placeholders

| Placeholder | Example |
|---|---|
| `{{APP_URL}}` | `https://dailywow.example.com` — the app's base URL (no trailing slash). Editions live at `{{APP_URL}}/l/N`, the admin API under `{{APP_URL}}/api/admin/…`, the editor's page at `{{APP_URL}}/admin` |
| `{{EDITOR_API_KEY}}` | the app's `EDITOR_API_KEY` secret, sent as `Authorization: Bearer …` on every admin API call. Server-only — it never appears in a page, an email, or a repo |
| `{{SERIES_NAME}}` | `הוואו היומי`, `Le Waouh du jour`, `The Daily Wow` — the brand the kids see |
| `{{ASSISTANT_NAME}}` | the in-page assistant's character name, e.g. `ארטו` (a librarian from Alexandria) |
| `{{LANGUAGE}}` / `{{SPEECH_LOCALE}}` | `Hebrew` / `he-IL`, `French` / `fr-FR`, `English` / `en-GB` |
| `{{PARENT_LANGUAGE}}` | language of the emails to the editor |
| `{{PARENT_NAME}}` / `{{PARENT_EMAIL}}` | the editor — the one human in the loop |
| `{{CHALLENGE_WORD}}` | the word "Challenge" in the kids' language (heading of the chapter-5 challenge panel) |
| `{{TIMEZONE}}` | `Europe/Paris` |
| `{{HOME_COUNTRY}}` / `{{HOME_TOWN}}` | for local hooks (latitude, geology, history) |
| `{{GITHUB_USER}}` | your GitHub username; the public content repo is `{{GITHUB_USER}}/daily-wow-editions` |
| `{{MENU_TIME}}` / `{{BUILD_TIME}}` / `{{RELEASE_TIME}}` | `07:30` / `02:00` / `11:00` local |
| `{{HTML_LANG}}` / `{{HTML_DIR}}` | `he` / `rtl`, `fr` / `ltr` — the document language the app wraps the fragment in |

There are no kid placeholders any more. An edition is family-agnostic: `KIDS` keeps the template's two example kids (one per content track), `STATS` is zeros, and the app injects the real child through `window.RUNTIME` when it serves the page. A family changes a kid's level from their own dashboard; the edition already carries all four levels.

## The admin API in one screen

All of these need `Authorization: Bearer {{EDITOR_API_KEY}}` (or a signed-in editor session in a browser).

| Endpoint | Used by | What |
|---|---|---|
| `GET /api/admin/editions?limit=40` | menu, builder, release | recent editions in every status — `n, code, date, title, topics, summary, status, reviewer_verdict, review_url, released_at`. Never the fragment, never the password |
| `GET /api/admin/history` | menu, builder | every edition ever: titles + topics. The do-not-repeat list |
| `GET /api/admin/topics` | menu, builder | parents' unused topic ideas, first name only |
| `GET /api/admin/menus?limit=10` | builder | recent topic menus |
| `POST /api/admin/menus/{n}` | menu, builder | write the menu / record what was chosen |
| `POST /api/admin/editions` | builder | stage edition N: metadata + reviewer verdict + review URL + teaser + the fragment. Validates the fragment and refuses to overwrite a released edition |
| `POST /api/admin/editions/{n}/release` | release | promote to released and mail every family |
| `POST /api/admin/editions/{n}/hold` | release | the editor's HOLD |
| `POST /api/admin/editions/{n}/republish` | release | re-run the daily send for an edition already out |
