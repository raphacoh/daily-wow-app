# שורשים וכנפיים — Gamification spec (v1)

**Audience:** the coding agent that will build it, the editor, and (in §7) the nightly builder agent.
**Status:** implemented (P0–P2), September 2026. Builds on the app PRD v1 (§2.2, §6.5) and the current code.
**One-line goal:** every lesson a kid finishes should visibly grow something that is *about what they learned* (roots), something that is *about how they think* (wings), and something they *collect* (cards and medals), with a handful of badges that reward the moments worth rewarding: coming back, explaining well, solving what few kids solved.

---

## 0. The hard constraint, and the design that survives it

The lessons are not written by this codebase. An independent agent builds one edition a night from the previous edition as a template, and a release routine ships it. Three consequences drive every decision below:

1. **The server sees almost nothing today.** One POST per completion: `score, max, complete, late, challenge` (`src/app/api/kid/complete/route.ts`). No per-question results, no skill tags, no times. Edition metadata has `topics[]` (free Hebrew words) and `max_score`.
2. **The engine propagates by copying.** The builder keeps the engine byte-for-byte from edition N−1. A change made once to `kit/template/edition-template.html` and shipped in one edition reaches every later edition automatically. It never reaches earlier editions.
3. **The agent will drift.** Edition 2 already shipped with a legacy track id and would fail staging validation. Anything the agent must do by hand will sometimes be missing, wrong, or renamed. Gamification must degrade, never break.

So the system is built in **three tiers of signal quality**, each one working without the tier above it:

| Tier | Source | Available for | Powers |
|---|---|---|---|
| **0 — Outcome** | `completions` row + `editions.topics` + server-observed assistant/grade calls | every edition, past and future, unchanged | medals, roots (domains), streak shield, most badges, cards |
| **1 — Items** | per-item events the *engine* emits (`WOW.emit`), keyed by structural ids the template already has | every edition built after the template bump | wings (thinking skills), rarity badges, grit badges, quests |
| **2 — Meaning** | a small `WOW_META` literal the builder writes (domain weights, skill tags, difficulty, hero card) | editions where the builder did it right | skill map, better domain split, card flavour |

The client is untrusted, as today. Everything the kid sees as "earned" is decided server-side and **derived by replay** from stored facts, never from incremented counters (the existing rule from `src/lib/progress.ts`). A `rebuildProgress(kidId)` must reproduce every number from `completions`, `item_events`, `grades` and `usage`.

Two more principles:

- **No competition between children.** No leaderboards, no names, no ranks. Community numbers appear only as anonymous aggregates ("3 out of 21 kids") and only when at least 8 kids answered.
- **The password stays the ritual.** Nothing new appears above the vault on the results screen. Gamification lives below it and in the "my collection" drawer.

---

## 1. Vocabulary (kid-facing, Hebrew)

| Concept | Hebrew | What it is |
|---|---|---|
| Roots | שורשים | Knowledge domains: maths, physics, biology, chemistry, engineering, space, earth, history. Each is a tree that grows with domain XP. |
| Wings | כנפיים | Thinking skills observable from the *structure* of every lesson: predict, understand, sequence, calculate, explain, reason deeply, be curious. Each has a level and earns feathers. |
| Feathers | נוצות | Points on a wing. |
| Medal | מדליה | Per-edition result tier: bronze / silver / gold / diamond. Upgradeable by retrying. |
| Card | קלף | One collectible per edition: the story's hero and one fact. Earned by completing. |
| Badge (decoration) | עיטור | Permanent achievement. Some are hidden until earned. |
| Streak shield | מגן רצף | Earned every 7 days of streak, absorbs one missed day. |
| Journey | מסע | Three weekly goals generated from the kid's own data. |
| Level | דרגה | The existing XP levels (סקרן → אגדה). Unchanged. |

The brand already says it: roots are what you know, wings are how you think. The kid's collection page is titled **השורשים והכנפיים שלי**.

---

## 2. Roots — progress in the materials

### 2.1 Canonical domains

Eight roots, fixed in code (`src/lib/roots.ts`), each with an id, Hebrew name, colour and a tree glyph:

| id | Hebrew | Aliases seen in `topics[]` |
|---|---|---|
| `math` | מתמטיקה | מתמטיקה, חשבון, גאומטריה, מספרים |
| `physics` | פיזיקה | פיזיקה, אור, קול, כוחות, אנרגיה, חשמל |
| `chemistry` | כימיה | כימיה, חומרים, מולקולות |
| `biology` | ביולוגיה | ביולוגיה, טבע, בעלי חיים, צמחים, גוף האדם, רפואה |
| `engineering` | הנדסה וטכנולוגיה | הנדסה, טכנולוגיה, מכונות, המצאות, מחשבים, תקשורת |
| `space` | חלל | חלל, אסטרונומיה, כוכבים, ירח, שמש |
| `earth` | כדור הארץ | גאוגרפיה, גאולוגיה, מזג אוויר, אקלים, ים, הרי געש |
| `history` | היסטוריה ואנשים | היסטוריה, ארכאולוגיה, אנשים, תרבות |

Mapping is an alias table in code plus an editor-maintained override (§9). Unmapped topics contribute nothing and are listed on `/admin` for the editor to alias. The builder's own domain list (science, engineering, maths, biology, physics, space, history, geography) maps 1:1, so in practice nearly every topic lands.

### 2.2 Domain XP

Every XP award (the existing `xp_awarded`, formula unchanged) is **also** split across the edition's roots:

- Tier 2: by the weights in `WOW_META.roots` (e.g. `math:2, earth:2, history:1, space:1` → 33/33/17/17 %).
- Tier 0: equal split across the mapped `topics[]`.
- If nothing maps: the XP goes to no root (total XP is unaffected).

`root_xp[root] = Σ xp_awarded × share`, recomputed by replay. Rounded per edition with largest-remainder so shares sum exactly to `xp_awarded`.

### 2.3 Tree stages

Each root has 6 stages by domain XP: 0 זרע · 60 נבט · 200 שתיל · 500 עץ צעיר · 1000 עץ · 2000 עץ עתיק. Stage crossings are events (results screen: "שורש המתמטיקה גדל לשתיל"). With one edition ≈ 100–150 XP split over 3–4 roots, a root the kid meets twice a week reaches "שתיל" in about a month, "עץ" in a school year. Tune after real data; thresholds live in config.

### 2.4 Skills inside a root (Tier 2 only)

The builder tags each test item with a skill slug from an open vocabulary (§7.3). The server records `(kid, skill, first_try_correct)` per item. A skill shows on the root as a leaf: outline when touched, filled when **mastered** = first-try correct on ≥ 3 items across ≥ 2 different editions. This is the only place where content-specific learning is claimed, and it is claimed conservatively. Unknown slugs are accepted and queued for the editor to merge (§9).

---

## 3. Wings — progress in thinking skills, from structure alone

The template guarantees the same item kinds in every edition. The engine emits them with structural ids, so wings need nothing from the builder.

| Wing | Hebrew | Fed by |
|---|---|---|
| `predict` | ניבוי | the hero "predict first" control (guess within 15 % → strong, within 50 % → weak) |
| `understand` | הבנה | quick-checks and MCQs |
| `sequence` | סדר | the tap-to-order task |
| `calculate` | חישוב | the numeric task (standard or advanced twin) |
| `explain` | הסבר | explain-it-back stars (AI-graded counts fully; self-check rubric counts half) |
| `reason` | חשיבה עמוקה | the challenge panel (`checkChallenge`), any level |
| `curious` | סקרנות | assistant questions with scope `lesson`/`adjacent` (server-observed in `usage`), opening the bonus, opening the sources |

**Feathers per item:** first-try correct 3 · correct after retry 2 · attempted 1 · explain: stars × 1 (AI) or ×0.5 (rubric) · challenge solved 5 · each in-scope assistant question 1 (max 3 per edition) · bonus opened 1 · sources opened 1.

**Wing levels** 1–10 with triangular thresholds (10, 30, 60, 100, 150, 210, 280, 360, 450 feathers). Level-ups are events. The wing view is a radar with 7 axes; a kid sees at a glance that "חישוב" lags "הבנה" and the weekly journey (§6) nudges the weakest wing.

Wings are deliberately *not* comparable across kids and never shown to other families.

---

## 4. Medals and cards — the per-edition reward

### 4.1 Medals (derived from the completion row and `grades`)

| Medal | Rule | Note |
|---|---|---|
| ארד | `complete` | any time, including late from the library |
| כסף | `complete` and `score ≥ 70 %` | |
| זהב | `complete` and `score ≥ 90 %` and explain stars = 3 | rubric stars accepted (the score is self-reported too) |
| יהלום | זהב and `challenge` | a standard-level kid who opens the optional challenge can get it |

Every completion also lands in `progress.results` — the kid's report card, one row per edition they answered, medal or not, with score, percent, explain stars, late flag and completion flag. A day left half-done still has a grade, and that grade is what kids come back to look for: it is shown in the drawer ("הציונים שלי"), next to every edition in the library, and in the lesson's header bar for the edition being read.

Medals upgrade on any later attempt (`recordCompletion` already handles `improved`). The results screen always states the next rung: "עוד שאלה אחת נכונה לכסף" / "פתרו את האתגר ליהלום". This is the retry loop: the app already accepts re-submissions, but nothing invites them today.

### 4.2 Cards

Completing an edition (bronze or better) earns its card: title, hero, one fact, date, root colours, medal foil, and the grade behind the medal (`score`/`max`). Tier 2 supplies `hero` and `fact`; Tier 0 falls back to `title` + `summary`'s Hebrew teaser first sentence. The album is a grid, newest first, with a **"missing card"** silhouette for every released edition the kid has not completed, deep-linked to `/l/N?k=…` (late completion allowed, XP but no streak, exactly as today). The album turns the library into a collection.

Foil: bronze plain · silver sheen · gold foil · diamond animated foil (CSS only, honours `prefers-reduced-motion`).

---

## 5. Badges (עיטורים)

Rules: every badge is a pure function of stored facts; idempotent; carries `earned_at` and `edition_n`; masculine/feminine forms where the word is an adjective. Hidden badges show as a silhouette with "?" until earned. Existing four persisted badges stay and keep their names. Glyphs are single characters in the existing `.dot` style (no emoji in running text).

### 5.1 Rhythm

| Badge | Rule | Hidden |
|---|---|---|
| היום הראשון | existing | |
| רצף 3 / 7 / 14 / 30 / 100 | existing | |
| רצף 50 / 200 / 365 | new milestones | |
| חזרתי | on-time completion after ≥ 5 consecutive missed editions | |
| שבוע מלא | every released edition of a Sun–Sat week completed on time | |
| חודש מלא | every edition of a calendar month completed (late allowed) | ✓ |
| שעת הבוקר | completed within 2 h of release, 5 times | ✓ |

### 5.2 Mastery

| Badge | Rule | Hidden |
|---|---|---|
| בלי טעויות | existing (`score = max`) | |
| המורה / המורָה | explain stars = 3, AI-graded (server-observed in `grades`) | |
| מורה ותיק/ה | 10 × three-star explanations | |
| חמישה זהב | 5 gold medals | |
| יהלום ראשון | first diamond | |
| האתגר | existing | |
| אתגר ×10 | 10 challenges solved | |
| מעבר לרמה | challenge solved by a kid whose level is not `advanced` | |

### 5.3 Rare success (the "not everyone got this" badges, Tier 1)

Computed by the nightly close job (§8.4), not at completion time, because rarity needs the community's answers first.

| Badge | Rule | Hidden |
|---|---|---|
| מעטים הצליחו | first-try correct on an item whose community first-try rate is ≤ 35 % (n ≥ 8) | |
| השאלה הקשה של השבוע | first-try correct on the week's hardest item (lowest rate, n ≥ 8) | |
| מסננת דקה | 5 × מעטים הצליחו | ✓ |

Awards arrive as a notice on the kid's next results screen and in the parent's weekly email: "אתמול רק 3 מתוך 21 ילדים פתרו את שאלת החישוב — עדן ביניהם". If the community is too small (n < 8) the badge is not awarded and nothing is said; this is not a bug, it is the privacy rule.

### 5.4 Grit and curiosity (Tier 1 / server-observed)

| Badge | Rule | Hidden |
|---|---|---|
| ניסיון שני | wrong on first try, right on a later try, on 3 items in one edition | |
| לא ויתרתי | completed with ≥ 5 retries across items | ✓ |
| בלי רמזים | completed with zero assistant calls during the test steps (7–8) | ✓ |
| שואל/ת שאלות | 3 in-scope assistant questions in one edition | |
| ספרן/ית של אלכסנדריה | 50 in-scope assistant questions lifetime | ✓ |
| אחרי הפעמון | opened the bonus and the sources in the same edition | |
| מן הספרייה | completed an edition from the library that was released ≥ 7 days earlier | |

### 5.5 Roots and wings milestones

| Badge | Rule |
|---|---|
| `<root>` — שתיל / עץ / עץ עתיק | per-root stage badges (24 badges, one family) |
| שורשים רחבים | all 8 roots at least נבט |
| כנף מלאה — `<wing>` | any wing at level 10 |
| שבע כנפיים | every wing at level ≥ 3 |

### 5.6 Streak shield

Earned at every multiple of 7 in the streak; a kid holds at most 2. Consumed automatically, oldest first, by the first missed released edition. Derived in `computeStreak` by replaying released dates chronologically with a shield counter, so it is as tamper-proof as the streak itself. The results screen and the parent dashboard show shields as small icons next to the flame; consuming one says "המגן שמר על הרצף". Pause (`kid.paused`) continues to freeze the streak and does not consume shields.

---

## 6. Journeys — weekly goals

Every Sunday 00:00 (kid timezone) the app generates three goals for the week from rules, not from the agent:

1. **Rhythm:** "לסיים 4 גיליונות השבוע" (count adapts: 3 if the kid averaged ≤ 2 in the last fortnight, 5 if ≥ 4).
2. **Wing:** targets the weakest wing with an attainable step: "לפתור נכון 2 שאלות חישוב", "להסביר עם 3 כוכבים פעם אחת", "לנחש בתוך 50 % פעמיים".
3. **Root:** "להצמיח את השורש של נושא היום 3 פעמים" (root-agnostic phrasing, because the app cannot know next week's topics).

Completing all three: the "מסע מושלם" badge and ribbon on the weekly card. **Decision (2026-09-08):** no XP for journeys — XP keeps a single source, completions, so every number stays rebuildable from facts. Journeys are a `journeys` row with `goals jsonb` and are re-evaluated by replay; a goal never shows a countdown or a guilt line.

---

## 7. The content contract — what the builder must do

Everything in §2–§6 works at Tier 0 with the builder untouched. Two additions raise the tiers. Both go into `kit/prompts/nightly-builder.md` Step 3 and into the kit README.

### 7.1 Engine hooks (done once by us, then copied forward)

`kit/template/edition-template.html` gets a 30-line telemetry shim and calls at the eight decision points. The shim is defensive: `window.WOW` is provided by the app (§8.1); if absent, every call is a no-op, so the fragment still works on the kit's static site.

```js
const WOW = (typeof window!=='undefined' && window.WOW) || { emit(){}, mount(){} };
// hero predict:      WOW.emit('predict', { id:'predict', value:S.guess, target:40075 })
// quick-check:       WOW.emit('item', { id:'qc:'+key, kind:'quick', correct, attempt })
// MCQ:               WOW.emit('item', { id:'mcq:'+track+':'+i, kind:'mcq', correct, attempt })
// order:             WOW.emit('item', { id:'order', kind:'order', correct: pts===2, partial: pts, attempt })
// numeric:           WOW.emit('item', { id:'num:'+t, kind:'num', correct, attempt })
// challenge:         WOW.emit('item', { id:'challenge', kind:'challenge', correct, attempt })
// explain:           WOW.emit('item', { id:'explain', kind:'explain', stars, graded:'ai'|'rubric' })
// bonus / sources:   WOW.emit('open', { id:'bonus' | 'sources' })
// results screen:    <div data-wow="progress"></div> under #badges — WOW.mount() renders into it
```

Item ids are **structural** (they exist in every edition by the template rules), so Tier 1 needs no content knowledge. `attempt` is the 1-based try count the engine already tracks implicitly (MCQ feedback per option, numeric retry); the shim counts it.

The prompt line added: *"Keep the `WOW` shim and every `WOW.emit(...)` call byte-for-byte; they are part of the engine."* Same treatment as `PX`, `AI`, the runtime bootstrap.

### 7.2 `WOW_META` (the builder writes this, per edition)

A JS literal next to `LESSON_CONTEXT`, extracted at staging by the same text-scrape as `extractAssistantContext()`:

```js
const WOW_META = {
  v: 1,
  roots: [ { id:'math', w:2 }, { id:'earth', w:2 }, { id:'history', w:1 }, { id:'space', w:1 } ],
  hero: { name:'ארטוסתנס', fact:'מדד את היקף כדור הארץ עם מקל, צל ומספר אחד' },
  items: {
    'predict':          { skill:'estimation',        d:1 },
    'qc:qc2':           { skill:'shadow-angles',     d:1 },
    'mcq:shared:0':     { skill:'proportion',        d:2 },
    'mcq:shared:1':     { skill:'circle-geometry',   d:2 },
    'mcq:shared:2':     { skill:'scientific-method', d:2 },
    'mcq:younger:0':    { skill:'shadow-angles',     d:1 },
    'mcq:older:0':      { skill:'proportion',        d:3 },
    'order':            { skill:'method-steps',      d:2 },
    'num:younger':      { skill:'proportion',        d:2 },
    'num:older':        { skill:'proportion',        d:3 },
    'num:adv':          { skill:'circle-geometry',   d:4 },
    'challenge':        { skill:'percent-error',     d:5 },
    'explain':          { skill:'explaining-mechanism', d:3 }
  }
};
```

- `roots[].id` must be one of the eight ids; `w` is a small integer. Unknown ids are dropped with a staging warning; if none survive, Tier 0 mapping from `topics[]` applies.
- `items` keys are the structural ids of §7.1. Unknown keys are ignored; missing keys get `skill:null` and a default difficulty by kind (`quick 1, mcq 2, order 2, num 2, adv 4, challenge 5, explain 3`).
- `d` (1–5) is the builder's *declared* difficulty. It is a prior for the rarity job when the community is small and a display hint ("שאלה קשה"), never the ground truth.
- `hero.fact` ≤ 90 characters, no emoji, math in `<span class="math">` if any.

Staging (`validateFragment`) treats `WOW_META` as **recommended**: absent or malformed → the edition is accepted with a `warnings[]` entry in the 201 response and a line on `/admin`. The builder prompt tells the agent to fix warnings before emailing the review. This is the drift-tolerant stance: a night the agent forgets, the kids still get a full lesson and Tier 0/1 rewards.

### 7.3 Skill vocabulary

`kit/prompts/skills.md` lists ~40 canonical slugs grouped by root (estimation, proportion, percent-error, unit-conversion, angles, circle-geometry, rates-and-speed, scale-models, scientific-method, method-steps, cause-and-effect, energy-transfer, forces, light-and-shadow, sound-waves, cells, adaptation, ecosystems, communication-in-animals, materials, reactions, orbits, phases, gravity, plate-tectonics, weather, maps-and-coordinates, timelines, sources-and-evidence, explaining-mechanism, …). The builder picks from the list and **may invent a new slug** when nothing fits; new slugs are accepted, flagged on `/admin`, and can be merged into a canonical one (§9). Slugs are lowercase kebab-case ASCII; Hebrew display names live in the registry.

### 7.4 Rolling out an engine change

Because the builder copies edition N−1, a template change ships like this:

1. Edit `kit/template/edition-template.html`, run `lint.js`, `check.js`, `tests/e2e/smoke-edition.mjs`.
2. Bump `ENGINE_VERSION` inside the template (a constant the staging validator reads and stores on `editions.engine_version`).
3. The editor tells the builder once, via the topic-menu reply or a one-line prompt edit: *"tonight, start from the kit template, not from edition N−1"*. Alternatively the release routine applies the engine diff as a patch. The former is simpler and matches how edition 1 was made.
4. From then on every edition carries the new engine. `/admin` shows the engine version per edition, so drift is visible.

Old editions keep their old engine. The app-served runtime (§8.1) still renders the collection UI on them by mounting after `#badges` when `[data-wow=progress]` is missing, and Tier 0 rewards apply to them fully.

---

## 8. App side

### 8.1 The app-served runtime `wow-runtime.js`

Today `src/lib/lesson-page.ts` prepends `window.RUNTIME = {…}` before the fragment. It will also prepend `<script src="/wow-runtime.js?v=<hash>">`. The runtime owns everything gamification-related on the client, so it updates on every deploy without touching any edition:

- `WOW.emit(type, payload)`: buffers events, batches them (every 10 events, on step change, on `finish`, on `visibilitychange`), POSTs to `/api/kid/events`, queues offline in `localStorage['wow-eq']` next to the existing completion queue. Demo mode (no `kidToken`): events stay local and drive a preview only.
- `WOW.mount()`: renders the progress block on the results screen from the server's `progress` object returned by `/api/kid/complete` (falls back to the local preview when offline). Order, top to bottom: today's medal and next rung → roots that grew (chips with +XP, stage-up animation) → feathers by wing → today's card flip → notices ("מאתמול: מעטים הצליחו") → journey progress → button "השורשים והכנפיים שלי".
- The drawer "השורשים והכנפיים שלי" (full-screen sheet inside the lesson page, since a kid never leaves the lesson page): grove of 8 trees, wings radar, medal shelf with retry links, card album with missing-card silhouettes, badge case with hidden silhouettes, this week's journey. Data from `GET /api/kid/progress?k=…`.
- Also mounted on the hero step as a one-line strip ("רצף 4 · מגן 1 · היום: קלף חדש מחכה") so the reward is visible before the work, not only after.
- A **header bar** inside the edition's own sticky top bar (`.wow-hdr`): streak, shield, cards, badges, and this edition's grade when there is one, all in chips, the whole row a button that opens the drawer. A kid who never opens a menu still sees that a collection exists — the strip only appears on the hero step, and the drawer only if you go looking for it.
- **Resume** (see §8.7): the lesson survives leaving the page.

### 8.2 API

| Endpoint | Body / result |
|---|---|
| `POST /api/kid/events` | `{ token, edition_n, events:[{ id, kind, correct?, partial?, attempt?, stars?, graded?, value?, target?, at }] }` → `{ ok, accepted }`. Max 200 events per (kid, edition); first attempt per item is immutable once stored; later attempts append. Rejects unreleased editions, paused kids. Accepts late. |
| `POST /api/kid/complete` | unchanged input; response gains `progress: { medal, medal_next, roots_delta[], feathers_delta[], card, notices[], journey, shields, new_badges[] }`. |
| `GET /api/kid/progress` | full collection for the drawer and the dashboard. |
| `POST /api/arto/grade` | unchanged for the page; the server now writes a `grades` row `(kid_id, edition_n, stars, at)`. |
| `GET /api/admin/gamification` | unmapped topics, unknown skills, engine versions, item stats per edition, rarity awards of the last 7 days. |

### 8.3 Schema (additive migration)

```
item_events   id, kid_id, edition_n, item_id text, kind text, attempt int, correct bool null,
              partial int null, stars int null, graded text null, value numeric null, at timestamptz,
              unique(kid_id, edition_n, item_id, attempt)
grades        kid_id, edition_n, stars int, at            -- from /api/arto/grade, server truth
item_stats    edition_n, item_id, n int, first_try_correct int, declared_d int, computed_at
              -- rebuilt by the close job; rarity reads this
skills        slug pk, root text, name_he text, canonical_slug text null (merge target), created_by text
kid_progress  kid_id pk, root_xp jsonb, root_stage jsonb, wings jsonb, feathers jsonb, medals jsonb,
              cards int[], badges jsonb ({name, earned_at, edition_n}), shields int, journey jsonb,
              engine_seen text, updated_at                 -- derived cache, rebuildable
journeys      id, kid_id, week_start date, goals jsonb, done bool, unique(kid_id, week_start)
kid_notices   id, kid_id, kind, payload jsonb, created_at, shown_at null
editions      + wow_meta jsonb null, engine_version text null
```

`kid_stats.badges text[]` stays for backward compatibility (dashboard, weekly mail) and is a projection of `kid_progress.badges`.

### 8.4 Jobs

- **On completion** (in the `recordCompletion` transaction): recompute medal, roots, wings, badges of §5.1/5.2/5.4/5.5, shields, journey; write `kid_progress`; return `progress`.
- **Daily close** (`/api/jobs/close-day`, 23:30 kid timezone, after the existing streak-risk job): rebuild `item_stats` for editions dated today and yesterday; award §5.3 rarity badges; write `kid_notices`; refresh journeys.
- **Weekly** (Sunday 00:05): generate next journeys; the existing weekly email adds the week's medals, new cards, badges and the hardest question line.
- **Rebuild** (`POST /api/admin/rebuild-progress`, and on every deploy that changes a rule): replay everything for every kid. Must be idempotent and finish in under a minute for 1,000 kids.

### 8.5 Trust and abuse

Same posture as today, stated plainly: the score is self-reported, so medals and wings are as honest as the kid. Server-observed facts (grade stars, assistant scope, timestamps, community rates) anchor the badges that make claims about others (rarity) or cost money (assistant). Limits: 200 events per (kid, edition), 20 completions per kid per day, events only for released editions. No XP is ever computed client-side for storage.

### 8.6 Privacy

New data about a child: per-item correctness, attempts, timestamps, skills, assistant question counts (already kept). No free text beyond what exists. All of it is exported by `/home/export` and deleted with the account. Aggregates across kids are computed only with n ≥ 8 and never expose a name. Add one line to `/privacy`.

### 8.7 Resume — leaving the lesson does not cost the work

A lesson is 25 minutes on one page. A kid who taps a link, switches apps, or lets the phone sleep comes back to a reload, and the engine's state (`S`) starts empty: the answers, the feedback and the position in the lesson are gone.

The engine rebuilds its own DOM from its own handlers (`renderQ`, `buildOrder`, `buildTest` and friends attach `onclick` **properties**), so a serialized copy of the page cannot be restored — the buttons would come back dead. The runtime therefore records **what the kid did**, not what the page looked like:

- Every click on a `button` / `summary` / `[onclick]` inside the lesson, as a selector anchored on an id or on the lesson root and built from the stable attributes the engine already uses (`data-i`, `data-id`, `data-n`, `data-pick`, `data-wow`), so a reshuffled ordering task still resolves.
- Every field value (`input` / `change`), the field keeping its place in the sequence while only its value moves.
- Never the assistant, the menus, the entrance gate, or the runtime's own chrome: replaying a question to ארטו would spend the day's quota on words the kid already read.

Stored in `localStorage['wow-resume:<edition code>:<token prefix>']` for 30 days (older keys are swept on load). On the next load, once the engine has booted (the profile has arrived and the start button is live), the gestures are replayed against the live page, one per tick, waiting up to five seconds in total for a target that an `await` has not written yet. The handlers produce exactly what they produced the first time — the same feedback, the same score, the same canvases — and none of this knows what any particular edition looks like.

Three things a resume must never do, and does not:

- **Count an answer twice.** `WOW.emit` is muted for the duration (`toast` too), so nothing reaches `/api/kid/events`. The completion POST is left alone: it is idempotent per (kid, edition), and it is what brings the day's password back into the vault.
- **Spend the day's ארטו questions.** Grading the explain-it-back answer consumes an allowance unit, so the successful grade is saved with the log and served back from the runtime's own `fetch` wrapper during a replay. With none saved, the replayed call fails softly and the page falls back to its own self-check rubric — which is what the kid saw the first time anyway.
- **Bounce.** The edition's own "להתחיל מחדש" button reloads the page; recording it would make every load restart for ever. A click whose `onclick` reloads or navigates clears the log instead of joining it, and `window.restart` is wrapped so the log goes wherever the engine's own key goes.

A note offers "להתחיל מחדש" of its own, which clears both.

---

## 9. Editor tools (`/admin`)

- **Aliases:** unmapped `topics[]` words with a one-click "map to root" → `root_aliases` table; the mapping applies retroactively on rebuild.
- **Skills registry:** unknown slugs from `WOW_META`, merge into canonical, set Hebrew name.
- **Per edition:** engine version, `WOW_META` warnings, item table with declared vs computed difficulty (n, first-try rate) — the editor learns which questions are too hard or too easy and can feed that into the topic-menu reply.
- **Rarity log:** who earned "מעטים הצליחו" yesterday (first names, editor only).

---

## 10. Parent dashboard and emails

- **Kid card on `/home`:** adds the medal shelf (last 14 editions as small medals, tap to open the edition for a retry), the grove in miniature, and the badge case. Wings are shown as a radar with the one-line explanation "כנפיים = איך הילד/ה חושב/ת, לא ציון".
- **Completion notice:** "✓ עדן סיימה #12 — 9/11, כסף · רצף 4" and the password, as today.
- **Weekly summary:** medals of the week, new cards, badges, the roots that grew, the hardest question of the week and whether the kid got it, next week's journey. One line from the editor as today.
- **Never:** a comparison with another child, a "your kid is behind" line, or a countdown.

---

## 11. Copy and rendering rules (inherit the engine's)

Hebrew first, warm, plural or `G('masc','fem')` for every second-person string; badge names that are adjectives carry both forms; every number in `.num`, every expression in `<span class="math">`; no emoji in running text (glyphs only inside `.dot`); animations are CSS, short, and off under `prefers-reduced-motion`; contrast holds in both themes. All strings live in `src/i18n/he.json` (and `en.json`), never inline — the brand-string lesson from `tasks/lessons.md`.

---

## 12. Phasing

**P0 — Tier 0, no builder change (1 week).** `wow-runtime.js` injection; `grades` capture; roots from `topics[]`; medals; cards from title/summary; streak shields; badges §5.1, §5.2 (except challenge count variants needing events), §5.5; dashboard and weekly email; rebuild job; backfill by replay so every existing completion gets its medal and card on day one. *Done when:* a kid who completed editions 1 and 2 opens edition 3 and sees two cards, two medals, roots for the four topics, and a shield count of 0, with no change to any edition file.

**P1 — Tier 1 (1–2 weeks).** Engine shim and emits in the kit template; `ENGINE_VERSION`; `/api/kid/events`; wings; grit and curiosity badges; daily close job; rarity badges and notices; journeys. Template rollout per §7.4. *Done when:* an edition built by the nightly agent from the new template emits events end to end, and the rarity job on a seeded community of 20 kids awards "מעטים הצליחו" to exactly the kids whose first try was right on an item with rate ≤ 35 %.

**P2 — Tier 2 (1 week).** `WOW_META` extraction, validation warnings, `skills.md`, skill leaves and mastery, editor registry, hero cards. Builder prompt updated. *Done when:* two consecutive nightly editions stage without `WOW_META` warnings and the skill map shows a mastered leaf after three first-try successes on the same slug.

---

## 13. Tests

- Unit (vitest on PGlite): every derivation is a pure function with table tests; `rebuildProgress` reproduces `kid_progress` byte-for-byte from facts; shields replay (earn at 7, consume on the first gap, cap 2, pause does not consume); medal thresholds and upgrades; root split sums to `xp_awarded`; journeys generation for the three kid profiles (light, regular, heavy).
- API: events dedupe on `(kid, edition, item, attempt)`; cap 200; rejects unreleased; late accepted; `progress` in the completion response.
- E2E (Playwright): edition 1 (new engine) and edition 2 (legacy engine, single track) both reach the vault, the progress block renders on both, the drawer opens; demo mode shows a preview and stores nothing; reduced-motion disables the card flip.
- Content-agnostic smoke (`tests/e2e/smoke-edition.mjs`): asserts the `WOW` shim is present and each structural emit fires at least once, so the reviewer agent catches a builder that dropped a call.

---

## 14. Success measures (open-books style, on `/admin`)

Weekly: on-time completion rate; share of completions that are retries (`improved`); challenge take-up among non-advanced kids; three-star explanation rate (AI-graded); late completions from the library; median time-on-task; share of editions staged with `WOW_META` warnings. The bet: medals and cards lift retries and library completions, wings and journeys lift the challenge take-up, rarity badges lift the three-star rate. If a number does not move in a month, cut the mechanic; the spec is a menu, not a monument.

---

## 15. Open questions for the editor

1. Streak shields: keep at max 2, or 1? (2 is kinder; 1 keeps the streak meaningful.)
2. Should a diamond medal require the challenge for `support`-level kids, who never see it? Proposal: for `support`, gold counts as the top medal and the shelf says so.
3. Rarity threshold 35 % with n ≥ 8: with ~20 families this awards a few badges a week. Raise to 40 % if it is too quiet after a month.
4. Should hero cards be drawn (an SVG emblem by the builder) or typographic? Proposal: typographic in P2, emblem later if the builder proves reliable.
