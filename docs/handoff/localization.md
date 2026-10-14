# Localization: French, then English

Today the service is Hebrew-only. A few hooks for other languages exist, but none of them is connected:

- `parents.locale`, which is never written;
- `editions.language`;
- a language filter on the daily send;
- a `locale` argument on `t()`, which no caller passes.

`src/i18n/en.json` covers the old landing page only and is never selected at runtime.

## The decision: one deployment per language, one codebase

Each language gets its own deployment, built from the same GitHub repo:

- its own Vercel project, domain and brand;
- its own Supabase project;
- its own Resend domain and Dodo product;
- its own content repo of editions;
- its own three scheduled agents;
- its own editor, who may be the same person.

The language comes from configuration. The Hebrew deployment keeps running on the same code, unchanged.

**Why this rather than one site with a language per family.** The code is already shaped this way:

- The kit's placeholders (`{{LANGUAGE}}`, `{{TIMEZONE}}`, `{{SERIES_NAME}}`, `{{APP_URL}}`, the editions repo) are set once per deployment.
- The editions table holds a single series, with one global numbering (`editions.n`) and one release per day.
- The library, the sitemap and the demo edition are not filtered by language.
- There is one editorial loop with one editor, and the Supabase auth email templates are per project.
- The crons are tuned to one timezone.

Making one deployment multi-language would mean splitting all of that by language. Separate deployments cost a second set of accounts and nothing more. Extracting the strings (Phase 0) does not rule out a multi-language site later.

## Phase 0: make the code language-neutral (Hebrew output stays byte-identical)

**Rule for the whole phase.** Before touching a file, capture what it renders in Hebrew: the emails, the pages, the assistant prompts. Save that as golden files in the tests. After the change, the Hebrew output must be identical. One PR per area, tests green each time.

### Configuration

- [ ] `APP.locale` (`he` | `fr` | `en`). `APP.dir` is derived from it. Also `APP.name`, `APP.currency`, `APP.price`, `APP.weekStart` and the social handle: all from env, with today's values as defaults (`src/lib/config.ts:58-77`). `priceIls` becomes `price` + `currency`.
- [ ] `t()` reads `APP.locale` (`src/i18n/index.ts:8`). Add a test that fails if `fr.json` or `en.json` is missing a key.
- [ ] Replace the 12 hard-coded `|| "Asia/Jerusalem"` fallbacks with `APP.timezone` (e.g. `src/lib/kids.ts:159`, `src/lib/arto.ts:45`, `src/lib/gamification.ts:661`).
- [ ] `<html lang dir>`, the Open Graph locale (`he_IL`) and the fonts come from `APP` (`src/app/layout.tsx`).
- [ ] The lesson page direction: `src/lib/lesson-page.ts:51` already maps `fr`/`en` to `ltr`. Keep that, and move it to `APP.dir`.

### Strings

About 700 lines of hard-coded Hebrew are spread over 42 files. Move them into the dictionaries. Do the files that families see first and the editor's admin last; the admin can stay Hebrew for a while.

| File | Hebrew lines | Note |
|---|---|---|
| `src/lib/emails.ts` | 116 | Does not use `t()` at all. Also hard-codes `lang="he" dir="rtl"`, `border-right`, "10 ₪", "11:00", "25 דקות" ("25 minutes") |
| `src/lib/gamification.ts` | 57 | Badge, medal and level names in masculine/feminine pairs |
| `src/app/privacy/page.tsx`, `terms/page.tsx` | 39 + 35 | Israeli law. Rewrite them; don't translate (see [Legal](#legal)) |
| `src/lib/arto.ts` | 30 | The whole assistant system prompt and grading prompt, plus "write calculations left to right" |
| `src/lib/lesson-page.ts`, `format.tsx`, `family.ts`, `progress.ts`, `roots.ts`, `wow-meta.ts` | 27, 15, 13, 11, 16, 12 | `roots.ts` maps Hebrew topic words to subjects. French needs its own alias table, editable in `/admin` |
| `src/app/manifesto`, `open`, `faq`, `unsubscribe` | 20, 13, 5, 8 | Copy, best rewritten by the editor rather than translated |
| `src/app/admin/page.tsx`, `admin/actions.ts`, `admin/analytics`, `src/lib/admin.ts` | 129, 25, 29, 43 | Editor-only. Do these last |
| `public/wow-runtime.js` | 55 | Keeps its own copies of the medal, root and wing names (lines 15-22). Have the server send them in `window.RUNTIME` instead |

### Grammar and grades

- **Gender.** Hebrew inflects almost everything addressed to a child. French inflects much less (prêt/prête, « tu es arrivé·e »), and English hardly at all. Keep the `feminine` flag and let each dictionary supply pairs where its language needs them. Gendered text goes through four different helpers today (`G()` in the engine and the runtime, `g` in `gamification.ts`, inline ternaries in `emails.ts` and `arto.ts`). Unify them while extracting. For English, consider making the gender question at sign-up optional.
- **Grades** are stored as Hebrew letters `ב…ח` (`src/lib/kids.ts:19`) and decide the content track. Give each locale its own grade table, using the same split:

  | Track | Israel | France | England / US |
  |---|---|---|---|
  | younger | ב–ד | CE1, CE2, CM1 | Years 3–5 / Grades 2–4 |
  | older | ה–ח | CM2, 6e, 5e, 4e | Years 6–9 / Grades 5–8 |

- **Weeks.** Weeks run Sunday to Saturday (`src/lib/gamification.ts:362-366`). In France they start on Monday.
- **Dates** are formatted with `he-IL` (`src/lib/format.tsx`). Format them with `APP.locale` instead.

## Phase 0b: the lesson engine and the kit

- [ ] **A French master edition.** `kit/template/edition-template.html` is the Hebrew, right-to-left master. The builder always starts from edition N−1, so a French series must start from a French #1, or Hebrew leaks in. The locale knobs are listed in `kit/template/README.md` ("Locale knobs"):
  - `dir`/`lang` on `#app`, `#chat` and `#gate`;
  - `toLocaleString('he-IL')`;
  - the two speech recognizers (`he-IL`);
  - "לאבא" ("to Dad");
  - the Israeli references (Tel Aviv, Eilat, noon at 12:30);
  - `GRADES_HE` and `LEVEL_HE`;
  - the assistant persona prompt;
  - about 310 lines of Hebrew.
- [ ] **`kit/template/lint.js`.**
  - Rule 1, `math-outside-span`, is an *error* whatever the page direction, so any bare "360 ÷ 7.2 = 50" fails a French edition. Make it apply only to right-to-left pages, or keep wrapping formulas, which is harmless.
  - Rule 2, `gendered-outside-g`, checks a list of Hebrew words. It needs a per-language list, or it should be off.
- [ ] **`kit/template/check.js`** clicks buttons by their Hebrew text and types a Hebrew explanation. Switch it to `data-` attributes so that one check works for every language.
- [ ] **The prompts.**
  - `kit/prompts/nightly-builder.md` still names Hebrew grade letters (ב–ד, ה–ח) in the reviewer's checklist. Make them placeholders.
  - `{{ASSISTANT_NAME}}` is documented but unused.
  - `{{SPEECH_LOCALE}}` is not connected to the engine.

## Phase 1: the French service

- [ ] **Brand, domain, social handle.** The name is the editor's call. "Roots" (subjects) and "wings" (thinking skills) are also gamification concepts, so a literal name like *Racines et Ailes* keeps the metaphor.
- [ ] **Supabase.** A new project in an EU region. Apply the migrations with `supabase db push`. Write the French auth email templates (`supabase/templates/`). Set the site URL and redirects (`supabase/config.toml`).
- [ ] **Vercel.** A new project from the same repo, with these env values:
  - `EDITOR_TIMEZONE=Europe/Paris` and the locale, brand and price;
  - its own `EMAIL_FROM`;
  - fresh `SESSION_SECRET`, `LINK_KEY`, `EDITOR_API_KEY` and `CRON_SECRET`, never copied from Hebrew;
  - `DEMO_EDITION_N=1`.
- [ ] **Resend.** Verify the new domain (DKIM, SPF, DMARC) and set up inbound forwarding (`/api/admin/resend-domain`).
- [ ] **Payments.** A EUR product in Dodo, with its webhook (`POST /api/admin/dodo-setup`). Dodo is the merchant of record and handles EU VAT. ₪10 is about €2.50; the price is the editor's decision.
- [ ] **Google sign-in.** Add the new domain's redirect URI and branding to the OAuth client.
- [ ] **Content repo.** A public repo for French editions, mirrored by the French release routine.
- [ ] **Edition #1, relocalized.** The Eratosthenes lesson already has a French twin story: Delambre and Méchain measured the Dunkirk–Barcelona meridian (1792–1798) to define the metre. It is the same idea, two centuries later, in France. Paris is at about 48.9° N.
- [ ] **The three agents for French.** `{{LANGUAGE}}=French`, `{{SPEECH_LOCALE}}=fr-FR`, `{{HTML_LANG}}=fr`, `{{HTML_DIR}}=ltr`, `{{TIMEZONE}}=Europe/Paris`, `{{HOME_COUNTRY}}=France`, `{{CHALLENGE_WORD}}=Défi`, plus the brand and the editor.
- [ ] **Legal** (see below).
- [ ] **Pilot.** Open the service to 5–10 French-speaking families first, and measure against the [baseline](README.md#baseline-to-record-at-handover).

### Time and schedules

The Vercel crons come from `vercel.json` in the repo, so every deployment of this repo shares them. The pairs are tuned for Israel (UTC+2/+3); Paris is UTC+1/+2.

**What breaks in a Paris winter with the current file.**

- The release runs at 08:05 and 09:05 UTC, which is 09:05 and 10:05 in Paris. Both fall before the 11:05 gate, so **nothing is ever released**.
- The 18:00 and 19:00 gates for the weekly summary and the streak nudge are never reached either.

**Fix.** Add one more run, an hour later, to each pair. The local-time gates turn the extra runs into no-ops in each deployment. Alternatively, run hourly with gates. Check the Vercel plan's cron limits first.

The Cowork tasks are separate per deployment, each with its own UTC cron.

### Legal

The current privacy and terms pages are written for Israeli law: the Privacy Protection Law of 1981 and Haifa courts. A French service needs pages written for GDPR and French law, **reviewed by a lawyer**. Points to settle:

- **Who is the data controller.** Which person or company?
- **Legal basis.** Contract or consent from the parent. The parent registers and the child never does; keep it that way.
- **Processors and transfers outside the EU:** Vercel, Supabase (EU region), Resend, Dodo, and Anthropic (US).
- **Retention periods,** parents' rights, and the right to complain to the CNIL.
- **Children's data.** The age of digital consent in France is 15.
- **The privacy page must match the code.** Fix [issue 2](README.md#fix-first-ranked) first: today it does not.

## Phase 2: English

Once Phase 0 exists, English is mostly content: `en.json`, an English master edition, the prompts, and the agents.

Decide the market first. UK or US changes:

- the grades, spelling and units;
- the currency and timezone;
- the law: UK GDPR in the UK; in the US, COPPA for under-13s, which requires verifiable parental consent. Parents already register, but a lawyer should confirm.

## Order of work and rough effort

These are estimates for an owner driving Claude Code, with Raphael reviewing the PRs:

| Phase | Work | Estimate |
|---|---|---|
| 0 | Config and dictionaries, by area: emails → kid-facing pages → assistant → gamification → admin | 2–3 weeks |
| 0b | French master edition, lint, check, prompts | about 1 week, with the editor writing the French |
| 1 | Accounts, legal, first editions, pilot | 2–4 weeks, mostly not code |
| 2 | English | 1–2 weeks after Phase 0 |

A native French speaker reviews every string a family sees. Machine translation is a first draft. The editor owns the voice that speaks to children.
