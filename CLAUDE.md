@AGENTS.md

# Roots and Wings: brief for agents

Since October 2026 the owner and editor is an education specialist who drives Claude Code. He is not a developer. When he writes in French, answer in French. Explain in plain words what you will change and why before you change it, and say what to check afterwards. Raphael, who built the app, stays involved and reviews PRs.

Start with `docs/handoff/README.md`. It has the state of the project, the open issues ranked, and the reading order.

Rules:
- `main` is production: a push deploys https://rootsandwings-edu.com. Work on a branch, open a PR, and let the owner merge it.
- Never read or write the production database. Write the migration or the SQL, and hand it to the owner to run (`supabase db push`, or the Supabase SQL editor).
- The Hebrew service is live, with real families. Every change for French or English goes behind configuration, defaulting to today's Hebrew behaviour. Check that the Hebrew output is unchanged (`docs/handoff/localization.md`).
- Before saying "done", run `npm run typecheck` and `npm test`. Three known date-dependent failures are listed in `docs/handoff/technical.md`; anything else is yours. For a hand-edited edition, also run `npm run gate:edition -- <file>`.
- These repos are public. No real child's or parent's name or email, and no key, in code, editions, fixtures or commits. QA addresses are plus-addresses, and QA families are deleted afterwards.
- Never rotate `LINK_KEY`: every kid's link dies. Brand strings come from `APP.name` or i18n only.
- Prompt changes in `kit/prompts/` only take effect when they are pasted into the running scheduled task. Say so, and keep the two copies identical.
