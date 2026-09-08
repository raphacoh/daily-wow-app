/**
 * Gamification (docs/gamification-spec.md, P0 = Tier 0): roots, medals, cards, badges, shields — all derived
 * by replay from facts the server holds (completions, grades, assistant usage, released editions). Nothing
 * here is a counter; `rebuildProgress()` reproduces the whole document at any time.
 *
 * `deriveProgress()` is pure so the rules are unit-tested directly; `loadFacts()` reads the database.
 */
import { db, type Queryable } from "./db";
import { computeStreakDetail, localDate } from "./progress";
import { ROOT_IDS, rootStage, rootWeightsFor, splitXp, type RootAliases, type RootId } from "./roots";

/* ---------- vocabulary ---------- */

export type Medal = "bronze" | "silver" | "gold" | "diamond";
export const MEDAL_NAMES: Record<Medal, string> = { bronze: "ארד", silver: "כסף", gold: "זהב", diamond: "יהלום" };
const MEDAL_RANK: Record<Medal, number> = { bronze: 1, silver: 2, gold: 3, diamond: 4 };

export type BadgeFamily = "rhythm" | "mastery" | "curiosity" | "roots" | "grit" | "wings";
export interface BadgeDef {
  /** [masculine, feminine] */
  name: readonly [string, string];
  glyph: string;
  family: BadgeFamily;
  hidden?: boolean;
  /** one line for the badge case */
  hint: string;
}

const STREAKS = [3, 7, 14, 30, 50, 100, 200, 365] as const;

/* ---------- wings (כנפיים): thinking skills read from the lesson's structure alone (spec §3) ---------- */
export const WING_IDS = ["predict", "understand", "sequence", "calculate", "explain", "reason", "curious"] as const;
export type WingId = (typeof WING_IDS)[number];
export const WINGS: Record<WingId, { name: string; glyph: string }> = {
  predict: { name: "ניבוי", glyph: "≈" },
  understand: { name: "הבנה", glyph: "✓" },
  sequence: { name: "סדר", glyph: "⇅" },
  calculate: { name: "חישוב", glyph: "÷" },
  explain: { name: "הסבר", glyph: "★" },
  reason: { name: "חשיבה עמוקה", glyph: "Σ" },
  curious: { name: "סקרנות", glyph: "?" },
};
/** feathers needed for level 2..10 (level 1 at 0) */
export const WING_LEVELS = [0, 10, 30, 60, 100, 150, 210, 280, 360, 450] as const;
export function wingLevel(feathers: number): { level: number; next: number | null } {
  let l = 1;
  WING_LEVELS.forEach((f, i) => {
    if (feathers >= f) l = i + 1;
  });
  return { level: l, next: WING_LEVELS[l] ?? null };
}
export function wingFor(kind: string, itemId: string): WingId | null {
  if (itemId === "predict" || kind === "predict") return "predict";
  if (kind === "quick" || kind === "mcq") return "understand";
  if (kind === "order") return "sequence";
  if (kind === "num") return "calculate";
  if (kind === "explain") return "explain";
  if (kind === "challenge") return "reason";
  if (kind === "open") return "curious";
  return null;
}
/** community first-try rate at or below this, with at least RARE_MIN_N answers, makes an item "rare" */
export const RARE_RATE = 0.35;
export const RARE_MIN_N = 8;

export const BADGE_DEFS: Record<string, BadgeDef> = {
  first_day: { name: ["היום הראשון", "היום הראשון"], glyph: "1", family: "rhythm", hint: "הגיליון הראשון שסיימת ביום שלו" },
  ...Object.fromEntries(STREAKS.map((n) => [`streak_${n}`, { name: [`רצף ${n}`, `רצף ${n}`], glyph: "🔥", family: "rhythm", hint: `${n} גיליונות ברצף, כל אחד ביום שלו` }])),
  comeback: { name: ["חזרתי", "חזרתי"], glyph: "↩", family: "rhythm", hint: "חזרה ביום שלו אחרי הפסקה של חמישה גיליונות או יותר" },
  full_week: { name: ["שבוע מלא", "שבוע מלא"], glyph: "7", family: "rhythm", hint: "כל הגיליונות של שבוע אחד, כל אחד ביום שלו" },
  full_month: { name: ["חודש מלא", "חודש מלא"], glyph: "30", family: "rhythm", hidden: true, hint: "כל הגיליונות של חודש שלם" },
  early_bird: { name: ["שעת הבוקר", "שעת הבוקר"], glyph: "☼", family: "rhythm", hidden: true, hint: "חמישה גיליונות שנגמרו תוך שעתיים מהשליחה" },
  no_mistakes: { name: ["בלי טעויות", "בלי טעויות"], glyph: "✓", family: "mastery", hint: "ניקוד מלא בגיליון אחד" },
  teacher: { name: ["המורה", "המורָה"], glyph: "★", family: "mastery", hint: "הסבר שקיבל שלושה כוכבים מארטו" },
  veteran_teacher: { name: ["מורה ותיק", "מורה ותיקה"], glyph: "★", family: "mastery", hint: "עשרה הסברים של שלושה כוכבים" },
  five_gold: { name: ["חמישה זהב", "חמישה זהב"], glyph: "5", family: "mastery", hint: "חמש מדליות זהב" },
  first_diamond: { name: ["יהלום ראשון", "יהלום ראשון"], glyph: "◆", family: "mastery", hint: "מדליית יהלום: זהב ועוד האתגר" },
  challenge: { name: ["האתגר", "האתגר"], glyph: "Σ", family: "mastery", hint: "פתרון האתגר" },
  challenge_10: { name: ["אתגר ×10", "אתגר ×10"], glyph: "Σ", family: "mastery", hint: "עשרה אתגרים פתורים" },
  beyond_level: { name: ["מעבר לרמה", "מעבר לרמה"], glyph: "↑", family: "mastery", hint: "האתגר נפתר בלי להיות ברמת מתקדמים" },
  asker: { name: ["שואל שאלות", "שואלת שאלות"], glyph: "?", family: "curiosity", hint: "שלוש שאלות לארטו על השיעור בגיליון אחד" },
  librarian: { name: ["ספרן של אלכסנדריה", "ספרנית של אלכסנדריה"], glyph: "?", family: "curiosity", hidden: true, hint: "חמישים שאלות לארטו על השיעורים" },
  from_library: { name: ["מן הספרייה", "מן הספרייה"], glyph: "▤", family: "curiosity", hint: "השלמה של גיליון שיצא לפני שבוע או יותר" },
  wide_roots: { name: ["שורשים רחבים", "שורשים רחבים"], glyph: "❋", family: "roots", hint: "כל שמונת השורשים נבטו" },
  second_try: { name: ["ניסיון שני", "ניסיון שני"], glyph: "2", family: "grit", hint: "שלוש שאלות בגיליון אחד שהצלחת בניסיון נוסף" },
  no_quit: { name: ["לא ויתרתי", "לא ויתרתי"], glyph: "!", family: "grit", hidden: true, hint: "גיליון שנגמר אחרי חמישה ניסיונות חוזרים או יותר" },
  no_hints: { name: ["בלי רמזים", "בלי רמזים"], glyph: "○", family: "grit", hidden: true, hint: "גיליון שלם בלי שאלה אחת לארטו" },
  after_bell: { name: ["אחרי הפעמון", "אחרי הפעמון"], glyph: "♪", family: "curiosity", hint: "הבונוס והמקורות נפתחו באותו גיליון" },
  rare_success: { name: ["מעטים הצליחו", "מעטים הצליחו"], glyph: "◇", family: "mastery", hint: "תשובה נכונה בניסיון הראשון על שאלה שרוב הילדים פספסו" },
  hard_of_week: { name: ["השאלה הקשה של השבוע", "השאלה הקשה של השבוע"], glyph: "◆", family: "mastery", hint: "נכון בניסיון הראשון על השאלה שהכי פחות ילדים פתרו השבוע" },
  fine_sieve: { name: ["מסננת דקה", "מסננת דקה"], glyph: "◇", family: "mastery", hidden: true, hint: "חמש פעמים מעטים הצליחו" },
  seven_wings: { name: ["שבע כנפיים", "שבע כנפיים"], glyph: "7", family: "wings", hint: "כל כנף ברמה 3 לפחות" },
  perfect_journey: { name: ["מסע מושלם", "מסע מושלם"], glyph: "✓", family: "rhythm", hint: "שלושת יעדי השבוע הושלמו" },
};
for (const id of WING_IDS) BADGE_DEFS[`wing_${id}_10`] = { name: ["כנף מלאה", "כנף מלאה"], glyph: "⋀", family: "wings", hint: `כנף ${WINGS[id].name} ברמה 10` };
for (const id of ROOT_IDS)
  for (const [stage, word] of [
    [2, "שתיל"],
    [4, "עץ"],
    [5, "עץ עתיק"],
  ] as const)
    BADGE_DEFS[`root_${id}_${stage}`] = { name: [word, word], glyph: "⌘", family: "roots", hint: `שורש ${id}: ${word}` };

export function badgeName(id: string, feminine: boolean): string {
  const d = BADGE_DEFS[id];
  if (!d) return id;
  const base = d.name[feminine ? 1 : 0];
  return id.startsWith("root_") ? `${rootLabel(id)} — ${base}` : base;
}
function rootLabel(badgeId: string): string {
  const rid = badgeId.split("_")[1] as RootId;
  // lazy import-free lookup to keep this module light
  return ROOT_NAMES[rid] ?? rid;
}
const ROOT_NAMES: Record<string, string> = { math: "מתמטיקה", physics: "פיזיקה", chemistry: "כימיה", biology: "ביולוגיה", engineering: "הנדסה", space: "חלל", earth: "כדור הארץ", history: "היסטוריה" };

/* ---------- facts in, progress out ---------- */

export interface FactEdition {
  n: number;
  date: string; // YYYY-MM-DD
  released_at: string | null; // ISO
  title: string;
  teaser: string | null;
  topics: string[];
  wow_meta: unknown;
}
export interface FactCompletion {
  edition_n: number;
  score: number;
  max: number;
  complete: boolean;
  late: boolean;
  challenge: boolean;
  xp_awarded: number;
  completed_at: string; // ISO — first completion time
  updated_at: string; // ISO — last improvement
}
export interface Facts {
  today: string;
  feminine: boolean;
  level: string;
  timezone: string;
  editions: FactEdition[]; // released, date ≤ today
  completions: FactCompletion[];
  grades: Record<number, number>; // edition_n → AI stars
  questions: Record<number, number>; // edition_n → in-scope assistant questions
  items: FactItem[]; // per-item events (Tier 1); empty for editions before the engine hooks
  itemStats: Record<string, { n: number; correct: number }>; // "n:item_id" → community first-try stats
  /** the editor's registries (spec §9); both optional */
  aliases?: RootAliases; // topic word → root id
  skillRegistry?: Record<string, { name_he: string | null; canonical_slug: string | null }>;
}
export interface FactItem {
  edition_n: number;
  item_id: string;
  kind: string;
  attempt: number;
  correct: boolean | null;
  partial: number | null;
  stars: number | null;
  graded: string | null;
  value: number | null;
  target: number | null;
}

export interface Badge {
  id: string;
  name: string;
  glyph: string;
  hidden: boolean;
  earned_at: string;
  edition_n: number | null;
}
export interface Card {
  n: number;
  title: string;
  date: string;
  medal: Medal;
  hero: string | null;
  fact: string | null;
  roots: RootId[];
}
export interface Progress {
  v: 1;
  streak: number;
  shields: number;
  shields_used: number;
  xp: number;
  roots: Record<RootId, { xp: number; stage: number; stage_name: string; next: number | null }>;
  medals: Record<number, Medal>;
  cards: Card[];
  /** released editions without a card, newest first — the album's silhouettes */
  missing: { n: number; title: string; date: string }[];
  badges: Badge[];
  counts: { bronze: number; silver: number; gold: number; diamond: number; teacher3: number; challenges: number; questions: number };
  wings: Record<WingId, { feathers: number; level: number; next: number | null }>;
  /** skill leaves (Tier 2): slug → touched / first-try successes / editions / mastered (≥ 3 first-try across ≥ 2 editions) */
  skills: Record<string, { name: string; touched: number; first_try: number; editions: number; mastered: boolean }>;
  /** feathers earned per edition (for the results screen) */
  feathers_by_edition: Record<number, Partial<Record<WingId, number>>>;
  journey: Journey;
}
export interface JourneyGoal {
  id: string;
  text: string;
  target: number;
  progress: number;
  done: boolean;
}
export interface Journey {
  week_start: string;
  goals: JourneyGoal[];
  complete: boolean;
}

/* ---------- per-item outcomes → feathers ---------- */
interface ItemOutcome {
  edition_n: number;
  item_id: string;
  kind: string;
  wing: WingId | null;
  attempts: number;
  firstTryCorrect: boolean;
  everCorrect: boolean;
  feathers: number;
}
/** Fold the raw events of one (edition, item) into its outcome (spec §3 feather table). */
export function itemOutcomes(items: FactItem[]): ItemOutcome[] {
  const groups = new Map<string, FactItem[]>();
  for (const it of items) {
    const k = `${it.edition_n}:${it.item_id}`;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k)!.push(it);
  }
  const out: ItemOutcome[] = [];
  for (const evs of groups.values()) {
    evs.sort((a, b) => a.attempt - b.attempt);
    const f = evs[0], wing = wingFor(f.kind, f.item_id);
    const firstTryCorrect = !!evs.find((e) => e.attempt === 1)?.correct;
    const everCorrect = evs.some((e) => !!e.correct);
    let feathers = 0;
    if (f.kind === "explain") {
      const ai = Math.max(0, ...evs.filter((e) => e.graded === "ai").map((e) => e.stars ?? 0));
      const rubric = Math.max(0, ...evs.filter((e) => e.graded !== "ai").map((e) => e.stars ?? 0));
      feathers = Math.max(ai, rubric * 0.5);
    } else if (f.kind === "predict" || f.item_id === "predict") {
      const v = Number(f.value), t = Number(f.target);
      const off = t > 0 && Number.isFinite(v) ? Math.abs(v - t) / t : 1;
      feathers = off <= 0.15 ? 3 : off <= 0.5 ? 1 : 0;
    } else if (f.kind === "open") {
      feathers = 1;
    } else if (f.kind === "challenge") {
      feathers = everCorrect ? 5 : 1;
    } else {
      feathers = firstTryCorrect ? 3 : everCorrect ? 2 : 1;
    }
    out.push({ edition_n: f.edition_n, item_id: f.item_id, kind: f.kind, wing, attempts: evs.length, firstTryCorrect, everCorrect, feathers });
  }
  return out;
}

function weekStart(date: string): string {
  return isoWeekKey(date);
}
function addDays(date: string, n: number): string {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Three goals for the week containing `today`, from the kid's own data (spec §6). Pure. */
export function deriveJourney(f: Facts, wings: Progress["wings"], editionsSorted: FactEdition[], completions: FactCompletion[], outcomes: ItemOutcome[]): Journey {
  const ws = weekStart(f.today), we = addDays(ws, 6);
  const inWeek = (d: string) => d >= ws && d <= we;
  const byN = new Map(editionsSorted.map((e) => [e.n, e]));
  const g = (m: string, fe: string) => (f.feminine ? fe : m);
  // 1. rhythm: adapt to the previous fortnight
  const prior = completions.filter((c) => c.complete && !c.late && byN.has(c.edition_n) && byN.get(c.edition_n)!.date < ws && byN.get(c.edition_n)!.date >= addDays(ws, -14)).length;
  const rhythmTarget = prior <= 4 ? 3 : prior >= 8 ? 5 : 4;
  const rhythmDone = completions.filter((c) => c.complete && !c.late && byN.has(c.edition_n) && inWeek(byN.get(c.edition_n)!.date)).length;
  // 2. wing: the weakest wing, with a step this week's items can satisfy
  const weakest = [...WING_IDS].sort((a, b) => wings[a].feathers - wings[b].feathers)[0];
  const WING_GOAL: Record<WingId, { text: readonly [string, string]; target: number; count: (o: ItemOutcome) => boolean }> = {
    predict: { text: ["לנחש קרוב למציאות פעמיים", "לנחש קרוב למציאות פעמיים"], target: 2, count: (o) => o.wing === "predict" && o.feathers >= 1 },
    understand: { text: ["לענות נכון על 6 שאלות בניסיון הראשון", "לענות נכון על 6 שאלות בניסיון הראשון"], target: 6, count: (o) => o.wing === "understand" && o.firstTryCorrect },
    sequence: { text: ["לסדר שלבים נכון פעמיים", "לסדר שלבים נכון פעמיים"], target: 2, count: (o) => o.wing === "sequence" && o.everCorrect },
    calculate: { text: ["לפתור נכון 2 שאלות חישוב", "לפתור נכון 2 שאלות חישוב"], target: 2, count: (o) => o.wing === "calculate" && o.everCorrect },
    explain: { text: ["להסביר עם 3 כוכבים פעם אחת", "להסביר עם 3 כוכבים פעם אחת"], target: 1, count: (o) => o.wing === "explain" && o.feathers >= 3 },
    reason: { text: ["לפתור את האתגר פעם אחת", "לפתור את האתגר פעם אחת"], target: 1, count: (o) => o.wing === "reason" && o.everCorrect },
    curious: { text: ["לשאול את ארטו 3 שאלות על השיעור", "לשאול את ארטו 3 שאלות על השיעור"], target: 3, count: () => false },
  };
  const wg = WING_GOAL[weakest];
  let wingProgress = outcomes.filter((o) => byN.has(o.edition_n) && inWeek(byN.get(o.edition_n)!.date) && wg.count(o)).length;
  if (weakest === "curious") wingProgress = Object.entries(f.questions).filter(([n]) => byN.has(Number(n)) && inWeek(byN.get(Number(n))!.date)).reduce((s, [, q]) => s + q, 0);
  // 3. roots: grow the root of the day's topic three times (any completion with a mapped root)
  const rootDone = completions.filter((c) => c.complete && byN.has(c.edition_n) && inWeek(byN.get(c.edition_n)!.date) && Object.keys(rootWeightsFor(byN.get(c.edition_n)!.topics, byN.get(c.edition_n)!.wow_meta, f.aliases)).length > 0).length;
  const goals: JourneyGoal[] = [
    { id: "rhythm", text: `לסיים ${rhythmTarget} גיליונות השבוע, כל אחד ביום שלו`, target: rhythmTarget, progress: Math.min(rhythmTarget, rhythmDone), done: rhythmDone >= rhythmTarget },
    { id: `wing_${weakest}`, text: g(wg.text[0], wg.text[1]), target: wg.target, progress: Math.min(wg.target, wingProgress), done: wingProgress >= wg.target },
    { id: "roots", text: "להצמיח את השורש של נושא היום 3 פעמים", target: 3, progress: Math.min(3, rootDone), done: rootDone >= 3 },
  ];
  return { week_start: ws, goals, complete: goals.every((x) => x.done) };
}

/** Medal for one completion (spec §4.1). Gold needs three stars as the server saw them, or a perfect score. */
export function medalFor(c: Pick<FactCompletion, "score" | "max" | "complete" | "challenge">, aiStars: number | undefined): Medal | null {
  if (!c.complete) return null;
  const pct = c.max > 0 ? c.score / c.max : 0;
  const threeStars = aiStars === 3 || (c.max > 0 && c.score >= c.max);
  if (pct >= 0.9 && threeStars) return c.challenge ? "diamond" : "gold";
  if (pct >= 0.7) return "silver";
  return "bronze";
}

export function medalNext(medal: Medal | null, c: Pick<FactCompletion, "score" | "max" | "challenge">, feminine: boolean, level: string): string {
  const g = (m: string, f: string) => (feminine ? f : m);
  if (!medal) return g("סיים את כל המבחן למדליית ארד", "סיימי את כל המבחן למדליית ארד");
  const need = (pct: number) => Math.max(0, Math.ceil(pct * c.max) - c.score);
  if (medal === "bronze") return `עוד ${need(0.7)} נקודות לכסף`;
  if (medal === "silver") return c.score < Math.ceil(0.9 * c.max) ? `עוד ${need(0.9)} נקודות ושלושה כוכבים על ההסבר לזהב` : "שלושה כוכבים על ההסבר לזהב";
  if (medal === "gold") return level === "support" ? "המדליה הגבוהה ביותר בשבילך. כל הכבוד." : g("פתור את האתגר ליהלום", "פתרי את האתגר ליהלום");
  return "המדליה הגבוהה ביותר.";
}

function firstSentence(s: string | null): string | null {
  if (!s) return null;
  const m = s.replace(/\s+/g, " ").trim().match(/^[^.!?]{8,120}[.!?]?/u);
  return m ? m[0].trim() : null;
}

function isoWeekKey(date: string): string {
  // Sun–Sat weeks, keyed by the Sunday
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - d.getUTCDay());
  return d.toISOString().slice(0, 10);
}

/** The whole rulebook, pure. Completions are replayed in the order they first happened. */
export function deriveProgress(f: Facts): Progress {
  const editions = [...f.editions].filter((e) => e.date <= f.today).sort((a, b) => a.date.localeCompare(b.date) || a.n - b.n);
  const byN = new Map(editions.map((e) => [e.n, e]));
  const releasedDates = editions.map((e) => e.date);
  const completions = [...f.completions].filter((c) => byN.has(c.edition_n)).sort((a, b) => a.completed_at.localeCompare(b.completed_at));

  const rootXp = Object.fromEntries(ROOT_IDS.map((id) => [id, 0])) as Record<RootId, number>;
  const medals: Record<number, Medal> = {};
  const badges: Badge[] = [];
  const have = new Set<string>();
  const onTime = new Set<string>();
  const completeN = new Set<number>();
  const counts: Progress["counts"] = { bronze: 0, silver: 0, gold: 0, diamond: 0, teacher3: 0, challenges: 0, questions: 0 };
  let xp = 0, earlyCount = 0, challengesSoFar = 0;
  const earn = (id: string, at: string, n: number | null) => {
    if (have.has(id) || !BADGE_DEFS[id]) return;
    have.add(id);
    const d = BADGE_DEFS[id];
    badges.push({ id, name: badgeName(id, f.feminine), glyph: d.glyph, hidden: !!d.hidden, earned_at: at, edition_n: n });
  };

  const outcomes = itemOutcomes(f.items.filter((it) => byN.has(it.edition_n)));
  const outcomesByN = new Map<number, ItemOutcome[]>();
  for (const o of outcomes) {
    if (!outcomesByN.has(o.edition_n)) outcomesByN.set(o.edition_n, []);
    outcomesByN.get(o.edition_n)!.push(o);
  }
  const feathers = Object.fromEntries(WING_IDS.map((id) => [id, 0])) as Record<WingId, number>;
  const skillAcc = new Map<string, { touched: number; first_try: number; editions: Set<number> }>();
  const feathersByEdition: Progress["feathers_by_edition"] = {};
  let rareCount = 0;

  for (const c of completions) {
    const e = byN.get(c.edition_n)!;
    const at = c.completed_at;
    const os = outcomesByN.get(c.edition_n) ?? [];
    // wings: feathers from this edition's items, plus in-scope questions (max 3) on the curiosity wing
    const fe: Partial<Record<WingId, number>> = {};
    for (const o of os) if (o.wing) fe[o.wing] = (fe[o.wing] ?? 0) + o.feathers;
    const qn = Math.min(3, f.questions[c.edition_n] ?? 0);
    if (qn) fe.curious = (fe.curious ?? 0) + qn;
    for (const [w, v] of Object.entries(fe)) feathers[w as WingId] += v ?? 0;
    feathersByEdition[c.edition_n] = fe;
    // skills: the builder's tag per item (WOW_META.items), counted only where the kid actually answered
    const tagged = e.wow_meta && typeof e.wow_meta === "object" ? ((e.wow_meta as { items?: Record<string, { skill?: string | null }> }).items ?? {}) : {};
    for (const o of os) {
      const raw = tagged[o.item_id]?.skill;
      if (!raw || o.kind === "open") continue;
      const slug = f.skillRegistry?.[raw]?.canonical_slug || raw;
      const a = skillAcc.get(slug) ?? { touched: 0, first_try: 0, editions: new Set<number>() };
      a.touched++;
      if (o.firstTryCorrect || (o.kind === "explain" && o.feathers >= 3) || (o.kind === "predict" && o.feathers >= 3)) a.first_try++;
      a.editions.add(o.edition_n);
      skillAcc.set(slug, a);
    }
    xp += c.xp_awarded;
    const split = splitXp(c.xp_awarded, rootWeightsFor(e.topics, e.wow_meta, f.aliases));
    for (const [id, v] of Object.entries(split)) rootXp[id as RootId] += v ?? 0;

    const m = medalFor(c, f.grades[c.edition_n]);
    if (m) {
      medals[c.edition_n] = m;
      completeN.add(c.edition_n);
    }
    if (c.challenge) challengesSoFar++;

    // streak as of this edition's day (on-time completions only)
    const onTimeNow = c.complete && !c.late;
    const wasFirstEver = onTimeNow && !badges.some((b) => b.id === "first_day") && completeN.size === 1;
    let gapBefore = 0;
    if (onTimeNow) {
      // released editions between the previous on-time completion and this one
      const idx = editions.findIndex((x) => x.n === e.n);
      for (let i = idx - 1; i >= 0 && !onTime.has(editions[i].date); i--) gapBefore++;
      onTime.add(e.date);
    }
    const sd = computeStreakDetail(releasedDates.filter((d) => d <= e.date), onTime, e.date);

    // rhythm
    if (wasFirstEver) earn("first_day", at, e.n);
    if (onTimeNow) for (const s of STREAKS) if (sd.streak >= s) earn(`streak_${s}`, at, e.n);
    if (onTimeNow && gapBefore >= 5 && onTime.size > 1) earn("comeback", at, e.n);
    if (onTimeNow) {
      const wk = isoWeekKey(e.date);
      const week = editions.filter((x) => isoWeekKey(x.date) === wk);
      if (week.length >= 4 && week.every((x) => onTime.has(x.date))) earn("full_week", at, e.n);
    }
    if (c.complete) {
      const mo = e.date.slice(0, 7);
      const month = editions.filter((x) => x.date.slice(0, 7) === mo);
      if (month.length >= 15 && month.every((x) => completeN.has(x.n))) earn("full_month", at, e.n);
    }
    if (c.complete && e.released_at && Date.parse(at) - Date.parse(e.released_at) <= 2 * 3600e3 && ++earlyCount >= 5) earn("early_bird", at, e.n);

    // mastery
    if (c.max > 0 && c.score >= c.max) earn("no_mistakes", at, e.n);
    if (f.grades[c.edition_n] === 3) earn("teacher", at, e.n);
    if (c.challenge) earn("challenge", at, e.n);
    if (c.challenge && challengesSoFar >= 10) earn("challenge_10", at, e.n);
    if (c.challenge && f.level !== "advanced") earn("beyond_level", at, e.n);
    if (m === "diamond") earn("first_diamond", at, e.n);
    if (Object.values(medals).filter((x) => MEDAL_RANK[x] >= MEDAL_RANK.gold).length >= 5) earn("five_gold", at, e.n);

    // curiosity
    if ((f.questions[c.edition_n] ?? 0) >= 3) earn("asker", at, e.n);
    if (c.complete && c.late && Date.parse(at) - Date.parse(`${e.date}T00:00:00Z`) >= 7 * 86400e3) earn("from_library", at, e.n);

    // roots
    for (const id of ROOT_IDS) {
      const st = rootStage(rootXp[id]).index;
      for (const s of [2, 4, 5]) if (st >= s) earn(`root_${id}_${s}`, at, e.n);
    }
    if (ROOT_IDS.every((id) => rootStage(rootXp[id]).index >= 1)) earn("wide_roots", at, e.n);

    // grit and curiosity from items (Tier 1)
    const graded = os.filter((o) => o.kind !== "open" && o.kind !== "predict" && o.item_id !== "predict");
    if (graded.filter((o) => !o.firstTryCorrect && o.everCorrect).length >= 3) earn("second_try", at, e.n);
    if (c.complete && graded.reduce((sum, o) => sum + Math.max(0, o.attempts - 1), 0) >= 5) earn("no_quit", at, e.n);
    if (c.complete && graded.length >= 4 && !(f.questions[c.edition_n] ?? 0)) earn("no_hints", at, e.n);
    if (os.some((o) => o.item_id === "open:bonus") && os.some((o) => o.item_id === "open:sources")) earn("after_bell", at, e.n);
    // rare success: first-try correct on an item most of the community missed (n ≥ RARE_MIN_N)
    for (const o of graded) {
      const st = f.itemStats[`${o.edition_n}:${o.item_id}`];
      if (o.firstTryCorrect && st && st.n >= RARE_MIN_N && st.correct / st.n <= RARE_RATE) {
        rareCount++;
        earn("rare_success", at, e.n);
        if (rareCount >= 5) earn("fine_sieve", at, e.n);
      }
    }
    // wings milestones
    for (const w of WING_IDS) if (wingLevel(feathers[w]).level >= 10) earn(`wing_${w}_10`, at, e.n);
    if (WING_IDS.every((w) => wingLevel(feathers[w]).level >= 3)) earn("seven_wings", at, e.n);
  }

  // the hardest question of each closed week (spec §5.3): lowest community first-try rate, n ≥ RARE_MIN_N
  const weeks = new Map<string, FactEdition[]>();
  for (const e of editions) {
    const wk = isoWeekKey(e.date);
    if (!weeks.has(wk)) weeks.set(wk, []);
    weeks.get(wk)!.push(e);
  }
  for (const [wk, eds] of weeks) {
    if (addDays(wk, 6) >= f.today) continue; // still open
    let hardest: { key: string; rate: number; n: number } | null = null;
    for (const e of eds)
      for (const [key, st] of Object.entries(f.itemStats)) {
        if (!key.startsWith(`${e.n}:`) || st.n < RARE_MIN_N) continue;
        const rate = st.correct / st.n;
        if (!hardest || rate < hardest.rate || (rate === hardest.rate && key < hardest.key)) hardest = { key, rate, n: st.n };
      }
    if (!hardest) continue;
    const [nStr, ...rest] = hardest.key.split(":");
    const o = outcomes.find((x) => x.edition_n === Number(nStr) && x.item_id === rest.join(":"));
    if (o?.firstTryCorrect) {
      const c = completions.find((x) => x.edition_n === Number(nStr));
      earn("hard_of_week", c?.completed_at ?? `${addDays(wk, 6)}T21:00:00Z`, Number(nStr));
    }
  }

  // lifetime, not per completion
  counts.teacher3 = Object.values(f.grades).filter((s) => s === 3).length;
  if (counts.teacher3 >= 10) earn("veteran_teacher", f.today + "T00:00:00Z", null);
  counts.questions = Object.values(f.questions).reduce((s, n) => s + n, 0);
  if (counts.questions >= 50) earn("librarian", f.today + "T00:00:00Z", null);
  counts.challenges = challengesSoFar;
  for (const m of Object.values(medals)) counts[m]++;

  const sd = computeStreakDetail(releasedDates, onTime, f.today);
  const cards: Card[] = completions
    .filter((c) => medals[c.edition_n])
    .map((c) => {
      const e = byN.get(c.edition_n)!;
      const meta = e.wow_meta && typeof e.wow_meta === "object" ? (e.wow_meta as { hero?: { name?: unknown; fact?: unknown } }) : {};
      const hero = meta.hero && typeof meta.hero.name === "string" ? meta.hero.name.slice(0, 60) : null;
      const fact = meta.hero && typeof meta.hero.fact === "string" ? meta.hero.fact.slice(0, 120) : firstSentence(e.teaser);
      return { n: e.n, title: e.title, date: e.date, medal: medals[c.edition_n], hero, fact, roots: Object.keys(rootWeightsFor(e.topics, e.wow_meta, f.aliases)) as RootId[] };
    })
    .sort((a, b) => b.n - a.n);
  const missing = editions
    .filter((e) => !medals[e.n])
    .map((e) => ({ n: e.n, title: e.title, date: e.date }))
    .sort((a, b) => b.n - a.n);
  const roots = Object.fromEntries(
    ROOT_IDS.map((id) => {
      const st = rootStage(rootXp[id]);
      return [id, { xp: rootXp[id], stage: st.index, stage_name: st.name, next: st.next }];
    }),
  ) as Progress["roots"];

  const wings = Object.fromEntries(WING_IDS.map((id) => [id, { feathers: feathers[id], ...wingLevel(feathers[id]) }])) as Progress["wings"];
  const journey = deriveJourney(f, wings, editions, completions, outcomes);
  if (journey.complete) earn("perfect_journey", f.today + "T00:00:00Z", null);

  const skills = Object.fromEntries([...skillAcc].map(([slug, a]) => [slug, { name: f.skillRegistry?.[slug]?.name_he || slug.replace(/-/g, " "), touched: a.touched, first_try: a.first_try, editions: a.editions.size, mastered: a.first_try >= 3 && a.editions.size >= 2 }]));

  return { v: 1, streak: sd.streak, shields: sd.shields, shields_used: sd.shieldsUsed, xp, roots, medals, cards, missing, badges, counts, wings, feathers_by_edition: feathersByEdition, journey, skills };
}

/* ---------- database ---------- */

export async function loadFacts(kid: { id: string; feminine: boolean; level: string }, timezone: string, now: Date, q: Queryable = db()): Promise<Facts> {
  const today = localDate(now, timezone);
  const eds = await q.query<{ n: number; date: Date | string; released_at: Date | string | null; title: string; teaser: string | null; topics: string[] | null; wow_meta: unknown }>(
    "select n, date, released_at, title, teaser, topics, wow_meta from editions where status = 'released' and date <= $1",
    [today],
  );
  const toD = (d: Date | string) => (d instanceof Date ? localDate(d, "UTC") : String(d).slice(0, 10));
  const toIso = (d: Date | string | null) => (d == null ? null : d instanceof Date ? d.toISOString() : new Date(d).toISOString());
  const cs = await q.query<{ edition_n: number; score: number; max: number; complete: boolean; late: boolean; challenge: boolean; xp_awarded: number; completed_at: Date | string; updated_at: Date | string }>(
    "select edition_n, score, max, complete, late, challenge, xp_awarded, completed_at, updated_at from completions where kid_id = $1",
    [kid.id],
  );
  const gs = await q.query<{ edition_n: number; stars: number }>("select edition_n, stars from grades where kid_id = $1", [kid.id]);
  const qs = await q.query<{ edition_n: number; n: string | number }>(
    "select edition_n, count(*) as n from usage where kid_id = $1 and kind = 'chat' and scope in ('lesson','adjacent') and edition_n is not null group by edition_n",
    [kid.id],
  );
  const its = await q.query<FactItem>(
    "select edition_n, item_id, kind, attempt, correct, partial, stars, graded, value::float as value, target::float as target from item_events where kid_id = $1",
    [kid.id],
  );
  const sts = await q.query<{ edition_n: number; item_id: string; n: number; first_try_correct: number }>(
    "select s.edition_n, s.item_id, s.n, s.first_try_correct from item_stats s where s.edition_n in (select distinct edition_n from item_events where kid_id = $1) or s.computed_at > now() - interval '60 days'",
    [kid.id],
  );
  const al = await q.query<{ topic: string; root: string }>("select topic, root from root_aliases");
  const sk = await q.query<{ slug: string; name_he: string | null; canonical_slug: string | null }>("select slug, name_he, canonical_slug from skills");
  return {
    aliases: Object.fromEntries(al.rows.map((r) => [r.topic, r.root])),
    skillRegistry: Object.fromEntries(sk.rows.map((r) => [r.slug, { name_he: r.name_he, canonical_slug: r.canonical_slug }])),
    items: its.rows.map((r) => ({ ...r, value: r.value == null ? null : Number(r.value), target: r.target == null ? null : Number(r.target) })),
    itemStats: Object.fromEntries(sts.rows.map((r) => [`${r.edition_n}:${r.item_id}`, { n: Number(r.n), correct: Number(r.first_try_correct) }])),
    today,
    feminine: kid.feminine,
    level: kid.level,
    timezone,
    editions: eds.rows.map((e) => ({ n: e.n, date: toD(e.date), released_at: toIso(e.released_at), title: e.title, teaser: e.teaser, topics: e.topics ?? [], wow_meta: e.wow_meta ?? null })),
    completions: cs.rows.map((c) => ({ ...c, completed_at: toIso(c.completed_at)!, updated_at: toIso(c.updated_at)! })),
    grades: Object.fromEntries(gs.rows.map((g) => [g.edition_n, g.stars])),
    questions: Object.fromEntries(qs.rows.map((r) => [r.edition_n, Number(r.n)])),
  };
}

/** Replay everything for one kid and cache it. Idempotent; call it inside the completion transaction. */
export async function rebuildProgress(kid: { id: string; feminine: boolean; level: string }, timezone: string, now = new Date(), q: Queryable = db()): Promise<Progress> {
  const p = deriveProgress(await loadFacts(kid, timezone, now, q));
  await q.query(
    "insert into kid_progress (kid_id, data, updated_at) values ($1, $2::jsonb, now()) on conflict (kid_id) do update set data = excluded.data, updated_at = now()",
    [kid.id, JSON.stringify(p)],
  );
  return p;
}

export async function progressFor(kidId: string, q: Queryable = db()): Promise<Progress | null> {
  const r = await q.query<{ data: Progress }>("select data from kid_progress where kid_id = $1", [kidId]);
  const d = r.rows[0]?.data;
  return d && (d as Progress).v === 1 ? (d as Progress) : null;
}

/** Rebuild every kid (admin repair tool, and after a rules change). */
export async function rebuildAllProgress(now = new Date()): Promise<number> {
  const kids = await db().query<{ id: string; feminine: boolean; level: string; timezone: string }>(
    "select k.id, k.feminine, k.level, p.timezone from kids k join parents p on p.id = k.parent_id where k.deleted_at is null",
  );
  for (const k of kids.rows) await rebuildProgress(k, k.timezone || "Asia/Jerusalem", now);
  return kids.rows.length;
}

/** The small object injected into the lesson page before the fragment (hero strip), never the whole album. */
export function progressSummary(p: Progress | null, editionN: number) {
  if (!p) return null;
  return {
    streak: p.streak,
    shields: p.shields,
    cards: p.cards.length,
    badges: p.badges.length,
    medal: p.medals[editionN] ?? null,
    roots: Object.fromEntries(Object.entries(p.roots).map(([id, r]) => [id, r.stage])),
    wings: Object.fromEntries(Object.entries(p.wings ?? {}).map(([id, w]) => [id, w.level])),
    journey: p.journey ?? null,
  };
}

/* ---------- items in, community stats, notices ---------- */

export interface ItemEventIn {
  id: string;
  kind: string;
  attempt?: number;
  correct?: boolean;
  partial?: number;
  stars?: number;
  graded?: string;
  value?: number;
  target?: number;
}
const KINDS = new Set(["predict", "quick", "mcq", "order", "num", "challenge", "explain", "open"]);
export const MAX_EVENTS_PER_EDITION = 200;

/** Store a batch of item events; the first attempt per item is immutable, duplicates are ignored. Returns the number stored. */
export async function recordItemEvents(kid: { id: string; feminine: boolean; level: string }, editionN: number, events: ItemEventIn[], timezone: string, now = new Date()): Promise<{ accepted: number; error?: string }> {
  return db().tx(async (q) => {
    const ed = await q.query<{ status: string }>("select status from editions where n = $1", [editionN]);
    if (ed.rows[0]?.status !== "released") return { accepted: 0, error: "edition_not_released" };
    const cnt = Number((await q.query<{ n: string }>("select count(*) as n from item_events where kid_id = $1 and edition_n = $2", [kid.id, editionN])).rows[0]?.n ?? 0);
    let room = MAX_EVENTS_PER_EDITION - cnt, accepted = 0;
    for (const ev of events.slice(0, 50)) {
      if (room <= 0) break;
      const id = String(ev.id ?? "").slice(0, 40), kind = String(ev.kind ?? "");
      if (!/^[a-z]+(:[a-z0-9_?-]+)*$/i.test(id) || !KINDS.has(kind)) continue;
      const attempt = Math.max(1, Math.min(50, Math.round(Number(ev.attempt) || 1)));
      const r = await q.query(
        `insert into item_events (kid_id, edition_n, item_id, kind, attempt, correct, partial, stars, graded, value, target, at)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) on conflict do nothing`,
        [kid.id, editionN, id, kind, attempt, typeof ev.correct === "boolean" ? ev.correct : null, Number.isFinite(ev.partial) ? Math.round(ev.partial!) : null, Number.isFinite(ev.stars) ? Math.max(0, Math.min(3, Math.round(ev.stars!))) : null, ev.graded === "ai" ? "ai" : ev.graded === "rubric" ? "rubric" : null, Number.isFinite(ev.value) ? ev.value : null, Number.isFinite(ev.target) ? ev.target : null, now],
      );
      if (r.rowCount) {
        accepted++;
        room--;
      }
    }
    if (accepted) await rebuildProgress(kid, timezone, now, q);
    return { accepted };
  });
}

/** Rebuild the community first-try statistics for the given editions (the close-day job). */
export async function rebuildItemStats(editionNs: number[], q: Queryable = db()): Promise<number> {
  let rows = 0;
  for (const n of editionNs) {
    const r = await q.query(
      `insert into item_stats (edition_n, item_id, n, first_try_correct, computed_at)
       select edition_n, item_id, count(*), count(*) filter (where correct), now()
       from item_events where edition_n = $1 and attempt = 1 and kind in ('quick','mcq','order','num','challenge')
       group by edition_n, item_id
       on conflict (edition_n, item_id) do update set n = excluded.n, first_try_correct = excluded.first_try_correct, computed_at = now()`,
      [n],
    );
    rows += r.rowCount;
  }
  return rows;
}

/**
 * The daily close (spec §8.4): community stats for the last two editions, every kid's progress replayed, and a
 * notice for each badge that appeared only because of the community (rare success) — shown on the next visit.
 */
export async function closeDay(now = new Date()): Promise<{ editions: number[]; kids: number; notices: number }> {
  const eds = await db().query<{ n: number }>("select n from editions where status = 'released' order by date desc, n desc limit 2");
  const ns = eds.rows.map((r) => r.n);
  await rebuildItemStats(ns);
  const kids = await db().query<{ id: string; feminine: boolean; level: string; timezone: string }>(
    "select k.id, k.feminine, k.level, p.timezone from kids k join parents p on p.id = k.parent_id where k.deleted_at is null",
  );
  let notices = 0;
  for (const k of kids.rows) {
    const before = await progressFor(k.id);
    const after = await rebuildProgress(k, k.timezone || "Asia/Jerusalem", now);
    const had = new Set((before?.badges ?? []).map((b) => b.id + ":" + b.edition_n));
    for (const b of after.badges) {
      if (!had.has(b.id + ":" + b.edition_n) && (b.id === "rare_success" || b.id === "fine_sieve" || b.id === "hard_of_week")) {
        const st = b.edition_n != null ? await db().query<{ n: number; c: number; item_id: string }>("select n, first_try_correct as c, item_id from item_stats where edition_n = $1 order by first_try_correct::float / greatest(n,1) asc limit 1", [b.edition_n]) : { rows: [] };
        await db().query("insert into kid_notices (kid_id, kind, payload) values ($1, 'badge', $2::jsonb)", [k.id, JSON.stringify({ badge: b.id, name: b.name, edition_n: b.edition_n, n: st.rows[0]?.n ?? null, correct: st.rows[0]?.c ?? null })]);
        notices++;
      }
    }
  }
  return { editions: ns, kids: kids.rows.length, notices };
}

/** Pending notices for a kid, marked shown (they are read exactly once, when the page is served). */
export async function takeNotices(kidId: string, q: Queryable = db()): Promise<{ kind: string; payload: Record<string, unknown> }[]> {
  const r = await q.query<{ id: number; kind: string; payload: Record<string, unknown> }>("select id, kind, payload from kid_notices where kid_id = $1 and shown_at is null order by created_at asc limit 10", [kidId]);
  if (r.rows.length) await q.query("update kid_notices set shown_at = now() where id = any($1::bigint[])", [r.rows.map((x) => x.id)]);
  return r.rows.map((x) => ({ kind: x.kind, payload: x.payload }));
}
