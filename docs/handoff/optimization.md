# Optimization: what to measure, what to change

The honest picture on 2026-10-14:

- 42 families and 50 kids came in about five weeks, by word of mouth.
- Families keep receiving the lesson every day.
- Nobody pays yet.

With 50 kids, only large effects show up in the numbers. So the most useful tool for now is talking to five families. Experiments come second. Start by recording the [baseline](README.md#baseline-to-record-at-handover).

## What is measured today

| Signal | Stored in | Read it on |
|---|---|---|
| Funnel: `land`, `demo_start`, `demo_complete`, `signup`, `lesson_complete`, `subscribe` (first-party; the visitor hash rotates daily) | `events` (`src/lib/analytics.ts:10`) | `/admin/analytics` |
| Completions, scores, late completions | `completions` | `/admin`, the family panel |
| The explanation grade (stars) | `grades` | `/admin`, the kid's collection |
| Every answer the kid gives, **first try or not** | `item_events` → `item_stats` (computed nightly by close-day) | `/admin`, gamification: declared difficulty vs measured |
| Assistant use: scope tag, tokens, cost; off-topic prompts (kept 7 days) | `usage` | `/admin`, Arto panel |
| What was mailed to whom | `sends` | `/admin`, last sends |

**What is not measured, by design.** Email opens and clicks: the product has no trackers and no pixels. The closest substitute is item events from kids who started a lesson without finishing it.

**A suggested headline metric.** Weekly active kids (at least one completion in the week) divided by registered kids. Next to it, track the per-edition completion rate and how long families stay (30 days later, do their kids still complete lessons?).

## Levers: pedagogy

This is where an education specialist moves the product most. Almost all of it lives in prompts, not in code:

- the builder and its reviewer: `kit/prompts/nightly-builder.md:29-48`;
- topics: `kit/prompts/topic-menu.md`;
- the skills taxonomy: `kit/prompts/skills.md`;
- the tutor: `src/lib/arto.ts:107-169`.

1. **Accuracy.** Both the lessons and their reviewer are AI. The automated checks only cover form.
   - Lesson 1 states as fact something its own adults' footer calls "accepted but not certain" (the professional step-counters).
   - Date-bound sentences ("this week, a 15 cm shadow") stay in the permanent archive and become false later.
   - Fix: tighten the reviewer brief. Uncertainty must appear in the kids' text too, and nothing should be tied to the release date.
2. **Difficulty calibration.** `item_stats` gives the measured first-try rate of every question.
   - Compare it with the difficulty the builder declared.
   - Give the builder a target, e.g. 60–80% first-try at the standard level.
   - Tell it which question types the kids actually fail.
3. **Age fit.**
   - About 1,100 words per track, and most of the page is shared between ages 8 and 12.
   - There is no read-aloud: voice is input only. A "read this to me" button (speech synthesis in the engine) would help the support level and the younger track.
   - Edition 2 has one track only.
4. **Remembering.** The do-not-repeat rule means a topic is never revisited, so there is no retrieval practice. One "do you remember?" question from an earlier edition at the start of each lesson would add it at almost no cost. Journeys could build on it.
5. **Curriculum.** Editions are not linked to any curriculum. Tagging each one with the curriculum points it touches would help parents see the value and open a teachers' channel: the Israeli curriculum for the Hebrew service, the French *programmes* for cycles 2, 3 and 4.
6. **Assessment validity.**
   - The score is computed in the kid's browser, and the server accepts it.
   - The numeric tasks allow unlimited tries.
   - The younger numeric hint in edition 1 gives away the answer.
   - The explanation is graded by AI for subscribers and self-ticked for free kids once their 3 messages are used up, because grading costs one message.
   - The first-try data is the trustworthy measure. Base decisions on it.
7. **Motivation balance.** The reward layer is rich: roots, wings, medals, cards, about 30 badges, shields, journeys (see [the spec](../gamification-spec.md)). Its rules:
   - no leaderboards;
   - no guilt lines;
   - everything is derived from what the kid did.

   The "rare success" mail to parents is positive but comparative ("only 3 of 21 kids…"). How much extrinsic reward to keep is a pedagogical call. The four open questions in the spec's §15 are his to decide: the shield cap, a diamond medal for support-level kids, the 35% rarity threshold, and hero-card art.
8. **Equity.** Paying families get ten times more tutor (30 messages a day against 3). One cheap change: grading the kid's own explanation should not use up a message.

## Levers: product

All of these can be changed from `/admin` settings without a deploy, unless marked otherwise.

- **Send time.** The default is 11:05 (`send_time`). On a school day, kids are in class then. Test an earlier or later time against the completion rate.
- **Streak-at-risk nudge.** Opt-in and off by default. Test turning it on for new families. This one needs a code change.
- **Activation.** The demo lesson is the front door (`/`). Watch demo → sign-up in the funnel. The sign-up form asks for name, gender, age, grade and level for each kid.
- **Families' own topics.** Parents can suggest topics (`/admin`, topic ideas), and the menu agent reads them. Using them visibly ("today's topic was suggested by Noa's family") is free engagement.

## Levers: money

- **Nobody has subscribed.** The full path works: free cap → "ask my parents" email → sign-in → checkout → unlock. It passed QA on production on 2026-09-08 (`tests/e2e/qa-cap-to-pay-report.md`). Hypotheses to test, one at a time:
  - 3 free messages a day may be enough for most kids;
  - parents never see what Arto does: show one real exchange in the weekly email, with the parent's consent;
  - the price framing ("covering costs");
  - the merchant name shown on the checkout page, a Dodo account setting. Check it.
- **Costs are tiny.** Tokens cost ₪9.61 for all of September. The first cost steps come from scale, not from the assistant:
  - Resend, at about 80 families;
  - Supabase Pro, at about 500 families;
  - the Gmail copy, because of Gmail's sending limit.
- **Open books.** `/open-books` publishes cost and income monthly. Build cost and income overrides are only editable by SQL in `open_books`.

## How to run a change here

1. **One change at a time.** Write it down with its date in `tasks/experiments.md` (create it): what changed, why, and what you expect.
2. **Compare two weeks before and two weeks after** on `/admin/analytics`. Watch the headline metric plus the one the change targets.
3. **Prompt changes** (the builder, the reviewer, the tutor) apply from the next build. Keep the repo copy of each prompt identical to the running one ([README, issue 4](README.md#fix-first-ranked)).
4. **Rules changes in gamification** need a recompute (`/admin` → rebuild progress), because everything is derived.

## Engineering backlog (after the [fix-first list](README.md#fix-first-ranked))

- [ ] CI: a GitHub Action that runs `npm run typecheck` and `npm test` on every PR.
- [ ] Fix the 3 date-dependent unit tests ([technical.md](technical.md#tests)).
- [ ] Port the prompt renderer (`npm run prompts`) from the unmerged branch, so the running prompts are generated from the repo.
- [ ] Call `npm run gate:edition` from the builder prompt. The gate exists but no prompt uses it.
- [ ] `send-daily` stays silent when there is no edition today (`src/app/api/jobs/send-daily/route.ts`). It should alert the editor.
- [ ] QA bug B4: the implicit-flow landing on `/auth/cb` ignores `location.hash`.
- [ ] Give SQL-only settings an `/admin` control: `is_editor`, `open_books` build cost and income, the weekly editor line.
- [ ] Remove `supabase/.temp/` from git and ignore it. It holds no secrets, only the project ref and pooler host.
