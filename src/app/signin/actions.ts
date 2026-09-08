"use server";
/**
 * Sign-in (PRD §5.3): an email, a magic link, nothing else. No passwords anywhere.
 */
import { sendMagicLink } from "@/lib/auth";
import { isEmail } from "@/lib/family";
import { APP } from "@/lib/config";
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
    const error = await sendMagicLink(email, `${APP.url}/auth/callback?next=/home`);
    if (error) return { status: "error", message: error, email };
  } catch (e) {
    console.error("[signin] magic link failed", e);
    return { status: "error", message: t("signin.failed"), email };
  }
  return { status: "sent", message: t("signin.sent", { email }), email };
}
