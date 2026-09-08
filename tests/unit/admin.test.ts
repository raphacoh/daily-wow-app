/**
 * The editor's side: staging gate, the release/hold state machine, config round-trip, and the bearer-key
 * gate in front of /api/admin — including one real HTTP round trip through the route module.
 */
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { freshDb, seedParent } from "./setup";
import type { Db } from "@/lib/db";
import { getConfig, invalidateConfigCache } from "@/lib/config";
import { isEditorApiKey } from "@/lib/auth";
import {
  adminStats,
  editionHistory,
  findParentByEmail,
  holdEdition,
  listAdminEditions,
  listMenus,
  listTopicIdeas,
  recentFamilies,
  releaseEdition,
  saveMenu,
  setConfig,
  stageEdition,
  StageError,
  stripTitlePrefix,
  validateFragment,
} from "@/lib/admin";
import { setMailer } from "@/lib/emails";

const EDITION_1 = path.join(process.cwd(), "editions/e/001/edition.html");

let db: Db;
let fragment: string;

beforeAll(async () => {
  fragment = await fs.readFile(EDITION_1, "utf8");
});

beforeEach(async () => {
  ({ db } = await freshDb());
  invalidateConfigCache();
  // No mail leaves a test run, and no `sendDaily` needs Resend to be configured.
  setMailer(async () => ({ id: "test" }));
  delete process.env.EDITOR_API_KEY;
  delete process.env.EDITIONS_WRITE_LOCAL;
  delete process.env.EDITIONS_DIR;
});

afterEach(() => {
  setMailer(null);
  delete process.env.EDITOR_API_KEY;
});

function stageInput(over: Record<string, unknown> = {}) {
  return {
    n: 1,
    date: "2026-09-07",
    topics: ["גאוגרפיה", "מתמטיקה"],
    summary: "Eratosthenes measures the Earth.",
    teaser: "מקל, צל, וכדור הארץ.",
    reviewer_verdict: "PASS",
    review_url: "https://example.com/review/1",
    html: fragment,
    ...over,
  } as Parameters<typeof stageEdition>[0];
}

describe("fragment validation", () => {
  it("accepts the real edition #1", () => {
    expect(validateFragment(fragment)).toEqual([]);
  });

  it("rejects a fragment without the runtime bootstrap", () => {
    const broken = fragment.replace(/RUNTIME/g, "XUNTIME");
    const problems = validateFragment(broken);
    expect(problems.length).toBe(1);
    expect(problems[0]).toContain("RUNTIME");
  });

  it("rejects a whole document", () => {
    expect(validateFragment("<!doctype html>" + fragment).join(" ")).toContain("doctype");
  });

  it("names every missing piece", () => {
    const problems = validateFragment("<p>שלום</p>");
    expect(problems.length).toBe(6);
  });

  it("strips the series prefix from the page title", () => {
    expect(stripTitlePrefix("שורשים וכנפיים #1 · המקל שמדד את כדור הארץ")).toBe("המקל שמדד את כדור הארץ");
    expect(stripTitlePrefix("כותרת בלי תחילית")).toBe("כותרת בלי תחילית");
  });
});

describe("stageEdition", () => {
  it("refuses a fragment without RUNTIME", async () => {
    const broken = fragment.replace(/RUNTIME/g, "XUNTIME");
    await expect(stageEdition(stageInput({ html: broken }))).rejects.toBeInstanceOf(StageError);
    const rows = await db.query("select n from editions");
    expect(rows.rows.length).toBe(0);
  });

  it("stages edition #1 from disk, extracting the context and the password", async () => {
    const e = await stageEdition(stageInput());
    expect(e.n).toBe(1);
    expect(e.status).toBe("staged");
    expect(e.code).toBe("WOW-001");
    expect(e.password).toBe("הצל של בטא");
    expect(e.title).toBe("המקל שמדד את כדור הארץ");
    expect(e.lesson_context.length).toBeGreaterThan(0);
    expect(e.grading_context.length).toBeGreaterThan(0);
    expect(e.reviewer_verdict).toBe("PASS");
    expect(e.teaser).toBe("מקל, צל, וכדור הארץ.");
  });

  it("lets a staged edition be restaged, and a held one too", async () => {
    await stageEdition(stageInput());
    const again = await stageEdition(stageInput({ title: "כותרת חדשה" }));
    expect(again.title).toBe("כותרת חדשה");
    await holdEdition(1);
    const third = await stageEdition(stageInput({ title: "אחרי החזקה" }));
    expect(third.status).toBe("staged");
    expect(third.title).toBe("אחרי החזקה");
  });
});

describe("release / hold", () => {
  it("flips the status, stamps released_at, and refuses to restage afterwards", async () => {
    await stageEdition(stageInput());
    const { edition, send } = await releaseEdition(1, { editor_note: "שווה לקרוא עד הסוף", edited_by_editor: true });
    expect(edition.status).toBe("released");
    expect(edition.released_at).toBeTruthy();
    expect(edition.editor_note).toBe("שווה לקרוא עד הסוף");
    expect(edition.edited_by_editor).toBe(true);
    expect(send).not.toBeNull();
    expect(send!.errors).toEqual([]);

    await expect(stageEdition(stageInput())).rejects.toThrow(/שוחרר/);
    await expect(releaseEdition(1)).rejects.toBeInstanceOf(StageError);
  });

  it("releases without sending when send:false", async () => {
    await stageEdition(stageInput());
    const { send } = await releaseEdition(1, { send: false });
    expect(send).toBeNull();
  });

  it("holds a staged edition", async () => {
    await stageEdition(stageInput());
    const held = await holdEdition(1);
    expect(held.status).toBe("held");
    const row = await db.query<{ held_at: string | null }>("select held_at from editions where n = 1");
    expect(row.rows[0].held_at).toBeTruthy();
    // a held edition can still be released later
    const { edition } = await releaseEdition(1, { send: false });
    expect(edition.status).toBe("released");
  });

  it("throws on an edition that does not exist", async () => {
    await expect(releaseEdition(99)).rejects.toBeInstanceOf(StageError);
    await expect(holdEdition(99)).rejects.toBeInstanceOf(StageError);
  });
});

describe("local content folder", () => {
  it("writes e/NNN + editions.json + topics.json only when EDITIONS_WRITE_LOCAL=1", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "wow-editions-"));
    process.env.EDITIONS_DIR = dir;
    process.env.EDITIONS_WRITE_LOCAL = "1";
    try {
      await stageEdition(stageInput());
      await releaseEdition(1, { send: false });
      const html = await fs.readFile(path.join(dir, "e/001/edition.html"), "utf8");
      expect(html).toBe(fragment);
      const meta = JSON.parse(await fs.readFile(path.join(dir, "e/001/meta.json"), "utf8"));
      expect(meta).toMatchObject({ n: 1, code: "WOW-001", status: "released", password: "הצל של בטא" });
      expect(JSON.parse(await fs.readFile(path.join(dir, "editions.json"), "utf8"))).toEqual([
        { n: 1, date: "2026-09-07", title: "המקל שמדד את כדור הארץ", path: "e/001/" },
      ]);
      expect(JSON.parse(await fs.readFile(path.join(dir, "topics.json"), "utf8"))[0].topics).toEqual(["גאוגרפיה", "מתמטיקה"]);

      // a second release replaces the entry rather than appending a duplicate
      await stageEdition(stageInput({ n: 2, date: "2026-09-08", title: "שני" }));
      await releaseEdition(2, { send: false });
      const list = JSON.parse(await fs.readFile(path.join(dir, "editions.json"), "utf8"));
      expect(list.map((e: { n: number }) => e.n)).toEqual([1, 2]);
    } finally {
      delete process.env.EDITIONS_DIR;
      delete process.env.EDITIONS_WRITE_LOCAL;
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it("writes nothing when the flag is off", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "wow-editions-"));
    process.env.EDITIONS_DIR = dir;
    try {
      await stageEdition(stageInput());
      await releaseEdition(1, { send: false });
      expect(await fs.readdir(dir)).toEqual([]);
    } finally {
      delete process.env.EDITIONS_DIR;
      await fs.rm(dir, { recursive: true, force: true });
    }
  });
});

describe("listAdminEditions / history", () => {
  it("lists every status and never leaks the html or the password", async () => {
    await stageEdition(stageInput());
    await stageEdition(stageInput({ n: 2, date: "2026-09-08", title: "גיליון שני" }));
    await releaseEdition(1, { send: false });
    const list = await listAdminEditions();
    expect(list.map((e) => e.n)).toEqual([2, 1]);
    expect(list[1].status).toBe("released");
    expect(list[0].has_html).toBe(true);
    expect(JSON.stringify(list)).not.toContain("הצל של בטא");
    expect(JSON.stringify(list)).not.toContain("checkChallenge");

    const history = await editionHistory();
    expect(history.map((h) => h.title)).toContain("גיליון שני");
    expect(history[1].topics).toContain("גאוגרפיה");
  });
});

describe("config", () => {
  it("round-trips through getConfig", async () => {
    expect(await getConfig("assistant_daily_cap")).toBe("30");
    await setConfig("assistant_daily_cap", "42");
    expect(await getConfig("assistant_daily_cap")).toBe("42");
    await setConfig("brand_new_key", "hello");
    expect(await getConfig("brand_new_key")).toBe("hello");
  });

  it("rejects an empty key", async () => {
    await expect(setConfig("", "x")).rejects.toBeInstanceOf(StageError);
  });
});

describe("families, menus, ideas, stats", () => {
  it("finds a family by email and lists recent registrations", async () => {
    const id = await seedParent(db, { email: "Dana@Example.com".toLowerCase(), name: "דנה כהן" });
    await db.query(
      "insert into kids (parent_id, name, age, grade, link_token_hash) values ($1,'עמית',9,'ד',$2)",
      [id, "hash-1"],
    );
    const found = await findParentByEmail("DANA@example.com");
    expect(found?.name).toBe("דנה כהן");
    expect(found?.kids).toBe(1);
    expect(found?.children[0].name).toBe("עמית");
    expect(await findParentByEmail("nobody@example.com")).toBeNull();

    const recent = await recentFamilies(5);
    expect(recent.length).toBe(1);
    expect(recent[0].kids).toBe(1);
  });

  it("saves and lists topic menus", async () => {
    await saveMenu(7, { for_date: "2026-09-14", options: [{ k: 1, title: "הרי געש" }], default_k: 1 });
    await saveMenu(7, { chosen: "1", chosen_title: "הרי געש", decided_by: "parent" });
    const menus = await listMenus();
    expect(menus.length).toBe(1);
    expect(menus[0].chosen_title).toBe("הרי געש");
    expect(menus[0].default_k).toBe(1);
    expect(menus[0].options).toEqual([{ k: 1, title: "הרי געש" }]);
  });

  it("lists unused topic ideas with a first name only", async () => {
    const id = await seedParent(db, { email: "mik@example.com", name: "מיק לוי" });
    await db.query("insert into topic_ideas (parent_id, text) values ($1, 'תמנונים')", [id]);
    const ideas = await listTopicIdeas();
    expect(ideas[0].text).toBe("תמנונים");
    expect(ideas[0].from).toBe("מיק");
  });

  it("counts the month and the off-topic share per edition", async () => {
    const parentId = await seedParent(db, { email: "usage@example.com" });
    const kid = await db.query<{ id: string }>(
      "insert into kids (parent_id, name, age, grade, link_token_hash) values ($1,'נועה',10,'ה',$2) returning id",
      [parentId, "hash-usage"],
    );
    const kidId = kid.rows[0].id;
    await stageEdition(stageInput());
    for (const scope of ["lesson", "lesson", "off"]) {
      await db.query(
        "insert into usage (kid_id, edition_n, kind, scope, input_tokens, output_tokens, cost_estimate, off_prompt) values ($1,1,'chat',$2::usage_scope,10,20,0.5,$3)",
        [kidId, scope, scope === "off" ? "מה השם שלך" : null],
      );
    }
    await db.query("insert into job_runs (job, ok, detail) values ('daily', true, 'ok')");

    const stats = await adminStats();
    expect(stats.families).toBe(1);
    expect(stats.kids).toBe(1);
    expect(stats.month.messages).toBe(3);
    expect(stats.month.cost).toBeCloseTo(1.5, 5);
    expect(stats.scope[0]).toMatchObject({ edition_n: 1, messages: 3, off: 1 });
    expect(stats.scope[0].pct).toBeCloseTo(33.3, 1);
    expect(stats.scope[0].alert).toBe(true); // 33% > the 10% alert threshold
    expect(stats.offPrompts[0].text).toBe("מה השם שלך");
    expect(stats.jobs[0].job).toBe("daily");
  });
});

describe("isEditorApiKey", () => {
  it("is closed when EDITOR_API_KEY is unset", () => {
    delete process.env.EDITOR_API_KEY;
    expect(isEditorApiKey("Bearer anything")).toBe(false);
    expect(isEditorApiKey(null)).toBe(false);
  });

  it("matches only the exact bearer token", () => {
    process.env.EDITOR_API_KEY = "s3cret-key";
    expect(isEditorApiKey("Bearer s3cret-key")).toBe(true);
    expect(isEditorApiKey("bearer s3cret-key")).toBe(true);
    expect(isEditorApiKey("Bearer s3cret-keyy")).toBe(false);
    expect(isEditorApiKey("Bearer wrong")).toBe(false);
    expect(isEditorApiKey("s3cret-key")).toBe(false);
    expect(isEditorApiKey(null)).toBe(false);
  });
});

describe("POST /api/admin/editions (route module)", () => {
  const url = "http://localhost:3000/api/admin/editions";

  async function route() {
    return import("@/app/api/admin/editions/route");
  }

  function post(headers: Record<string, string>, payload: unknown) {
    return new Request(url, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(payload) });
  }

  it("401s without the bearer header", async () => {
    process.env.EDITOR_API_KEY = "route-key";
    const { POST } = await route();
    const res = await POST(post({}, stageInput()));
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "unauthorized" });
    expect((await db.query("select n from editions")).rows.length).toBe(0);
  });

  it("201s with the bearer header and stages the edition", async () => {
    process.env.EDITOR_API_KEY = "route-key";
    const { POST } = await route();
    const res = await POST(post({ authorization: "Bearer route-key" }, stageInput()));
    expect(res.status).toBe(201);
    const body = (await res.json()) as { edition: Record<string, unknown> };
    expect(body.edition.n).toBe(1);
    expect(body.edition.status).toBe("staged");
    expect(body.edition.html).toBeUndefined();
    expect(body.edition.password).toBeUndefined();
    expect((await db.query("select n from editions")).rows.length).toBe(1);
  });

  it("400s on a fragment that fails the gate", async () => {
    process.env.EDITOR_API_KEY = "route-key";
    const { POST } = await route();
    const res = await POST(post({ authorization: "Bearer route-key" }, stageInput({ html: "<p>לא פראגמנט תקין</p>" })));
    expect(res.status).toBe(400);
    const body = (await res.json()) as { problems: string[] };
    expect(body.problems.length).toBeGreaterThan(0);
  });

  it("GET lists editions for a bearer caller and 401s without one", async () => {
    process.env.EDITOR_API_KEY = "route-key";
    await stageEdition(stageInput());
    const { GET } = await route();
    expect((await GET(new Request(url))).status).toBe(401);
    const res = await GET(new Request(url + "?limit=5", { headers: { authorization: "Bearer route-key" } }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { editions: Record<string, unknown>[] };
    expect(body.editions.length).toBe(1);
    expect(body.editions[0].title).toBe("המקל שמדד את כדור הארץ");
    expect(body.editions[0].html).toBeUndefined();
    expect(body.editions[0].password).toBeUndefined();
  });
});
