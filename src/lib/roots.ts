/**
 * Roots (שורשים) — the eight knowledge domains a lesson grows (spec §2). Fixed in code; the builder's free-text
 * `topics[]` map onto them through the alias table, and its optional `WOW_META.roots` weights refine the split.
 */
export const ROOT_IDS = ["math", "physics", "chemistry", "biology", "engineering", "space", "earth", "history"] as const;
export type RootId = (typeof ROOT_IDS)[number];

export const ROOTS: Record<RootId, { name: string; glyph: string; aliases: string[] }> = {
  math: { name: "מתמטיקה", glyph: "∑", aliases: ["מתמטיקה", "חשבון", "גאומטריה", "גיאומטריה", "מספרים", "הסתברות", "סטטיסטיקה", "maths", "math", "mathematics"] },
  physics: { name: "פיזיקה", glyph: "⚡", aliases: ["פיזיקה", "פיסיקה", "אור", "קול", "מוזיקה", "צליל", "כוחות", "אנרגיה", "חשמל", "מגנטיות", "תנועה", "physics"] },
  chemistry: { name: "כימיה", glyph: "⚗", aliases: ["כימיה", "חומרים", "מולקולות", "אטומים", "chemistry"] },
  biology: { name: "ביולוגיה", glyph: "❀", aliases: ["ביולוגיה", "טבע", "בעלי חיים", "חיות", "צמחים", "גוף האדם", "רפואה", "אבולוציה", "תאים", "biology", "nature"] },
  engineering: { name: "הנדסה וטכנולוגיה", glyph: "⚙", aliases: ["הנדסה", "טכנולוגיה", "מכונות", "המצאות", "מחשבים", "תקשורת", "בנייה", "רובוטיקה", "engineering", "technology"] },
  space: { name: "חלל", glyph: "✦", aliases: ["חלל", "אסטרונומיה", "כוכבים", "ירח", "שמש", "כוכבי לכת", "space", "astronomy"] },
  earth: { name: "כדור הארץ", glyph: "◍", aliases: ["גאוגרפיה", "גיאוגרפיה", "גאולוגיה", "גיאולוגיה", "מזג אוויר", "אקלים", "ים", "אוקיינוס", "הרי געש", "רעידות אדמה", "כדור הארץ", "geography", "geology", "earth"] },
  history: { name: "היסטוריה ואנשים", glyph: "⌛", aliases: ["היסטוריה", "ארכאולוגיה", "ארכיאולוגיה", "אנשים", "תרבות", "ממציאים", "history", "archaeology"] },
};

/** Tree stages by domain XP (spec §2.3). Index = stage; names are what the kid sees. */
export const ROOT_STAGES: ReadonlyArray<readonly [number, string]> = [
  [0, "זרע"],
  [60, "נבט"],
  [200, "שתיל"],
  [500, "עץ צעיר"],
  [1000, "עץ"],
  [2000, "עץ עתיק"],
];

const ALIAS: Map<string, RootId> = new Map();
for (const id of ROOT_IDS) for (const a of ROOTS[id].aliases) ALIAS.set(norm(a), id);

export function normTopic(s: string): string {
  return norm(s);
}
function norm(s: string): string {
  return s.trim().toLowerCase().replace(/[֑-ׇ]/g, "").replace(/\s+/g, " ");
}

/** One topic word → a root, or null when nothing matches (the editor sees those on /admin). */
export type RootAliases = Record<string, string>;
export function rootForTopic(topic: string, aliases?: RootAliases): RootId | null {
  const n = norm(topic);
  const a = aliases?.[n] ?? aliases?.[topic];
  if (a && (ROOT_IDS as readonly string[]).includes(a)) return a as RootId;
  if (ALIAS.has(n)) return ALIAS.get(n)!;
  for (const [alias, id] of ALIAS) if (n.includes(alias) || alias.includes(n)) return id;
  return null;
}

export type RootWeights = Partial<Record<RootId, number>>;

/**
 * The roots an edition grows and their weights: the builder's `WOW_META.roots` when it has valid entries,
 * otherwise an equal split across the mapped `topics[]`. Empty when nothing maps.
 */
export function rootWeightsFor(topics: string[] | null | undefined, wowMeta: unknown, aliases?: RootAliases): RootWeights {
  const out: RootWeights = {};
  const meta = wowMeta && typeof wowMeta === "object" ? (wowMeta as { roots?: unknown }).roots : null;
  if (Array.isArray(meta)) {
    for (const r of meta) {
      const id = r && typeof r === "object" ? String((r as { id?: unknown }).id ?? "") : "";
      const w = r && typeof r === "object" ? Number((r as { w?: unknown }).w ?? 1) : 1;
      if ((ROOT_IDS as readonly string[]).includes(id) && w > 0) out[id as RootId] = (out[id as RootId] ?? 0) + w;
    }
    if (Object.keys(out).length) return out;
  }
  for (const t of topics ?? []) {
    const id = rootForTopic(t, aliases);
    if (id) out[id] = (out[id] ?? 0) + 1;
  }
  return out;
}

/** Split `xp` across roots by weight with the largest-remainder method, so the parts sum to `xp` exactly. */
export function splitXp(xp: number, weights: RootWeights): Partial<Record<RootId, number>> {
  const ids = Object.keys(weights) as RootId[];
  const total = ids.reduce((s, id) => s + (weights[id] ?? 0), 0);
  if (!ids.length || total <= 0 || xp <= 0) return {};
  const raw = ids.map((id) => ({ id, exact: (xp * (weights[id] ?? 0)) / total }));
  const parts = raw.map((r) => ({ id: r.id, n: Math.floor(r.exact), frac: r.exact - Math.floor(r.exact) }));
  let left = xp - parts.reduce((s, p) => s + p.n, 0);
  for (const p of [...parts].sort((a, b) => b.frac - a.frac)) {
    if (left <= 0) break;
    p.n++;
    left--;
  }
  const out: Partial<Record<RootId, number>> = {};
  for (const p of parts) out[p.id] = p.n;
  return out;
}

export function rootStage(xp: number): { index: number; name: string; next: number | null } {
  let i = 0;
  ROOT_STAGES.forEach((s, k) => {
    if (xp >= s[0]) i = k;
  });
  return { index: i, name: ROOT_STAGES[i][1], next: ROOT_STAGES[i + 1] ? ROOT_STAGES[i + 1][0] : null };
}
