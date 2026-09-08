import type { Metadata } from "next";
import { redirect } from "next/navigation";
import SignInForm from "./SignInForm";
import { GoogleButton } from "@/app/join/GoogleButton";
import { googleSignInEnabled } from "@/lib/auth";
import { currentParent } from "@/lib/auth";
import { t } from "@/i18n";

export const metadata: Metadata = { title: t("signin.title"), description: t("meta.signin"), robots: { index: false } };

export default async function SignInPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  let parent = null;
  try {
    parent = await currentParent();
  } catch {
    parent = null;
  }
  if (parent) redirect("/home");

  const { error, next } = await searchParams;
  const nextPath = typeof next === "string" && next.startsWith("/") && !next.startsWith("//") ? next : "/home";

  return (
    <main className="page">
      <h1>{t("signin.title")}</h1>
      <p className="lede">{t("signin.lede")}</p>
      {error ? <p className="msg bad">{error === "google" ? t("signin.googleError") : t("signin.callbackError")}</p> : null}
      <section className="panel">
        {googleSignInEnabled() ? <GoogleButton next={nextPath} /> : null}
        <SignInForm next={nextPath} />
      </section>
      <p className="small">{t("signin.noAccount")} <a href="/join">{t("nav.join")}</a></p>
    </main>
  );
}
