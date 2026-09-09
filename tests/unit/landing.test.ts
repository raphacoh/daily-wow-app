import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { freshDb, seedEdition, seedParent } from "./setup";
import { createKid } from "@/lib/kids";
import { KID_COOKIE } from "@/lib/kidSession";
import type { Db } from "@/lib/db";

/** The cookie jar next/headers would hand a route handler. Reads only — writes go on the response. */
let jar: Record<string, string> = {};
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (jar[name] === undefined ? undefined : { name, value: jar[name] }),
    getAll: () => Object.entries(jar).map(([name, value]) => ({ name, value })),
    set: () => {},
  }),
}));

/** currentParent() is Supabase-backed; the tests decide who is signed in. */
let signedInParent: { id: string; name: string } | null = null;
vi.mock("@/lib/auth", async (orig) => ({
  ...(await orig<typeof import("@/lib/auth")>()),
  currentParent: async () => signedInParent,
}));

let db: Db;
let token: string;
const html = '<title>x</title><style></style><div class="topbar-in"></div><script>const PW_ENC = \'x\';</script>';

const home = async () => {
  const { GET } = await import("@/app/route");
  return GET(new Request("http://localhost:3000/"));
};
const lesson = async (path: string) => {
  const { GET } = await import("@/app/l/[n]/route");
  const n = path.replace(/^\/l\//, "").split("?")[0];
  return GET(new Request("http://localhost:3000" + path), { params: Promise.resolve({ n }) });
};

describe("landing by role", () => {
  beforeAll(async () => {
    db = (await freshDb()).db;
    await seedEdition(db, 1, "2026-09-07", { html });
    await seedEdition(db, 2, "2026-09-08", { html });
    const parent = await seedParent(db);
    token = (await createKid(parent, { name: "אמה", feminine: true, age: 11, grade: "ו", level: "standard" })).token;
  });
  beforeEach(() => {
    jar = {};
    signedInParent = null;
  });

  it("sends a signed-in parent to the dashboard", async () => {
    signedInParent = { id: "p", name: "רף" };
    const res = await home();
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toContain("/home");
  });

  it("shows the demo lesson to a visitor", async () => {
    const res = await home();
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toContain("window.RUNTIME");
    expect(body).toContain("rw-strip"); // the visitor strip, not the kid menu
  });

  it("remembers a kid who opens their personal link", async () => {
    const res = await lesson(`/l/2?k=${encodeURIComponent(token)}`);
    expect(res.cookies.get(KID_COOKIE)?.value).toBe(token);
    const body = await res.text();
    expect(body).toContain("rw-menu"); // a menu, never the visitor banner
    expect(body).not.toContain("rw-strip");
  });

  it("sends a remembered kid to today's lesson, with their profile and no token in the URL", async () => {
    jar[KID_COOKIE] = token;
    const res = await home();
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("http://localhost:3000/l/2");

    const page = await lesson("/l/2");
    const body = await page.text();
    expect(body).toContain('"kidToken":"' + token + '"');
    expect(body).toContain("rw-menu");
  });

  it("keeps a signed-in parent in demo mode even on a kid's device", async () => {
    jar[KID_COOKIE] = token;
    signedInParent = { id: "p", name: "רף" };
    const body = await (await lesson("/l/2")).text();
    expect(body).toContain('"kidToken":""');
    expect(body).not.toContain("rw-menu");
  });

  it("forgets a token that stopped working", async () => {
    jar[KID_COOKIE] = "gone-" + "0".repeat(38);
    const res = await home();
    expect(res.status).toBe(200);
    expect(res.cookies.get(KID_COOKIE)?.value).toBe("");
  });
});
