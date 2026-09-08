"use server";

import { redirect } from "next/navigation";
import { requireParent } from "@/lib/auth";
import { assertOwnsKid } from "@/lib/family";
import { billingConfigured, createCheckout } from "@/lib/billing";

/**
 * The "activate ארטו for {name}" form. Ownership is checked here too — a server action is a public
 * endpoint, the form field is not to be trusted.
 */
export async function startCheckout(formData: FormData): Promise<void> {
  const kidId = String(formData.get("kid_id") ?? "");
  let url: string | null = null;
  try {
    const parent = await requireParent();
    if (!kidId) throw new Error("bad_input");
    await assertOwnsKid(parent.id, kidId);
    if (!billingConfigured()) redirect("/billing?off=1");
    url = await createCheckout(parent, kidId);
  } catch (e) {
    // `redirect()` works by throwing — let it through.
    if (isRedirect(e)) throw e;
    redirect(`/billing?err=1`);
  }
  if (!url) redirect("/billing?err=1");
  redirect(url);
}

function isRedirect(e: unknown): boolean {
  return !!e && typeof e === "object" && "digest" in e && String((e as { digest?: unknown }).digest).startsWith("NEXT_REDIRECT");
}
