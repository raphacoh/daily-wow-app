/**
 * Billing (PRD §5.5, §6.7). One Dodo Payments subscription per kid, ₪10/month, presented as covering
 * token cost — never as a business. Everything here is server-only.
 *
 * The money is Dodo's problem; ours is exactly three things:
 *   1. hand the parent a hosted checkout URL (`createCheckout`),
 *   2. hand them the customer portal for cancel/update card (`portalUrl`),
 *   3. keep the `subscriptions` table honest from the webhook stream (`applyWebhook`),
 * so that `isEntitled(kid)` in arto.ts — the one entitlement function — answers correctly.
 *
 * Nothing in this file throws when Dodo isn't configured: the app runs (and the billing page renders a
 * soft "payments aren't switched on yet") without any keys at all.
 */
import DodoPayments from "dodopayments";
import { track } from "./analytics";
import { db, type Queryable } from "./db";
import { APP, getNumber } from "./config";
import { billingMail, sendMail } from "./emails";
import { kidById, type ParentRow } from "./kids";
import { t } from "@/i18n";

/* ------------------------------------------------------------------ *
 * Configuration
 * ------------------------------------------------------------------ */

export function billingConfigured(): boolean {
  return !!(process.env.DODO_PAYMENTS_API_KEY && process.env.DODO_PRODUCT_ID);
}

export function webhookConfigured(): boolean {
  return !!process.env.DODO_PAYMENTS_WEBHOOK_KEY;
}

function client(): DodoPayments {
  return new DodoPayments({
    bearerToken: process.env.DODO_PAYMENTS_API_KEY!,
    environment: process.env.DODO_PAYMENTS_ENVIRONMENT === "live_mode" ? "live_mode" : "test_mode",
  });
}

/* ------------------------------------------------------------------ *
 * Checkout and portal
 * ------------------------------------------------------------------ */

/**
 * A hosted checkout for one kid. Ownership is the caller's job (`assertOwnsKid`).
 * Returns null when billing isn't configured — the page then shows the soft message.
 */
export async function createCheckout(parent: ParentRow, kidId: string): Promise<string | null> {
  if (!billingConfigured()) return null;
  const res = await client().checkoutSessions.create({
    product_cart: [{ product_id: process.env.DODO_PRODUCT_ID!, quantity: 1 }],
    customer: { email: parent.email, name: parent.name || parent.email },
    return_url: `${APP.url}/billing?kid=${encodeURIComponent(kidId)}&ok=1`,
    metadata: { parent_id: parent.id, kid_id: kidId },
  });
  return res.checkout_url ?? null;
}

/** The Dodo customer portal for this parent (cancel / update card), or null if they never paid. */
export async function portalUrl(parent: ParentRow, q: Queryable = db()): Promise<string | null> {
  if (!billingConfigured()) return null;
  const r = await q.query<{ provider_customer_id: string }>(
    `select s.provider_customer_id from subscriptions s
       join kids k on k.id = s.kid_id
      where k.parent_id = $1 and s.provider_customer_id is not null
      order by s.updated_at desc limit 1`,
    [parent.id],
  );
  const customerId = r.rows[0]?.provider_customer_id;
  if (!customerId) return null;
  const session = await client().customers.customerPortal.create(customerId, { send_email: false });
  return session.link ?? null;
}

/* ------------------------------------------------------------------ *
 * Status for the UI
 * ------------------------------------------------------------------ */

export type BillingStatus = "free" | "active" | "cancelled" | "past_due" | "ended" | "granted";

export interface KidBillingStatus {
  status: BillingStatus;
  until: string | null; // ISO
}

/**
 * What the billing page shows for one kid. `granted` is the editor's gift (`kids.free_assistant_until`);
 * a real subscription is reported ahead of it, so a paying parent never reads "gift from the editor".
 */
export async function subscriptionStatusFor(kidId: string, now = new Date(), q: Queryable = db()): Promise<KidBillingStatus> {
  const k = await q.query<{ free_assistant_until: Date | null }>("select free_assistant_until from kids where id = $1", [kidId]);
  const grant = k.rows[0]?.free_assistant_until ? new Date(k.rows[0].free_assistant_until as Date) : null;
  const granted = grant && grant.getTime() > now.getTime() ? { status: "granted" as const, until: grant.toISOString() } : null;

  const s = await q.query<SubRow>(
    "select * from subscriptions where kid_id = $1 order by updated_at desc, created_at desc limit 1",
    [kidId],
  );
  const sub = s.rows[0];
  if (!sub || sub.status === "ended") return granted ?? (sub ? { status: "ended", until: iso(sub.current_period_end) } : { status: "free", until: null });

  const status: BillingStatus = sub.status === "past_due" ? "past_due" : sub.cancel_at_period_end ? "cancelled" : "active";
  return { status, until: iso(sub.current_period_end) };
}

function iso(d: Date | string | null): string | null {
  return d ? new Date(d).toISOString() : null;
}

/**
 * The one live figure the billing page shows above the buttons (PRD §5.5) — this month's families and
 * token cost, straight from the open books. Loaded lazily and guarded: the numbers are a nice-to-have,
 * and nothing about them should ever stand between a parent and the activate button.
 */
export async function openBooksLine(): Promise<string | null> {
  try {
    const { monthlyRows } = await import("./openbooks");
    const row = (await monthlyRows())[0];
    if (!row) return null;
    return t("billing.live", { families: row.families, cost: row.token_cost });
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------------ *
 * Webhooks
 * ------------------------------------------------------------------ */

interface SubRow {
  id: string;
  kid_id: string;
  provider_customer_id: string | null;
  provider_subscription_id: string | null;
  status: "active" | "past_due" | "ended";
  current_period_end: Date | null;
  cancel_at_period_end: boolean;
}

/** The Standard Webhooks envelope Dodo sends, plus the `webhook-id` header (our idempotency key). */
export interface DodoEvent {
  id: string;
  type: string;
  timestamp?: string;
  business_id?: string;
  data?: {
    payload_type?: string;
    subscription_id?: string;
    status?: string;
    next_billing_date?: string | null;
    previous_billing_date?: string | null;
    cancelled_at?: string | null;
    cancel_at_next_billing_date?: boolean | null;
    product_id?: string;
    quantity?: number;
    customer?: { customer_id?: string; email?: string; name?: string } | null;
    metadata?: Record<string, string> | null;
  } | null;
}

export type WebhookOutcome =
  | { applied: true; kid_id: string; status: SubRow["status"] }
  | { applied: false; reason: "duplicate" | "ignored" | "no_subscription" | "no_kid" };

/** How each event type moves the subscription. `follow` means "do what data.status says". */
type Move = "active" | "past_due" | "cancelled" | "ended" | "follow" | "payment_failed" | "payment_succeeded" | "ignore";

function moveFor(type: string): Move {
  switch (type) {
    case "subscription.active":
    case "subscription.renewed":
      return "active";
    case "subscription.updated":
    case "subscription.plan_changed":
      return "follow";
    case "subscription.past_due":
    case "subscription.on_hold":
      return "past_due";
    case "subscription.cancelled":
      return "cancelled";
    case "subscription.expired":
    case "subscription.failed":
      return "ended";
    case "payment.failed":
      return "payment_failed";
    case "payment.succeeded":
      return "payment_succeeded";
    default:
      return "ignore";
  }
}

/** `subscription.updated` carries the real state in `data.status`. */
function followStatus(raw: string | undefined): Move {
  switch ((raw ?? "").toLowerCase()) {
    case "active":
      return "active";
    case "past_due":
    case "on_hold":
      return "past_due";
    case "cancelled":
    case "canceled":
      return "cancelled";
    case "expired":
    case "failed":
      return "ended";
    default:
      return "ignore";
  }
}

/**
 * Apply one verified webhook. Idempotent: the `webhook-id` is inserted into `webhook_events` first and a
 * replay is a no-op. Safe to call concurrently — the primary key is the lock.
 */
export async function applyWebhook(event: DodoEvent, now = new Date()): Promise<WebhookOutcome> {
  const ins = await db().query(
    "insert into webhook_events (id, provider, type) values ($1, 'dodo', $2) on conflict (id) do nothing returning id",
    [event.id, event.type],
  );
  if (!ins.rows.length) return { applied: false, reason: "duplicate" };

  let move = moveFor(event.type);
  if (move === "ignore") return { applied: false, reason: "ignored" };
  if (move === "follow") {
    move = followStatus(event.data?.status);
    if (move === "ignore" || move === "follow") return { applied: false, reason: "ignored" };
  }

  const d = event.data ?? {};
  const subId = d.subscription_id ?? null;
  if (!subId) return { applied: false, reason: "no_subscription" };
  const existing = await loadSub(subId);

  // The kid comes from the checkout metadata; on later events (renewals, cancellations) Dodo may not echo
  // it back, so the subscription row itself is the fallback.
  const kidId = (await validKid(d.metadata?.kid_id)) ?? existing?.kid_id ?? null;
  if (!kidId) return { applied: false, reason: "no_kid" };

  const customerId = d.customer?.customer_id ?? existing?.provider_customer_id ?? null;
  const nextBilling = d.next_billing_date ? new Date(d.next_billing_date) : null;
  const before = existing?.status ?? null;

  switch (move) {
    case "active": {
      await upsertSub({
        subId,
        kidId,
        customerId,
        status: "active",
        periodEnd: nextBilling ?? existing?.current_period_end ?? null,
        cancelAtPeriodEnd: !!d.cancel_at_next_billing_date,
      });
      // "once on first activation": a renewal of an already-active subscription is silent.
      if (before !== "active") await notify(kidId, "active", nextBilling);
      return { applied: true, kid_id: kidId, status: "active" };
    }
    case "past_due": {
      await upsertSub({
        subId,
        kidId,
        customerId,
        status: "past_due",
        periodEnd: existing?.current_period_end ?? nextBilling ?? null,
        cancelAtPeriodEnd: existing?.cancel_at_period_end ?? false,
      });
      return { applied: true, kid_id: kidId, status: "past_due" };
    }
    case "cancelled": {
      // Cancelling is not switching off: the kid keeps ארטו until the period the parent already paid for ends.
      const keepUntil = nextBilling ?? existing?.current_period_end ?? null;
      const stillPaid = !!d.cancel_at_next_billing_date || (keepUntil !== null && keepUntil.getTime() > now.getTime());
      if (stillPaid) {
        await upsertSub({ subId, kidId, customerId, status: "active", periodEnd: keepUntil, cancelAtPeriodEnd: true });
        return { applied: true, kid_id: kidId, status: "active" };
      }
      await upsertSub({ subId, kidId, customerId, status: "ended", periodEnd: keepUntil, cancelAtPeriodEnd: true });
      if (before !== "ended") await notify(kidId, "ended", keepUntil);
      return { applied: true, kid_id: kidId, status: "ended" };
    }
    case "ended": {
      const end = existing?.current_period_end ?? nextBilling ?? null;
      await upsertSub({ subId, kidId, customerId, status: "ended", periodEnd: end, cancelAtPeriodEnd: existing?.cancel_at_period_end ?? false });
      if (before !== "ended") await notify(kidId, "ended", end);
      return { applied: true, kid_id: kidId, status: "ended" };
    }
    case "payment_failed": {
      await upsertSub({
        subId,
        kidId,
        customerId,
        status: "past_due",
        periodEnd: existing?.current_period_end ?? nextBilling ?? null,
        cancelAtPeriodEnd: existing?.cancel_at_period_end ?? false,
      });
      await notify(kidId, "payment_failed", null);
      return { applied: true, kid_id: kidId, status: "past_due" };
    }
    case "payment_succeeded": {
      // A successful renewal payment on a subscription we had marked past_due brings ארטו straight back.
      if (!existing || existing.status !== "past_due") return { applied: false, reason: "ignored" };
      await upsertSub({
        subId,
        kidId,
        customerId,
        status: "active",
        periodEnd: nextBilling ?? existing.current_period_end,
        cancelAtPeriodEnd: existing.cancel_at_period_end,
      });
      return { applied: true, kid_id: kidId, status: "active" };
    }
  }
}

async function loadSub(subId: string, q: Queryable = db()): Promise<SubRow | null> {
  const r = await q.query<SubRow>("select * from subscriptions where provider_subscription_id = $1", [subId]);
  return r.rows[0] ?? null;
}

/** A kid id from untrusted metadata is only worth having if the kid actually exists. */
async function validKid(id: string | undefined, q: Queryable = db()): Promise<string | null> {
  if (!id) return null;
  const r = await q.query<{ id: string }>("select id from kids where id::text = $1 and deleted_at is null", [id]);
  return r.rows[0]?.id ?? null;
}

async function upsertSub(a: {
  subId: string;
  kidId: string;
  customerId: string | null;
  status: SubRow["status"];
  periodEnd: Date | null;
  cancelAtPeriodEnd: boolean;
}): Promise<void> {
  await db().query(
    `insert into subscriptions (kid_id, provider, provider_customer_id, provider_subscription_id, status, current_period_end, cancel_at_period_end)
     values ($1, 'dodo', $2, $3, $4::sub_status, $5, $6)
     on conflict (provider_subscription_id) do update set
       kid_id = excluded.kid_id,
       provider_customer_id = coalesce(excluded.provider_customer_id, subscriptions.provider_customer_id),
       status = excluded.status,
       current_period_end = excluded.current_period_end,
       cancel_at_period_end = excluded.cancel_at_period_end,
       updated_at = now()`,
    [a.kidId, a.customerId, a.subId, a.status, a.periodEnd, a.cancelAtPeriodEnd],
  );
}

/**
 * One billing mail to the parent, recorded in `sends` (kind 'billing', edition_n null) so the admin page
 * and any future audit can see it. Never throws: a mail problem must not fail a webhook.
 */
async function notify(kidId: string, kind: "active" | "ended" | "payment_failed", periodEnd: Date | null): Promise<void> {
  if (kind === "active") {
    const k = await db().query<{ parent_id: string }>("select parent_id from kids where id = $1", [kidId]);
    await track("subscribe", { kid_id: kidId, parent_id: k.rows[0]?.parent_id ?? null });
  }
  try {
    const kid = await kidById(kidId);
    if (!kid?.parent.email) return;
    const ins = await db().query(
      "insert into sends (edition_n, kid_id, parent_id, kind, to_emails) values (null, $1, $2, 'billing', $3) returning id",
      [kid.id, kid.parent.id, [kid.parent.email]],
    );
    const mail = billingMail({
      to: kid.parent.email,
      kind,
      kidName: kid.name,
      portalUrl: kind === "payment_failed" ? (await portalUrl(kid.parent).catch(() => null)) ?? undefined : undefined,
      periodEnd: periodEnd ? hebrewDate(periodEnd) : undefined,
    });
    const sent = await sendMail(mail);
    if (sent.id) await db().query("update sends set resend_id = $2 where id = $1", [(ins.rows[0] as { id: string }).id, sent.id]);
  } catch {
    /* a mail is never worth failing a webhook over */
  }
}

/** ד׳ בספטמבר 2026 → a plain Hebrew date; the emails and the page use the same one. */
export function hebrewDate(d: Date | string): string {
  return new Intl.DateTimeFormat("he-IL", { day: "numeric", month: "long", year: "numeric", timeZone: APP.timezone }).format(new Date(d));
}

/** Days of grace after a failed renewal — the same knob `isEntitled` reads. */
export async function graceDays(): Promise<number> {
  return getNumber("past_due_grace_days");
}
