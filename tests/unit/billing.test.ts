/**
 * Billing (PRD §6.7, M3 acceptance). The webhook is exercised end to end: a really signed Standard
 * Webhooks payload goes into the route, and `isEntitled` — the one entitlement function the assistant
 * asks — is what we assert on afterwards.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { Webhook } from "standardwebhooks";
import { freshDb, seedParent } from "./setup";
import { createKid } from "@/lib/kids";
import { isEntitled } from "@/lib/arto";
import { subscriptionStatusFor } from "@/lib/billing";
import type { Db } from "@/lib/db";

const SECRET = Buffer.from("daily-wow-test-webhook-secret-0123").toString("base64");
process.env.DODO_PAYMENTS_WEBHOOK_KEY = SECRET;
delete process.env.RESEND_API_KEY; // mails are skipped, not sent
delete process.env.DODO_PAYMENTS_API_KEY; // no portal link lookups over the network

// imported after the env is set — the route reads the key per request, but this keeps the intent obvious
const { POST: dodoWebhook } = await import("@/app/api/webhooks/dodo/route");

const wh = new Webhook(SECRET);
const DAY = 86_400_000;
const inDays = (n: number) => new Date(Date.now() + n * DAY);

let db: Db;
let parentId: string;

/** Build the Dodo subscription payload the docs describe. */
function subEvent(type: string, o: { subId: string; kidId?: string; status?: string; nextBilling?: Date | null; cancelAtNext?: boolean; customerId?: string }) {
  return {
    business_id: "biz_test",
    type,
    timestamp: new Date().toISOString(),
    data: {
      payload_type: "Subscription",
      subscription_id: o.subId,
      status: o.status ?? "active",
      next_billing_date: o.nextBilling === null ? null : (o.nextBilling ?? inDays(30)).toISOString(),
      previous_billing_date: inDays(-1).toISOString(),
      customer: { customer_id: o.customerId ?? "cus_test", email: "parent@example.com", name: "הורה" },
      metadata: o.kidId ? { kid_id: o.kidId, parent_id: parentId } : {},
      product_id: "prod_arto",
      cancelled_at: null,
      cancel_at_next_billing_date: !!o.cancelAtNext,
      quantity: 1,
    },
  };
}

/** POST a genuinely signed webhook at the route. `tamper` flips one byte of the signature. */
async function post(id: string, body: object, opts: { tamper?: boolean } = {}) {
  const raw = JSON.stringify(body);
  const at = new Date();
  let sig = wh.sign(id, at, raw);
  if (opts.tamper) sig = sig.slice(0, -2) + (sig.endsWith("AA") ? "BB" : "AA");
  return dodoWebhook(
    new Request("http://localhost/api/webhooks/dodo", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "webhook-id": id,
        "webhook-timestamp": String(Math.floor(at.getTime() / 1000)),
        "webhook-signature": sig,
      },
      body: raw,
    }),
  );
}

async function newKid(name: string): Promise<string> {
  return (await createKid(parentId, { name, feminine: false, age: 10, grade: "ה", level: "standard" })).id;
}

const count = async (sql: string, params: unknown[] = []) => Number((await db.query<{ c: string }>(sql, params)).rows[0].c);

describe("billing webhooks → entitlement", () => {
  beforeAll(async () => {
    db = (await freshDb()).db;
    parentId = await seedParent(db, { email: "parent@example.com" });
  });

  it("activates a kid from a signed subscription.active, and replays are no-ops", async () => {
    const kid = await newKid("אדם");
    const res = await post("evt_active_1", subEvent("subscription.active", { subId: "sub_A", kidId: kid }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ received: true });
    expect(await isEntitled(kid)).toBe(true);
    expect((await subscriptionStatusFor(kid)).status).toBe("active");

    // same webhook-id again: still 200 (Dodo must not retry), but nothing is written twice
    const replay = await post("evt_active_1", subEvent("subscription.active", { subId: "sub_A", kidId: kid }));
    expect(replay.status).toBe(200);
    expect(await count("select count(*)::text c from webhook_events where id = $1", ["evt_active_1"])).toBe(1);
    expect(await count("select count(*)::text c from subscriptions where kid_id = $1", [kid])).toBe(1);
  });

  it("rejects a tampered signature with 401 and writes nothing", async () => {
    const kid = await newKid("נועה");
    const res = await post("evt_forged", subEvent("subscription.active", { subId: "sub_FORGED", kidId: kid }), { tamper: true });
    expect(res.status).toBe(401);
    expect(await isEntitled(kid)).toBe(false);
    expect(await count("select count(*)::text c from webhook_events where id = $1", ["evt_forged"])).toBe(0);
  });

  it("a cancellation keeps ארטו on until the period the parent already paid for ends", async () => {
    const kid = await newKid("אמה");
    await post("evt_b_active", subEvent("subscription.active", { subId: "sub_B", kidId: kid }));
    const end = inDays(12);
    const res = await post("evt_b_cancel", subEvent("subscription.cancelled", { subId: "sub_B", kidId: kid, status: "cancelled", nextBilling: end, cancelAtNext: true }));
    expect(res.status).toBe(200);

    expect(await isEntitled(kid)).toBe(true);
    const s = await subscriptionStatusFor(kid);
    expect(s.status).toBe("cancelled");
    expect(new Date(s.until!).getTime()).toBeCloseTo(end.getTime(), -3);
    // ...and it is genuinely over once that date passes
    expect(await isEntitled(kid, inDays(20))).toBe(false);
  });

  it("an expired subscription ends the entitlement", async () => {
    const kid = await newKid("מילן");
    await post("evt_c_active", subEvent("subscription.active", { subId: "sub_C", kidId: kid }));
    expect(await isEntitled(kid)).toBe(true);
    const res = await post("evt_c_expired", subEvent("subscription.expired", { subId: "sub_C", status: "expired" }));
    expect(res.status).toBe(200);
    expect(await isEntitled(kid)).toBe(false);
    expect((await subscriptionStatusFor(kid)).status).toBe("ended");
  });

  it("past_due keeps ארטו on through the 7-day grace and no longer", async () => {
    const kid = await newKid("קיארה");
    await post("evt_d_active", subEvent("subscription.active", { subId: "sub_D", kidId: kid }));
    const res = await post("evt_d_failed", subEvent("subscription.past_due", { subId: "sub_D", status: "past_due" }));
    expect(res.status).toBe(200);

    expect((await subscriptionStatusFor(kid)).status).toBe("past_due");
    expect(await isEntitled(kid)).toBe(true);
    expect(await isEntitled(kid, inDays(3))).toBe(true);
    expect(await isEntitled(kid, inDays(10))).toBe(false);
  });

  it("a payment.failed marks past_due and mails the parent (skipped without Resend)", async () => {
    const kid = await newKid("יונתן");
    await post("evt_e_active", subEvent("subscription.active", { subId: "sub_E", kidId: kid }));
    const res = await post("evt_e_payfail", { business_id: "biz_test", type: "payment.failed", timestamp: new Date().toISOString(), data: { payload_type: "Payment", subscription_id: "sub_E", customer: { customer_id: "cus_test" } } });
    expect(res.status).toBe(200);
    expect((await subscriptionStatusFor(kid)).status).toBe("past_due");
    expect(await count("select count(*)::text c from sends where kid_id = $1 and kind = 'billing'", [kid])).toBeGreaterThan(0);

    // ...and a later successful payment brings it straight back
    await post("evt_e_paysucceed", { business_id: "biz_test", type: "payment.succeeded", timestamp: new Date().toISOString(), data: { payload_type: "Payment", subscription_id: "sub_E" } });
    expect((await subscriptionStatusFor(kid)).status).toBe("active");
    expect(await isEntitled(kid)).toBe(true);
  });

  it("an editor grant entitles a kid with no subscription at all", async () => {
    const kid = await newKid("שירה");
    expect(await isEntitled(kid)).toBe(false);
    expect((await subscriptionStatusFor(kid)).status).toBe("free");

    await db.query("update kids set free_assistant_until = $2 where id = $1", [kid, inDays(30)]);
    expect(await isEntitled(kid)).toBe(true);
    const s = await subscriptionStatusFor(kid);
    expect(s.status).toBe("granted");
    expect(new Date(s.until!).getTime()).toBeGreaterThan(Date.now());
    expect(await isEntitled(kid, inDays(40))).toBe(false);
  });

  it("ignores a webhook whose subscription we cannot tie to a kid", async () => {
    const res = await post("evt_orphan", subEvent("subscription.active", { subId: "sub_UNKNOWN" }));
    expect(res.status).toBe(200);
    expect(await count("select count(*)::text c from subscriptions where provider_subscription_id = $1", ["sub_UNKNOWN"])).toBe(0);
  });

  it("returns 503 when the webhook key is not set", async () => {
    const saved = process.env.DODO_PAYMENTS_WEBHOOK_KEY;
    delete process.env.DODO_PAYMENTS_WEBHOOK_KEY;
    try {
      const res = await post("evt_unconfigured", subEvent("subscription.active", { subId: "sub_X" }));
      expect(res.status).toBe(503);
    } finally {
      process.env.DODO_PAYMENTS_WEBHOOK_KEY = saved;
    }
  });
});
