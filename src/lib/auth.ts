/**
 * Parent sign-in: Supabase Auth magic links via @supabase/ssr. No passwords anywhere.
 * When Supabase is not configured (local dev without keys) `currentParent()` returns null and the
 * pages show the signed-out state; the API/kid flows never depend on it.
 */
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import { db, hasDb } from "./db";
import type { ParentRow } from "./kids";

export function supabaseConfigured(): boolean {
  return !!(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
}

export async function supabaseServer() {
  const cookieStore = await cookies();
  return createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    cookies: {
      getAll: () => cookieStore.getAll(),
      setAll: (all) => {
        try {
          all.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
        } catch {
          /* called from a Server Component: the middleware refreshes cookies instead */
        }
      },
    },
  });
}

/** The signed-in parent, or null. Creates the parents row on first sight (belt and braces with the DB trigger). */
export async function currentParent(): Promise<ParentRow | null> {
  if (!supabaseConfigured() || !hasDb()) return null;
  const sb = await supabaseServer();
  const { data } = await sb.auth.getUser();
  const u = data.user;
  if (!u?.email) return null;
  const r = await db().query<ParentRow>("select * from parents where id = $1 and deleted_at is null", [u.id]);
  if (r.rows[0]) return r.rows[0];
  // a family that registered before signing in: adopt its row (the FKs cascade the key change)
  const adopt = await db().query<ParentRow>("update parents set id = $1 where email = $2 and id <> $1 and deleted_at is null returning *", [u.id, u.email.toLowerCase()]);
  if (adopt.rows[0]) return adopt.rows[0];
  const ins = await db().query<ParentRow>(
    `insert into parents (id, email, name) values ($1, $2, $3)
     on conflict (id) do update set email = excluded.email returning *`,
    [u.id, u.email.toLowerCase(), String(u.user_metadata?.name ?? "")],
  );
  return ins.rows[0] ?? null;
}

export async function requireParent(): Promise<ParentRow> {
  const p = await currentParent();
  if (!p) throw new NotSignedIn();
  return p;
}

export async function requireEditor(): Promise<ParentRow> {
  const p = await requireParent();
  if (!p.is_editor) throw new NotSignedIn("editor");
  return p;
}

export class NotSignedIn extends Error {
  constructor(public readonly need: "parent" | "editor" = "parent") {
    super("not signed in");
  }
}

/** Send a magic link. Returns an error string in Hebrew, or null. */
export async function sendMagicLink(email: string, redirectTo: string): Promise<string | null> {
  if (!supabaseConfigured()) return "הכניסה עוד לא מוגדרת בשרת הזה (חסרים מפתחות Supabase).";
  const sb = await supabaseServer();
  const { error } = await sb.auth.signInWithOtp({ email, options: { emailRedirectTo: redirectTo, shouldCreateUser: true } });
  return error ? error.message : null;
}

/** Admin API bearer key for the pipeline routines (server-only). */
export function isEditorApiKey(header: string | null): boolean {
  const key = process.env.EDITOR_API_KEY;
  if (!key || !header) return false;
  const m = /^Bearer\s+(.+)$/i.exec(header.trim());
  if (!m) return false;
  const a = Buffer.from(m[1]), b = Buffer.from(key);
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

/** Magic-link landing with the destination in the path: /auth/cb/<base64url(next)> (see src/app/auth/cb). */
export function magicLinkRedirect(next: string): string {
  const safe = next.startsWith("/") && !next.startsWith("//") ? next : "/home";
  return `${process.env.NEXT_PUBLIC_APP_URL?.replace(/\/+$/, "") || "http://localhost:3000"}/auth/cb/${Buffer.from(safe, "utf8").toString("base64url")}`;
}

export function googleSignInEnabled(): boolean {
  return supabaseConfigured() && (process.env.NEXT_PUBLIC_GOOGLE_SIGNIN === "1" || !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET));
}

/** Start "continue with Google": returns the provider URL to redirect to (PKCE verifier lands in a cookie). */
export async function googleSignInUrl(next: string): Promise<{ url?: string; error?: string }> {
  if (!googleSignInEnabled()) return { error: "google_not_enabled" };
  const sb = await supabaseServer();
  const { data, error } = await sb.auth.signInWithOAuth({
    provider: "google",
    options: { redirectTo: magicLinkRedirect(next), skipBrowserRedirect: true, queryParams: { access_type: "online", prompt: "select_account" } },
  });
  if (error || !data.url) return { error: error?.message ?? "no_url" };
  return { url: data.url };
}
