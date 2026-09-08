/**
 * WOW_META — the builder's optional per-edition declaration (gamification spec §7.2): root weights, hero card,
 * item tags. Extracted from the fragment at staging/import the way LESSON_CONTEXT is, but it is an object
 * literal, so it is evaluated in an empty VM context with a timeout, then validated field by field.
 * Anything wrong produces a warning, never a rejection — the lesson ships, the kid earns Tier 0/1 rewards.
 */
import vm from "node:vm";
import { ROOT_IDS } from "./roots";

export interface WowMeta {
  v: number;
  roots: { id: string; w: number }[];
  hero: { name: string; fact: string } | null;
  items: Record<string, { skill: string | null; d: number }>;
}

const ITEM_ID = /^(predict|qc:[a-z0-9_-]+|mcq:[a-z0-9_-]+:\d+|order|num:[a-z0-9_-]+|challenge|explain)$/i;
const SKILL = /^[a-z][a-z0-9-]{1,40}$/;

/** The literal's source text, or null when the fragment has none. */
export function readWowMetaSource(html: string): string | null {
  const m = html.match(/const\s+WOW_META\s*=\s*\{/);
  if (!m || m.index == null) return null;
  const start = m.index + m[0].length - 1;
  let depth = 0, inStr: string | null = null;
  for (let i = start; i < html.length; i++) {
    const c = html[i];
    if (inStr) {
      if (c === "\\") i++;
      else if (c === inStr) inStr = null;
      continue;
    }
    if (c === "'" || c === '"' || c === "`") inStr = c;
    else if (c === "{") depth++;
    else if (c === "}") {
      depth--;
      if (depth === 0) return html.slice(start, i + 1);
    }
  }
  return null;
}

export function extractWowMeta(html: string): { meta: WowMeta | null; warnings: string[] } {
  const warnings: string[] = [];
  const src = readWowMetaSource(html);
  if (!src) return { meta: null, warnings: ["WOW_META חסר — השורשים יחושבו מ-topics בלבד, בלי קלף גיבור ובלי תיוג כישורים"] };
  let raw: unknown;
  try {
    // serialise INSIDE the sandbox so getters and toJSON run under the timeout, and only plain data comes out
    const json = vm.runInNewContext(`JSON.stringify((${src}))`, Object.create(null), { timeout: 200 });
    raw = typeof json === "string" ? JSON.parse(json) : null;
  } catch (e) {
    return { meta: null, warnings: [`WOW_META לא תקין: ${(e as Error).message}`] };
  }
  if (!raw || typeof raw !== "object") return { meta: null, warnings: ["WOW_META אינו אובייקט"] };
  const o = raw as Record<string, unknown>;
  const roots: WowMeta["roots"] = [];
  if (Array.isArray(o.roots)) {
    for (const r of o.roots as unknown[]) {
      const id = r && typeof r === "object" ? String((r as { id?: unknown }).id ?? "") : "";
      const w = r && typeof r === "object" ? Number((r as { w?: unknown }).w ?? 1) : NaN;
      if (!(ROOT_IDS as readonly string[]).includes(id)) warnings.push(`WOW_META.roots: שורש לא מוכר "${id}" (המותרים: ${ROOT_IDS.join(", ")})`);
      else if (!(w > 0 && w <= 10)) warnings.push(`WOW_META.roots: משקל לא תקין ל-${id}`);
      else roots.push({ id, w: Math.round(w) });
    }
  } else warnings.push("WOW_META.roots חסר או אינו מערך");
  if (!roots.length) warnings.push("WOW_META.roots ריק — השורשים יחושבו מ-topics");
  let hero: WowMeta["hero"] = null;
  const h = o.hero as { name?: unknown; fact?: unknown } | undefined;
  if (h && typeof h === "object" && typeof h.name === "string" && typeof h.fact === "string" && h.name.trim() && h.fact.trim()) {
    if (h.fact.length > 120) warnings.push("WOW_META.hero.fact ארוך מ-120 תווים — ייחתך");
    hero = { name: h.name.trim().slice(0, 60), fact: h.fact.trim().slice(0, 120) };
  } else warnings.push("WOW_META.hero חסר (name + fact) — הקלף ישתמש בכותרת ובטיזר");
  const items: WowMeta["items"] = {};
  if (o.items && typeof o.items === "object") {
    for (const [id, v] of Object.entries(o.items as Record<string, unknown>)) {
      if (!ITEM_ID.test(id)) {
        warnings.push(`WOW_META.items: מזהה לא מבני "${id}" — מתעלמים`);
        continue;
      }
      const it = (v && typeof v === "object" ? v : {}) as { skill?: unknown; d?: unknown };
      const skill = typeof it.skill === "string" && SKILL.test(it.skill) ? it.skill : null;
      if (typeof it.skill === "string" && !skill) warnings.push(`WOW_META.items.${id}: skill "${it.skill}" אינו slug (a-z, מקפים)`);
      const d = Number(it.d);
      items[id] = { skill, d: d >= 1 && d <= 5 ? Math.round(d) : 0 };
    }
  } else warnings.push("WOW_META.items חסר — בלי תיוג כישורים");
  return { meta: { v: Number(o.v) || 1, roots, hero, items }, warnings };
}

export function extractEngineVersion(html: string): string | null {
  const m = html.match(/const\s+ENGINE_VERSION\s*=\s*['"]([^'"]{1,20})['"]/);
  return m ? m[1] : null;
}
