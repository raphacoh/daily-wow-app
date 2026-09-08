/**
 * Kid link tokens (24 random bytes, base64url, stored hashed) and short-lived assistant session JWTs.
 */
import { createCipheriv, createDecipheriv, createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { SignJWT, jwtVerify } from "jose";

export function newLinkToken(): string {
  return randomBytes(24).toString("base64url");
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

export function looksLikeToken(t: unknown): t is string {
  return typeof t === "string" && /^[A-Za-z0-9_-]{24,64}$/.test(t);
}

export function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a), y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

let devSecret: Uint8Array | null = null;
function secret(): Uint8Array {
  const s = process.env.SESSION_SECRET;
  if (s) return new TextEncoder().encode(s);
  if (!devSecret) devSecret = randomBytes(32); // per-process in dev/tests; set SESSION_SECRET in production
  return devSecret;
}

export interface ArtoSession {
  sid: string;      // arto_sessions.id
  key: string;      // kid id or 'demo'
  edition_n: number;
  kid_id: string | null;
}

export async function signSession(s: ArtoSession, ttlSeconds = 5 * 3600): Promise<string> {
  return new SignJWT({ key: s.key, n: s.edition_n, kid: s.kid_id })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(s.sid)
    .setIssuedAt()
    .setExpirationTime(Math.floor(Date.now() / 1000) + ttlSeconds)
    .sign(secret());
}

export async function verifySession(token: string): Promise<ArtoSession | null> {
  try {
    const { payload } = await jwtVerify(token, secret());
    if (!payload.sub || typeof payload.key !== "string" || typeof payload.n !== "number") return null;
    return { sid: payload.sub, key: payload.key, edition_n: payload.n, kid_id: (payload.kid as string | null) ?? null };
  } catch {
    return null;
  }
}

/* ---------- at-rest encryption of the raw link token (so the dashboard and the emails can show it) ---------- */
function linkKey(): Buffer {
  const src = process.env.LINK_KEY || process.env.SESSION_SECRET || "daily-wow-dev-key";
  if (!process.env.LINK_KEY && !process.env.SESSION_SECRET && process.env.NODE_ENV === "production") {
    console.warn("LINK_KEY/SESSION_SECRET not set — link tokens are encrypted with a development key");
  }
  return createHash("sha256").update(src).digest();
}

export function encryptToken(raw: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", linkKey(), iv);
  const enc = Buffer.concat([c.update(raw, "utf8"), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), enc]).toString("base64url");
}

export function decryptToken(enc: string): string | null {
  try {
    const b = Buffer.from(enc, "base64url");
    const d = createDecipheriv("aes-256-gcm", linkKey(), b.subarray(0, 12));
    d.setAuthTag(b.subarray(12, 28));
    return Buffer.concat([d.update(b.subarray(28)), d.final()]).toString("utf8");
  } catch {
    return null;
  }
}
