import { beforeAll, describe, expect, it } from "vitest";
import { freshDb, seedEdition, seedParent } from "./setup";
import { createKid } from "@/lib/kids";
import type { Db } from "@/lib/db";

let db: Db;
let token: string;
const html = "<title>x</title><style></style><div class=\"tracks\"></div><script>const RUNTIME=1;</script>";

describe("GET /l/[n]: only the demo edition is open to everyone", () => {
  beforeAll(async () => {
    db = (await freshDb()).db;
    await seedEdition(db, 1, "2026-09-07", { html });
    await seedEdition(db, 2, "2026-09-08", { html });
    await seedEdition(db, 3, "2026-09-09", { html, status: "staged" });
    const parent = await seedParent(db);
    token = (await createKid(parent, { name: "אמה", feminine: true, age: 11, grade: "ו", level: "standard" })).token;
  });

  const get = async (path: string) => {
    const { GET } = await import("@/app/l/[n]/route");
    const n = path.replace(/^\/l\//, "").split("?")[0];
    const res = await GET(new Request("http://localhost:3000" + path), { params: Promise.resolve({ n }) });
    return { status: res.status, body: await res.text() };
  };

  it("serves edition 1 to anyone (demo)", async () => {
    const r = await get("/l/1");
    expect(r.status).toBe(200);
    expect(r.body).toContain("window.RUNTIME");
  });

  it("shows the followers page for edition 2 without a link", async () => {
    const r = await get("/l/2");
    expect(r.status).toBe(200);
    expect(r.body).toContain("לעוקבים");
    expect(r.body).toContain("/join");
    expect(r.body).not.toContain("window.RUNTIME");
  });

  it("serves edition 2 with a kid's personal link", async () => {
    const r = await get(`/l/2?k=${encodeURIComponent(token)}`);
    expect(r.status).toBe(200);
    expect(r.body).toContain("window.RUNTIME");
    expect(r.body).toContain('"kidToken":"' + token + '"');
  });

  it("keeps 404 for unreleased or unknown editions", async () => {
    expect((await get("/l/3")).status).toBe(404);
    expect((await get("/l/99")).status).toBe(404);
  });
});
