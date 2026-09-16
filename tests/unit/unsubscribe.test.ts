import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { freshDb } from "./setup";
import { billingMail, dailyMail, sendBatch, sendMail, setMailer, type Mail } from "@/lib/emails";
import { encryptToken } from "@/lib/tokens";
import { emailFromToken, isUnsubscribed, unsubscribe, unsubscribeToken, withoutUnsubscribed } from "@/lib/unsubscribe";
import { POST } from "@/app/api/unsubscribe/route";

const sent: Mail[] = [];

const daily = (to: string[]) =>
  dailyMail({
    to,
    editionN: 7,
    editionTitle: "המנהרה",
    editionDate: "2026-09-14",
    teaser: "שתי קבוצות חוצבים נפגשו בחושך",
    kids: [{ name: "אמה", feminine: true, streak: 0, link: "https://app.test/l/7?k=abc" }],
  });

const tokenOf = (s: string | undefined) => s?.match(/unsubscribe\?u=([A-Za-z0-9_-]+)/)?.[1];

describe("unsubscribe", () => {
  beforeAll(async () => {
    await freshDb();
    setMailer(async (m) => {
      sent.push(m);
      return { id: `re_${sent.length}` };
    });
    await unsubscribe("Savta@Example.com");
  });
  afterAll(() => setMailer(null));

  it("the token carries one normalised address and rejects forged or foreign tokens", () => {
    expect(emailFromToken(unsubscribeToken(" Mum@Example.com "))).toBe("mum@example.com");
    const t = unsubscribeToken("mum@example.com");
    expect(emailFromToken(t.slice(0, 20) + (t[20] === "A" ? "B" : "A") + t.slice(21))).toBeNull();
    expect(emailFromToken(encryptToken("a-kid-link-token"))).toBeNull();
    expect(emailFromToken("nope")).toBeNull();
    expect(emailFromToken(undefined)).toBeNull();
  });

  it("withoutUnsubscribed drops listed addresses case-insensitively, keeping order and spelling", async () => {
    expect(await withoutUnsubscribed(["A@x.com", "SAVTA@example.com", "b@x.com"])).toEqual(["A@x.com", "b@x.com"]);
  });

  it("sends one copy per recipient, each with its own link and one-click header, skipping the unsubscribed", async () => {
    sent.length = 0;
    const r = await sendMail(daily(["parent@example.com", "kid@example.com", "savta@example.com"]));
    expect(r).toEqual({ id: "re_1" });
    expect(sent.map((m) => m.to)).toEqual([["parent@example.com"], ["kid@example.com"]]);
    for (const m of sent) {
      expect(emailFromToken(tokenOf(m.html))).toBe(m.to[0]);
      expect(emailFromToken(tokenOf(m.text))).toBe(m.to[0]);
      expect(m.html).not.toContain("<!--unsubscribe-->");
      expect(m.headers?.["List-Unsubscribe-Post"]).toBe("List-Unsubscribe=One-Click");
      expect(emailFromToken(m.headers?.["List-Unsubscribe"].match(/u=([A-Za-z0-9_-]+)/)?.[1])).toBe(m.to[0]);
    }
  });

  it("a mail whose every recipient unsubscribed is not sent, and batch ids stay one per mail", async () => {
    sent.length = 0;
    expect(await sendMail(daily(["savta@example.com"]))).toEqual({ id: null, skipped: "unsubscribed" });
    const b = await sendBatch([daily(["savta@example.com"]), daily(["a@example.com", "b@example.com"])]);
    expect(b).toEqual({ results: [{ id: null, skipped: "no_recipients" }, { id: "re_1" }], ids: ["re_1"], sent: 1 });
    expect(sent).toHaveLength(2);
  });

  it("transactional mail (billing) still reaches an unsubscribed address, without a link", async () => {
    sent.length = 0;
    await sendMail(billingMail({ to: "savta@example.com", kind: "ended", kidName: "אמה" }));
    expect(sent).toHaveLength(1);
    expect(sent[0].html).not.toContain("/unsubscribe");
    expect(sent[0].text).not.toContain("/unsubscribe");
    expect(sent[0].headers).toBeUndefined();
  });

  it("POST: one-click answers 2xx, the page form redirects back, undo restores, a bad token is refused", async () => {
    const u = unsubscribeToken("dad@example.com");
    const oneClick = await POST(
      new Request(`https://app.test/api/unsubscribe?u=${u}`, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: "List-Unsubscribe=One-Click",
      }),
    );
    expect(oneClick.status).toBe(200);
    expect(await isUnsubscribed("DAD@example.com")).toBe(true);

    const undo = await POST(new Request(`https://app.test/api/unsubscribe?u=${u}&undo=1`, { method: "POST" }));
    expect(undo.status).toBe(303);
    expect(undo.headers.get("location")).toBe(`https://app.test/unsubscribe?u=${u}`);
    expect(await isUnsubscribed("dad@example.com")).toBe(false);

    const again = await POST(new Request(`https://app.test/api/unsubscribe?u=${u}`, { method: "POST" }));
    expect(again.status).toBe(303);
    expect(await isUnsubscribed("dad@example.com")).toBe(true);

    expect((await POST(new Request("https://app.test/api/unsubscribe?u=nope", { method: "POST" }))).status).toBe(400);
  });
});
