# Daily Wow editions (content)

One folder per edition: `e/NNN/edition.html` (the family-agnostic page fragment built on the kit engine — empty `KIDS`, runtime bootstrap present) and `e/NNN/meta.json` (n, code, date, title, topics, summary, reviewer verdict, sources, password). `editions.json` lists released editions, `topics.json` is the do-not-repeat list.

The release job pushes here; the app's release endpoint mirrors the fragment into its database. This folder is the seed for `github.com/raphacoh/daily-wow-editions` and doubles as the local store when the app runs without a database (`EDITIONS_DIR`).
