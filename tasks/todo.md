# 2026-10-14 — handoff package for the new owner (Raphael's uncle, education specialist)

Decisions (Raphael, 2026-10-14): he drives Claude Code himself (not a developer); French guide for him, English docs in the repo; he also takes over the Hebrew service as editor.

The app and editions repos are **public**, so nothing account-specific or personal goes in the repo. Account details and the transfer checklist live in the private French guide (Claude Doc).

- [x] Survey: localization audit, operations inventory, product/pedagogy (3 read-only agents)
- [x] Spot-check the claims the docs will state as fact (hold on released, no same-day guard, privacy copy vs code, names in e/002, revision_note, Resend skip, FAQ levels)
- [x] Baseline: `tsc --noEmit` clean; `vitest` 211 pass / 3 fail (same date-dependent three as 2026-09-16)
- [x] `docs/handoff/README.md`: start here, state on 2026-10-14, reading order, generic handover checklist, ranked open issues
- [x] `docs/handoff/operations.md`: the daily run, the editor's day, failure playbook, DST
- [x] `docs/handoff/localization.md`: French then English, one deployment per language, phases and checklists
- [x] `docs/handoff/optimization.md`: metrics, levers (pedagogy, product, money), backlog
- [x] `docs/handoff/technical.md`: code map, local dev, tests, deploy, migrations, gotchas, open branches
- [x] `CLAUDE.md`: a short brief for the agents he will drive
- [x] Private French guide (Claude Doc): welcome, state, how it works, the editor's day, accounts to transfer, machine setup, 30/60/90 plan, French plan, first prompts
- [x] Verify: every relative link and `file:line` in docs/handoff resolves; no secrets or personal data in the repo docs

## Review
- Repo (English, public-safe): `docs/handoff/{README,operations,localization,optimization,technical}.md`, plus an agent brief in `CLAUDE.md`. Every relative link, anchor and `path:line` checked by script; the only unresolved paths are intentional (a glob, a file on the unmerged branch, a file to create). Scanned for keys, project ids and personal data: the one third-party email is no longer in the docs.
- Private French guide (Claude Doc, not in the repo; Raphael has the link). Covers the welcome, state, a flow diagram, the editor's day, urgent items, the account-by-account transfer, machine setup, Claude Code rules with first prompts, a 30/60/90 roadmap, the French plan and levers. Both diagrams were checked from screenshots.
- Not done: live usage numbers. Production reads were denied to the agent, so the baseline table is left for the editor to fill from /admin/analytics. Nothing committed.
