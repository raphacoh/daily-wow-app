import he from "./he.json";
import en from "./en.json";

type Dict = Record<string, string>;
const dicts: Record<string, Dict> = { he: he as Dict, en: en as Dict };

/** Look up a UI string. Hebrew is the product language; English exists for the landing-page toggle only. */
export function t(key: string, vars: Record<string, string | number> = {}, locale: "he" | "en" = "he"): string {
  const s = dicts[locale]?.[key] ?? dicts.he[key] ?? key;
  return s.replace(/\{(\w+)\}/g, (_, k) => String(vars[k] ?? `{${k}}`));
}

/** Gendered form: "סיים|סיימי" → picks by `feminine`. */
export function g(pair: string, feminine: boolean): string {
  const [m, f] = pair.split("|");
  return feminine ? (f ?? m) : m;
}
