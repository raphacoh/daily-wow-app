/**
 * Editions: load a released edition (Postgres, or the local `editions/` folder in dev), extract the
 * assistant material from the fragment, and wrap the fragment into a full document with the RUNTIME bootstrap.
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import { db, hasDb } from "./db";
import { APP } from "./config";

export interface EditionMeta {
  n: number;
  code: string;
  date: string;
  language: string;
  title: string;
  topics: string[];
  summary: string;
  teaser: string;
  max_score: number;
  status: "staged" | "released" | "held";
  editor_note: string | null;
  released_at: string | null;
  reviewer_verdict?: string | null;
  review_url?: string | null;
  edited_by_editor?: boolean;
}

export interface EditionFull extends EditionMeta {
  html: string;
  password: string;
  lesson_context: string;
  grading_context: string;
}

export const EDITIONS_DIR = process.env.EDITIONS_DIR || path.join(process.cwd(), "editions");

export function pad3(n: number): string {
  return String(n).padStart(3, "0");
}

function fromRow(r: Record<string, unknown>): EditionFull {
  const html = String(r.html ?? "");
  // Released editions carry the assistant material in their own columns; when a row predates that step
  // (or was written without it) fall back to the fragment, so ארטו is never left without the lesson.
  const stored = { lesson_context: String(r.lesson_context ?? ""), grading_context: String(r.grading_context ?? "") };
  const ctx = stored.lesson_context || stored.grading_context ? stored : extractAssistantContext(html);
  return {
    n: Number(r.n),
    code: String(r.code),
    date: String(r.date instanceof Date ? (r.date as Date).toISOString().slice(0, 10) : r.date),
    language: String(r.language ?? "he"),
    title: String(r.title),
    topics: (r.topics as string[]) ?? [],
    summary: String(r.summary ?? ""),
    teaser: String(r.teaser ?? ""),
    max_score: Number(r.max_score ?? 11),
    status: r.status as EditionFull["status"],
    editor_note: (r.editor_note as string | null) ?? null,
    released_at: r.released_at ? new Date(r.released_at as string).toISOString() : null,
    reviewer_verdict: (r.reviewer_verdict as string | null) ?? null,
    review_url: (r.review_url as string | null) ?? null,
    edited_by_editor: !!r.edited_by_editor,
    html,
    password: String(r.password ?? ""),
    lesson_context: ctx.lesson_context,
    grading_context: ctx.grading_context,
  };
}

/** Local folder fallback (dev, tests, and the seed): editions/e/NNN/{edition.html,meta.json}. */
export async function loadLocalEdition(n: number): Promise<EditionFull | null> {
  const dir = path.join(/*turbopackIgnore: true*/ EDITIONS_DIR, "e", pad3(n));
  try {
    const [html, metaRaw] = await Promise.all([fs.readFile(path.join(dir, "edition.html"), "utf8"), fs.readFile(path.join(dir, "meta.json"), "utf8")]);
    const meta = JSON.parse(metaRaw);
    const ctx = extractAssistantContext(html);
    return {
      n,
      code: meta.code ?? `WOW-${pad3(n)}`,
      date: meta.date,
      language: meta.language ?? "he",
      title: meta.title,
      topics: meta.topics ?? [],
      summary: meta.summary ?? "",
      teaser: meta.teaser ?? "",
      max_score: meta.max_score ?? 11,
      status: meta.status ?? "released",
      editor_note: meta.editor_note ?? null,
      released_at: meta.released_at ?? null,
      reviewer_verdict: meta.reviewer_verdict ?? null,
      review_url: meta.review_url ?? null,
      html,
      password: meta.password ?? decodePw(html),
      lesson_context: ctx.lesson_context,
      grading_context: ctx.grading_context,
    };
  } catch {
    return null;
  }
}

export async function listLocalEditions(): Promise<EditionMeta[]> {
  try {
    const raw = await fs.readFile(path.join(/*turbopackIgnore: true*/ EDITIONS_DIR, "editions.json"), "utf8");
    const list = JSON.parse(raw) as Array<{ n: number; date: string; title: string }>;
    const out: EditionMeta[] = [];
    for (const e of list) {
      const full = await loadLocalEdition(e.n);
      if (full) {
        const { html: _h, password: _p, lesson_context: _l, grading_context: _g, ...meta } = full;
        void _h; void _p; void _l; void _g;
        out.push(meta);
      }
    }
    return out.sort((a, b) => b.n - a.n);
  } catch {
    return [];
  }
}

export async function getEdition(n: number, opts: { includeStaged?: boolean } = {}): Promise<EditionFull | null> {
  if (hasDb()) {
    const r = await db().query("select * from editions where n = $1", [n]);
    const row = r.rows[0];
    if (row) {
      const e = fromRow(row);
      if (e.status === "released" || opts.includeStaged) return e;
      return null;
    }
  }
  const local = await loadLocalEdition(n);
  if (!local) return null;
  if (local.status === "released" || opts.includeStaged) return local;
  return null;
}

export async function listEditions(opts: { includeStaged?: boolean; limit?: number } = {}): Promise<EditionMeta[]> {
  if (hasDb()) {
    const r = await db().query(
      `select n, code, date, language, title, topics, summary, teaser, max_score, status, editor_note, released_at, reviewer_verdict, review_url, edited_by_editor
       from editions ${opts.includeStaged ? "" : "where status = 'released'"} order by n desc limit $1`,
      [opts.limit ?? 500],
    );
    return r.rows.map((row) => {
      const e = fromRow(row);
      const { html: _h, password: _p, lesson_context: _l, grading_context: _g, ...meta } = e;
      void _h; void _p; void _l; void _g;
      return meta;
    });
  }
  const local = await listLocalEditions();
  return (opts.includeStaged ? local : local.filter((e) => e.status === "released")).slice(0, opts.limit ?? 500);
}

export async function latestReleased(): Promise<EditionMeta | null> {
  const list = await listEditions({ limit: 1 });
  return list[0] ?? null;
}

/* ---------- fragment parsing ---------- */

/** Parse one JS string literal starting at `i` (quote char at html[i]). Returns [value, endIndex]. */
function readStringLiteral(s: string, i: number): [string, number] {
  const q = s[i];
  let out = "";
  for (let j = i + 1; j < s.length; j++) {
    const c = s[j];
    if (c === "\\") {
      const nx = s[j + 1];
      if (nx === "n") out += "\n";
      else if (nx === "t") out += "\t";
      else if (nx === "u") { out += String.fromCharCode(parseInt(s.slice(j + 2, j + 6), 16)); j += 4; }
      else out += nx;
      j++;
      continue;
    }
    if (c === q) return [out, j + 1];
    out += c;
  }
  return [out, s.length];
}

/** Read `const NAME = '…'` (a single string literal, possibly concatenated with +). */
export function readJsStringConst(html: string, name: string): string {
  const m = new RegExp(`const\\s+${name}\\s*=\\s*`).exec(html);
  if (!m) return "";
  let i = m.index + m[0].length;
  let out = "";
  for (;;) {
    while (/\s/.test(html[i] ?? "")) i++;
    const c = html[i];
    if (c === "'" || c === '"' || c === "`") {
      const [v, end] = readStringLiteral(html, i);
      out += v;
      i = end;
      while (/\s/.test(html[i] ?? "")) i++;
      if (html[i] === "+") { i++; continue; }
    }
    break;
  }
  return out;
}

/** Read `const NAME = [ '…', '…' ]` (an array of string literals). */
export function readJsStringArrayConst(html: string, name: string): string[] {
  const m = new RegExp(`const\\s+${name}\\s*=\\s*\\[`).exec(html);
  if (!m) return [];
  let i = m.index + m[0].length;
  const out: string[] = [];
  let depth = 1;
  while (i < html.length && depth > 0) {
    const c = html[i];
    if (c === "'" || c === '"' || c === "`") {
      const [v, end] = readStringLiteral(html, i);
      out.push(v);
      i = end;
      continue;
    }
    if (c === "[") depth++;
    if (c === "]") depth--;
    i++;
  }
  return out;
}

/** The daily secret, from PW_ENC (base64 of the reversed UTF-8 string). */
export function decodePw(html: string): string {
  const enc = readJsStringConst(html, "PW_ENC");
  if (!enc) return "";
  try {
    return Buffer.from(enc, "base64").toString("utf8").split("").reverse().join("");
  } catch {
    return "";
  }
}

export function extractAssistantContext(html: string): { lesson_context: string; grading_context: string } {
  const lesson_context = readJsStringConst(html, "LESSON_CONTEXT");
  const model = readJsStringConst(html, "MODEL");
  const rubric = readJsStringArrayConst(html, "RUBRIC").map((r) => r.replace(/<[^>]+>/g, ""));
  const grading_context = [
    model ? "ההסבר של המורה (התשובה המלאה): " + model.replace(/<[^>]+>/g, "") : "",
    rubric.length ? "הרעיונות המרכזיים שצריכים להופיע בהסבר:\n" + rubric.map((r, i) => `(${i + 1}) ${r}`).join("\n") : "",
  ]
    .filter(Boolean)
    .join("\n\n");
  return { lesson_context, grading_context };
}

export function extractTitle(html: string): string {
  const m = /<title>([^<]*)<\/title>/.exec(html);
  return m ? m[1].trim() : "";
}

/* ---------- document wrapping ---------- */

export interface RuntimeBootstrap {
  api: string;
  kidToken: string;
  edition: { n: number; code: string; date: string; title: string };
  library: string;
  profile?: unknown;
}

const SKELETON_STYLE = `:root{color-scheme:light dark}body{margin:0}img{max-width:100%}[hidden]{display:none!important}`;

/** Same wrapping the release routine does, plus the RUNTIME script before the fragment. */
export function wrapEdition(fragment: string, runtime: RuntimeBootstrap | null, lang = "he", dir = "rtl", opts: { index?: boolean; prepend?: string } = {}): string {
  const head: string[] = [];
  let body = fragment;
  body = body.replace(/<title>[\s\S]*?<\/title>\s*/i, (m) => { head.push(m.trim()); return ""; });
  body = body.replace(/<link\b[^>]*>\s*/gi, (m) => { head.push(m.trim()); return ""; });
  const rt = runtime ? `<script>window.RUNTIME=${JSON.stringify(runtime).replace(/</g, "\\u003c")};</script>\n` : "";
  return (
    `<!doctype html><html lang="${lang}" dir="${dir}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">` +
    (opts.index ? `<meta name="description" content="שיעור אחד ביום, מהורים לילדים. חינם.">` : `<meta name="robots" content="noindex">`) +
    `<style>${SKELETON_STYLE}</style>` +
    head.join("") +
    `</head><body>${rt}${opts.prepend ?? ""}${body}</body></html>`
  );
}

export function libraryUrl(): string {
  return `${APP.url}/library`;
}
