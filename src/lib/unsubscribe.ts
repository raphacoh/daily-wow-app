/**
 * Unsubscribe: a per-address suppression list, and the opaque token each mail's footer link carries.
 * The token is the address AES-GCM-encrypted with the link key (tokens.ts), so the URL shows no address and
 * nobody can mint one for someone else's.
 */
import { db, hasDb } from "./db";
import { APP } from "./config";
import { decryptToken, encryptToken } from "./tokens";

const PREFIX = "unsub:";

function norm(email: string): string {
  return email.trim().toLowerCase();
}

export function unsubscribeToken(email: string): string {
  return encryptToken(PREFIX + norm(email));
}

/** The address inside a token, or null for anything forged, truncated or minted for another purpose. */
export function emailFromToken(token: string | null | undefined): string | null {
  if (typeof token !== "string" || !token || token.length > 512) return null;
  const raw = decryptToken(token);
  return raw && raw.startsWith(PREFIX) ? raw.slice(PREFIX.length) : null;
}

/** The page a person lands on from the footer link (it asks before doing anything). */
export function unsubscribePageUrl(email: string): string {
  return `${APP.url}/unsubscribe?u=${unsubscribeToken(email)}`;
}

/** The RFC 8058 one-click endpoint for the List-Unsubscribe header. */
export function unsubscribePostUrl(email: string): string {
  return `${APP.url}/api/unsubscribe?u=${unsubscribeToken(email)}`;
}

export async function unsubscribe(email: string, source: "link" | "one_click" | "editor" = "link"): Promise<void> {
  await db().query("insert into unsubscribes (email, source) values ($1, $2) on conflict (email) do nothing", [norm(email), source]);
}

export async function resubscribe(email: string): Promise<void> {
  await db().query("delete from unsubscribes where email = $1", [norm(email)]);
}

export async function isUnsubscribed(email: string): Promise<boolean> {
  const r = await db().query("select 1 from unsubscribes where email = $1", [norm(email)]);
  return r.rows.length > 0;
}

/** `emails` minus the unsubscribed ones, order and spelling kept. Without a database nothing is filtered. */
export async function withoutUnsubscribed(emails: string[]): Promise<string[]> {
  if (!emails.length || !hasDb()) return emails;
  let r;
  try {
    r = await db().query<{ email: string }>("select email from unsubscribes where email = any($1::text[])", [emails.map(norm)]);
  } catch (e) {
    // the table not migrated yet must not stop every mail; any other database error still does
    if ((e as { code?: string }).code !== "42P01") throw e;
    console.warn("[unsubscribe] table unsubscribes is missing — run the migration; sending unfiltered");
    return emails;
  }
  if (!r.rows.length) return emails;
  const off = new Set(r.rows.map((x) => x.email));
  return emails.filter((e) => !off.has(norm(e)));
}
