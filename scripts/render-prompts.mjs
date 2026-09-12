/**
 * Render the routine prompts from their templates.
 *
 *   node scripts/render-prompts.mjs                  → build/prompts/*.md, key left as {{EDITOR_API_KEY}}
 *   node scripts/render-prompts.mjs --with-key       → same, with EDITOR_API_KEY from the environment
 *   node scripts/render-prompts.mjs --stdout release-routine
 *
 * Why this exists: the three prompts in `kit/prompts/` are templates, but the versions actually running
 * live only inside the routine editors at claude.ai/code/routines and in Cowork. Overwrite one there and
 * the day's lesson has no way out — that is not hypothetical, it cost an edition. This makes the running
 * copy reproducible from the repo in one command.
 *
 * Values come from `scripts/prompt-values.json` (copy the .example, gitignored), then the environment,
 * then the defaults below. The bearer key is deliberately NOT one of them: it is only ever substituted
 * with an explicit --with-key, so a careless run cannot leave a secret sitting in build/.
 */
import { readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync } from "node:fs";
import path from "node:path";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const TEMPLATES = path.join(ROOT, "kit", "prompts");
const OUT = path.join(ROOT, "build", "prompts");

/** Templates only; README.md documents them and is not itself a prompt. */
const SKIP = new Set(["README.md"]);

/** The placeholder the operator pastes by hand, unless --with-key. */
const KEY = "EDITOR_API_KEY";

const DEFAULTS = {
  SERIES_NAME: "שורשים וכנפיים",
  ASSISTANT_NAME: "ארטו",
  LANGUAGE: "Hebrew",
  SPEECH_LOCALE: "he-IL",
  PARENT_LANGUAGE: "Hebrew or English",
  CHALLENGE_WORD: "אתגר",
  MENU_TIME: "07:30",
  BUILD_TIME: "02:00",
  RELEASE_TIME: "11:00",
  HTML_LANG: "he",
  HTML_DIR: "rtl",
};

/** Placeholders an environment variable can supply, for a deployment with no values file. */
const FROM_ENV = {
  APP_URL: () => process.env.NEXT_PUBLIC_APP_URL?.replace(/\/+$/, ""),
  PARENT_NAME: () => process.env.EDITOR_NAME,
  PARENT_EMAIL: () => process.env.EDITOR_EMAIL,
  TIMEZONE: () => process.env.EDITOR_TIMEZONE,
  GITHUB_USER: () => process.env.EDITIONS_REPO_URL?.match(/github\.com\/([^/]+)\//)?.[1],
};

export function loadValues(file = path.join(ROOT, "scripts", "prompt-values.json")) {
  const fromFile = existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : {};
  const values = { ...DEFAULTS };
  for (const [name, read] of Object.entries(FROM_ENV)) {
    const v = read();
    if (v) values[name] = v;
  }
  // The file wins over the environment: it is the deployment's deliberate answer.
  for (const [k, v] of Object.entries(fromFile)) {
    if (!k.startsWith("_") && typeof v === "string") values[k] = v;
  }
  return values;
}

/** Substitute, and report every placeholder left unresolved so a half-rendered prompt is never pasted. */
export function render(template, values, { withKey = false } = {}) {
  const missing = new Set();
  const out = template.replace(/\{\{([A-Z_]+)\}\}/g, (whole, name) => {
    if (name === KEY) {
      const key = withKey ? process.env[KEY] : null;
      if (withKey && !key) missing.add(`${KEY} (--with-key was passed but the environment has none)`);
      return key || whole;
    }
    if (name === "PLACEHOLDER") return whole; // the templates' own prose about placeholders
    if (values[name] === undefined) {
      missing.add(name);
      return whole;
    }
    return values[name];
  });
  return { out, missing: [...missing] };
}

/** The prompt body: everything after the template's `---` front matter, which is instructions to the reader. */
export function body(template) {
  const i = template.indexOf("\n---\n");
  return (i === -1 ? template : template.slice(i + 5)).trim() + "\n";
}

function main(argv) {
  const withKey = argv.includes("--with-key");
  const only = argv[argv.indexOf("--stdout") + 1];
  const toStdout = argv.includes("--stdout");
  const values = loadValues();
  const files = readdirSync(TEMPLATES).filter((f) => f.endsWith(".md") && !SKIP.has(f));

  if (!toStdout) mkdirSync(OUT, { recursive: true });
  let problems = 0;

  for (const f of files) {
    const name = f.replace(/\.md$/, "");
    if (toStdout && only && name !== only) continue;
    const { out, missing } = render(body(readFileSync(path.join(TEMPLATES, f), "utf8")), values, { withKey });
    if (missing.length) {
      problems++;
      console.error(`${f}: unresolved ${missing.join(", ")}`);
    }
    if (toStdout) {
      process.stdout.write(out);
    } else {
      writeFileSync(path.join(OUT, f), out);
      console.log(`${path.relative(ROOT, path.join(OUT, f))}${missing.length ? "  (incomplete)" : ""}`);
    }
  }

  if (!toStdout && !withKey) console.log(`\nPaste {{${KEY}}} by hand, or re-run with --with-key and ${KEY} set.`);
  process.exit(problems ? 1 : 0);
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname)) {
  main(process.argv.slice(2));
}
