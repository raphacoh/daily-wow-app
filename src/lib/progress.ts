/**
 * Progress rules — the same formulas the page engine uses, computed from data (PRD §2.2, §6.5).
 * Pure functions: no DB here, so they are unit-tested directly and reused by the page and the jobs.
 */

export const LEVELS: ReadonlyArray<readonly [number, string, string]> = [
  [0, "סקרן", "סקרנית"],
  [150, "חוקר צעיר", "חוקרת צעירה"],
  [400, "מגלה", "מגלה"],
  [800, "מדען", "מדענית"],
  [1500, "פרופסור", "פרופסורית"],
  [2500, "גאון", "גאונית"],
  [4000, "אגדה", "אגדה"],
];

export const STREAK_MILESTONES = [3, 7, 14, 30, 100] as const;

export const BADGES = {
  firstDay: "היום הראשון",
  noMistakes: "בלי טעויות",
  challenge: "האתגר",
  streak: (n: number) => `רצף ${n}`,
} as const;

export function levelFor(xp: number, feminine: boolean): { index: number; name: string; next: number | null } {
  let i = 0;
  LEVELS.forEach((l, k) => {
    if (xp >= l[0]) i = k;
  });
  const l = LEVELS[i];
  return { index: i, name: feminine ? l[2] : l[1], next: LEVELS[i + 1] ? LEVELS[i + 1][0] : null };
}

/** XP for one edition: score × 10 + 20 if complete + min(50, streak_after × 5) unless late. */
export function xpFor(score: number, complete: boolean, streakAfter: number, late: boolean): number {
  const base = Math.max(0, score) * 10;
  const done = complete ? 20 : 0;
  const bonus = complete && !late ? Math.min(50, streakAfter * 5) : 0;
  return base + done + bonus;
}

/**
 * Streak = consecutive released edition dates completed on time, walking back from the newest
 * edition dated ≤ today. Today's edition, while still open, neither counts nor breaks the streak.
 * Days without a released edition (a HOLD) do not break it either — the streak is over editions.
 *
 * @param releasedDates  YYYY-MM-DD dates of released editions (any order, duplicates ok)
 * @param onTimeDates    YYYY-MM-DD dates of editions this kid completed on their own day
 * @param today          YYYY-MM-DD in the kid's timezone
 */
export function computeStreak(releasedDates: Iterable<string>, onTimeDates: Iterable<string>, today: string): number {
  const done = new Set(onTimeDates);
  const dates = Array.from(new Set(releasedDates))
    .filter((d) => d <= today)
    .sort()
    .reverse();
  let i = 0;
  if (dates[0] === today && !done.has(today)) i = 1;
  let streak = 0;
  for (; i < dates.length; i++) {
    if (done.has(dates[i])) streak++;
    else break;
  }
  return streak;
}

export interface BadgeInput {
  complete: boolean;
  late: boolean;
  score: number;
  max: number;
  challenge: boolean;
  streakAfter: number;
  firstEverCompletion: boolean;
}

/** Badges earned by this completion (idempotent — the caller unions them into the kid's set). */
export function badgesFor(b: BadgeInput): string[] {
  const out: string[] = [];
  if (b.complete && !b.late && b.firstEverCompletion) out.push(BADGES.firstDay);
  if (b.score >= b.max && b.max > 0) out.push(BADGES.noMistakes);
  if (b.challenge) out.push(BADGES.challenge);
  if (b.complete && !b.late && (STREAK_MILESTONES as readonly number[]).includes(b.streakAfter)) out.push(BADGES.streak(b.streakAfter));
  return out;
}

/** YYYY-MM-DD for `at` in an IANA timezone. */
export function localDate(at: Date, timezone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(at);
  const g = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return `${g("year")}-${g("month")}-${g("day")}`;
}

/** Next local midnight (for `resets_at` in cap responses). */
export function nextLocalMidnight(at: Date, timezone: string): Date {
  const today = localDate(at, timezone);
  // Find the first instant whose local date is after today, by probing hour by hour from now.
  let t = new Date(at.getTime());
  for (let i = 0; i < 30; i++) {
    t = new Date(t.getTime() + 3600e3);
    if (localDate(t, timezone) > today) {
      // back off to the exact minute boundary
      const parts = new Intl.DateTimeFormat("en-GB", { timeZone: timezone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(t);
      const h = Number(parts.find((p) => p.type === "hour")?.value ?? 0);
      const m = Number(parts.find((p) => p.type === "minute")?.value ?? 0);
      return new Date(t.getTime() - (h * 60 + m) * 60e3 - t.getSeconds() * 1e3 - t.getMilliseconds());
    }
  }
  return t;
}
