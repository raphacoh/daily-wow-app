"use server";
/**
 * Registration (PRD §5.2). One server action for the whole form: parse → validate → create the family →
 * magic link + welcome mail. Everything it can fail at (no database, no Supabase keys, no Resend key) is
 * reported to the parent as plain Hebrew rather than as a crash.
 */
import { APP } from "@/lib/config";
import { hasDb } from "@/lib/db";
import { latestReleased } from "@/lib/editions";
import { sendMail, welcomeMail } from "@/lib/emails";
import { sendMagicLink, supabaseConfigured, supabaseServer } from "@/lib/auth";
import { registerFamily, validateRegistration } from "@/lib/family";
import { parseJoinForm } from "./parse";
import { t } from "@/i18n";

export type JoinStatus = "idle" | "error" | "exists" | "done";

export interface JoinState {
  status: JoinStatus;
  /** field path → Hebrew message ("parentName", "email", "consent", "kids", "kids.0.name", …) */
  errors: Record<string, string>;
  /** a top-of-form message (already registered, no database, unexpected failure) */
  message?: string;
  /** a softer aside under the success text (magic link could not be sent from this server) */
  note?: string;
  email?: string;
  kids?: { name: string; link: string }[];
}

/* ---------- the action ---------- */

export async function register(_prevState: JoinState, formData: FormData): Promise<JoinState> {
  const input = parseJoinForm(formData);

  const errs = validateRegistration(input);
  if (errs.length) {
    const errors: Record<string, string> = {};
    for (const e of errs) if (!errors[e.field]) errors[e.field] = e.message;
    return { status: "error", errors };
  }

  // A server without DATABASE_URL is a perfectly good place to look at the form; say so plainly.
  if (!hasDb()) return { status: "error", errors: {}, message: t("join.noDb") };

  const email = input.email;
  const redirectTo = `${APP.url}/auth/callback?next=/home`;

  try {
    // When the visitor is already signed in with this very address, the parents row must carry the auth
    // uid so row-level security matches. A different address would collide with their own row, so skip it.
    let parentId: string | undefined;
    if (supabaseConfigured()) {
      try {
        const { data } = await (await supabaseServer()).auth.getUser();
        if (data.user?.id && data.user.email?.toLowerCase() === email) parentId = data.user.id;
      } catch {
        /* signed out, or no cookies on this request */
      }
    }

    const res = await registerFamily(input, parentId ? { parentId } : {});
    if (res.existed) {
      await sendMagicLink(email, redirectTo);
      return { status: "exists", errors: {}, message: t("join.exists"), email };
    }

    const linkError = await sendMagicLink(email, redirectTo);
    const edition = await latestReleased();
    const kids = res.kids.map((k) => ({
      ...k,
      link: `${APP.url}/l/today?k=${encodeURIComponent(k.token)}`,
    }));

    if (edition) {
      const kidEmails = input.kids.map((k) => k.email).filter((e): e is string => !!e);
      await sendMail(
        welcomeMail({
          to: [email, ...kidEmails],
          parentName: input.parentName,
          kids: kids.map((k) => ({ name: k.name, feminine: k.feminine, link: k.link })),
          editionTitle: edition.title,
          editionN: edition.n,
        }),
      );
    }

    return {
      status: "done",
      errors: {},
      email,
      kids: kids.map((k) => ({ name: k.name, link: k.link })),
      note: linkError ? t("join.linkNote") : undefined,
    };
  } catch (e) {
    console.error("[join] registration failed", e);
    return { status: "error", errors: {}, message: t("join.failed") };
  }
}
