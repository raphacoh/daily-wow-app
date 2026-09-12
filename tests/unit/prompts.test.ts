import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { body, loadValues, render } from "../../scripts/render-prompts.mjs";

const ROOT = path.resolve(__dirname, "..", "..");
const TEMPLATES = path.join(ROOT, "kit", "prompts");
const EXAMPLE = path.join(ROOT, "scripts", "prompt-values.example.json");

/** The committed example is what a fresh clone has; prompt-values.json is gitignored. */
const values = loadValues(EXAMPLE);
const templates = readdirSync(TEMPLATES).filter((f) => f.endsWith(".md") && f !== "README.md");

describe("routine prompt renderer", () => {
  it("finds the templates", () => {
    expect(templates).toContain("release-routine.md");
    expect(templates).toContain("nightly-builder.md");
  });

  it.each(templates)("resolves every placeholder in %s except the secret", (file) => {
    const { out, missing } = render(body(readFileSync(path.join(TEMPLATES, file), "utf8")), values);
    expect(missing).toEqual([]);
    // the bearer key is the only thing left behind, and only because it is never written unless asked for
    for (const left of out.match(/\{\{[A-Z_]+\}\}/g) ?? []) expect(left).toBe("{{EDITOR_API_KEY}}");
  });

  it("substitutes the key only with --with-key, and says so when it cannot", () => {
    const template = "Bearer {{EDITOR_API_KEY}} for {{APP_URL}}";
    expect(render(template, values).out).toContain("{{EDITOR_API_KEY}}");

    process.env.EDITOR_API_KEY = "sk-test-123";
    expect(render(template, values, { withKey: true }).out).toBe("Bearer sk-test-123 for https://dailywow.example.com");

    delete process.env.EDITOR_API_KEY;
    const bad = render(template, values, { withKey: true });
    expect(bad.out).toContain("{{EDITOR_API_KEY}}");
    expect(bad.missing.join(" ")).toContain("EDITOR_API_KEY");
  });

  it("reports an unknown placeholder instead of rendering a half-finished prompt", () => {
    const r = render("hello {{NO_SUCH_THING}}", values);
    expect(r.missing).toEqual(["NO_SUCH_THING"]);
    expect(r.out).toContain("{{NO_SUCH_THING}}");
  });

  it("drops the template's front matter, keeping only what gets pasted", () => {
    const out = body(readFileSync(path.join(TEMPLATES, "release-routine.md"), "utf8"));
    expect(out).not.toContain("Replace every");
    expect(out.startsWith("You are the")).toBe(true);
  });
});
