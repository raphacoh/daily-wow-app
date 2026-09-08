"use client";
import { useActionState, useId, useState } from "react";
import { sendLink, type SignInState } from "./actions";
import { t } from "@/i18n";

const SIGNIN_INITIAL: SignInState = { status: "idle" };

export default function SignInForm({ next = "/home" }: { next?: string }) {
  const [state, formAction, pending] = useActionState<SignInState, FormData>(sendLink, SIGNIN_INITIAL);
  const [email, setEmail] = useState("");
  const uid = useId();

  if (state.status === "sent") return <p className="msg ok">{state.message}</p>;

  return (
    <form action={formAction} noValidate>
      <input type="hidden" name="next" value={next} />
      {state.message ? <p className="msg bad">{state.message}</p> : null}
      <div className="field">
        <label htmlFor={`${uid}-email`}>{t("signin.email")}</label>
        <input id={`${uid}-email`} name="email" type="email" inputMode="email" autoComplete="email" dir="ltr" value={email} onChange={(e) => setEmail(e.target.value)} />
      </div>
      <button className="btn block" type="submit" disabled={pending}>
        {pending ? t("signin.sending") : t("signin.send")}
      </button>
    </form>
  );
}
