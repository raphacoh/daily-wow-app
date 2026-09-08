"use server";
/**
 * Sign-in (PRD §5.3): an email, a magic link, nothing else. No passwords anywhere.
 */
import { googleSignInUrl, magicLinkRedirect, sendMagicLink } from "@/lib/auth";
import { redirect } from "next/navigation";
import { isEmail } from "@/lib/family";
import { t } from "@/i18n";

export interface SignInState {
  status: "idle" | "error" | "sent";
  message?: string;
  email?: string;
}

export async function sendLink(_prevState: SignInState, formData: FormData): Promise<SignInState> {
  const raw = formData.get("email");
  const email = (typeof raw === "string" ? raw : "").trim().toLowerCase();
  if (!isEmail(email)) return { status: "error", message: t("signin.badEmail"), email };
  try {
    const rawNext = formData.get("next");
    const next = typeof rawNext === "string" && rawNext.startsWith("/") && !rawNext.startsWith("//") ? rawNext : "/home";
    const error = await sendMagicLink(email, magicLinkRedirect(next));
    if (error) return { status: "error", message: error, email };
  } catch (e) {
    console.error("[signin] magic link failed", e);
    return { status: "error", message: t("signin.failed"), email };
  }
  return { status: "sent", message: t("signin.sent", { email }), email };
}

/** "Continue with Google" — server action: builds the provider URL (sets the PKCE cookie) and redirects. */
export async function signInWithGoogle(formData: FormData): Promise<void> {
  const rawNext = formData.get("next");
  const next = typeof rawNext === "string" && rawNext.startsWith("/") && !rawNext.startsWith("//") ? rawNext : "/home";
  const r = await googleSignInUrl(next);
  if (!r.url) redirect(`/signin?error=google&next=${encodeURIComponent(next)}`);
  redirect(r.url);
}
