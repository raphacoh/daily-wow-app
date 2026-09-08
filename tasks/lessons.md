# Lessons

- 2026-09-08 — Brand copy must be one constant. The name "הוואו היומי" was hard-coded in ~10 files (engine, emails, routes, tests) and renaming needed a sweep. Rule: user-facing brand strings come from `APP.name` (config) or i18n; never inline them. Also: zsh does not word-split unquoted `$var` in `for f in $files` — use an explicit list or `${=files}`.
- 2026-09-08 — The user's instinct for the landing was "community, not commercial": no screenshots, no steps, no prices, one CTA. Default to the quietest version of a page and let the manifesto/FAQ carry the detail.
