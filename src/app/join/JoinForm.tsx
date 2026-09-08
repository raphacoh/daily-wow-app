"use client";
/**
 * Registration as a short wizard (PRD §5.2, redesigned): the parent's email on one screen, then each kid
 * on their own screen, then a last screen with the parent's name + consent, then done.
 * Client state only; the final screen submits everything to the same server action through hidden fields,
 * so the server contract (`parentName, email, consent, kid_i_*`) is unchanged.
 */
import { useActionState, useEffect, useRef, useState } from "react";
import { register, type JoinState } from "./actions";
import { t } from "@/i18n";

export interface LevelOption {
  value: string;
  label: string;
  blurb: string;
}

export interface JoinFormProps {
  levels: LevelOption[];
  grades: string[];
  gradeByAge: Record<string, string>;
  ages: number[];
  maxKids: number;
}

interface KidState {
  key: number;
  name: string;
  feminine: "" | "0" | "1";
  age: string;
  grade: string;
  level: string;
  email: string;
  extraName: string;
  extraEmail: string;
}

type Step = { kind: "email" } | { kind: "kid"; i: number } | { kind: "final" };

const JOIN_INITIAL: JoinState = { status: "idle", errors: {} };
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

let nextKey = 1;
function blankKid(level: string): KidState {
  return { key: nextKey++, name: "", feminine: "", age: "10", grade: "ה", level, email: "", extraName: "", extraEmail: "" };
}

export default function JoinForm({ levels, grades, maxKids }: JoinFormProps) {
  const defaultLevel = levels.some((l) => l.value === "standard") ? "standard" : levels[0]?.value ?? "";
  const [state, formAction, pending] = useActionState<JoinState, FormData>(register, JOIN_INITIAL);
  const [email, setEmail] = useState("");
  const [parentName, setParentName] = useState("");
  const [consent, setConsent] = useState(false);
  const [kids, setKids] = useState<KidState[]>(() => [blankKid(defaultLevel)]);
  const [step, setStep] = useState<Step>({ kind: "email" });
  const [local, setLocal] = useState<Record<string, string>>({});
  const formRef = useRef<HTMLFormElement>(null);
  const firstField = useRef<HTMLInputElement>(null);

  // each screen starts at the top; the first field is focused only where a keyboard is physical
  // (on phones an auto-focus pops the keyboard and the layout jumps as soon as the parent taps a chip)
  useEffect(() => {
    window.scrollTo({ top: 0 });
    const touch = typeof window !== "undefined" && window.matchMedia("(hover: none), (pointer: coarse)").matches;
    if (touch) return;
    const id = setTimeout(() => firstField.current?.focus(), 60);
    return () => clearTimeout(id);
  }, [step]);

  // a server-side validation error sends the parent back to the screen that owns it
  useEffect(() => {
    if (state.status !== "error") return;
    const keys = Object.keys(state.errors);
    if (!keys.length) return;
    const kidErr = keys.map((k) => /^kids\.(\d+)\./.exec(k)).find(Boolean);
    if (keys.includes("email")) setStep({ kind: "email" });
    else if (kidErr) setStep({ kind: "kid", i: Number(kidErr[1]) });
    else setStep({ kind: "final" });
  }, [state]);

  const patch = (i: number, p: Partial<KidState>) => setKids((ks) => ks.map((k, j) => (j === i ? { ...k, ...p } : k)));
  const serverErr = (field: string) => state.errors[field];
  const err = (field: string) => local[field] ?? serverErr(field);

  if (state.status === "done") {
    return (
      <section className="wiz">
        <Progress n={kids.length + 2} at={kids.length + 2} />
        <h1 className="wiz-h">{t("join.doneTitle")}</h1>
        <p className="wiz-p">{t("join.done", { email: state.email ?? "" })}</p>
        {state.note ? <p className="msg info">{state.note}</p> : null}
        <div className="wiz-acts col">
          {(state.kids ?? []).map((k) => (
            <a className="btn block" key={k.link} href={k.link}>
              {t("join.openFor", { name: k.name })}
            </a>
          ))}
        </div>
        <p className="small">{t("join.doneNote")}</p>
      </section>
    );
  }

  const stepIndex = step.kind === "email" ? 0 : step.kind === "kid" ? step.i + 1 : kids.length + 1;
  const total = kids.length + 2;

  function nextFromEmail() {
    if (!EMAIL_RE.test(email.trim())) return setLocal({ email: t("join.w.badEmail") });
    setLocal({});
    setStep({ kind: "kid", i: 0 });
  }
  function kidValid(i: number): boolean {
    const k = kids[i];
    const e: Record<string, string> = {};
    if (!k.name.trim()) e[`kids.${i}.name`] = t("join.w.needName");
    if (!k.feminine) e[`kids.${i}.feminine`] = t("join.w.needGender");
    if (!k.grade || !k.age) e[`kids.${i}.grade`] = t("join.w.needGrade");
    if (k.email && !EMAIL_RE.test(k.email.trim())) e[`kids.${i}.email`] = t("join.w.badEmail");
    if ((k.extraEmail || k.extraName) && !EMAIL_RE.test(k.extraEmail.trim())) e[`kids.${i}.extra`] = t("join.w.badEmail");
    setLocal(e);
    return Object.keys(e).length === 0;
  }
  function addKid(i: number) {
    if (!kidValid(i)) return;
    if (kids.length >= maxKids) return setStep({ kind: "final" });
    setKids((ks) => [...ks, blankKid(defaultLevel)]);
    setStep({ kind: "kid", i: i + 1 });
  }
  function finishKids(i: number) {
    if (!kidValid(i)) return;
    setStep({ kind: "final" });
  }
  function removeKid(i: number) {
    if (kids.length === 1) return;
    setKids((ks) => ks.filter((_, j) => j !== i));
    setStep({ kind: "kid", i: Math.max(0, i - 1) });
  }
  function back() {
    setLocal({});
    if (step.kind === "kid") setStep(step.i === 0 ? { kind: "email" } : { kind: "kid", i: step.i - 1 });
    else if (step.kind === "final") setStep({ kind: "kid", i: kids.length - 1 });
  }
  function submitAll() {
    const e: Record<string, string> = {};
    if (!parentName.trim()) e.parentName = t("join.w.needYourName");
    if (!consent) e.consent = t("join.w.needConsent");
    setLocal(e);
    if (Object.keys(e).length) return;
    formRef.current?.requestSubmit();
  }
  const onEnter = (fn: () => void) => (ev: React.KeyboardEvent) => {
    if (ev.key === "Enter" && (ev.target as HTMLElement).tagName !== "TEXTAREA") {
      ev.preventDefault();
      fn();
    }
  };

  return (
    <section className="wiz" key={`${step.kind}-${step.kind === "kid" ? step.i : ""}`}>
      <Progress n={total} at={stepIndex + 1} />
      {state.message && step.kind === "final" ? <p className={`msg ${state.status === "exists" ? "info" : "bad"}`}>{state.message}</p> : null}

      {step.kind === "email" ? (
        <div className="wiz-screen">
          <h1 className="wiz-h">{t("join.w.emailH")}</h1>
          <p className="wiz-p">{t("join.w.emailP")}</p>
          <input ref={firstField} className="wiz-in" type="email" inputMode="email" autoComplete="email" autoCapitalize="off" autoCorrect="off" spellCheck={false} enterKeyHint="next" dir="ltr" placeholder="name@example.com" value={email} onChange={(e) => setEmail(e.target.value)} onKeyDown={onEnter(nextFromEmail)} aria-label={t("join.parentEmail")} />
          {err("email") ? <p className="wiz-err">{err("email")}</p> : null}
          <div className="wiz-acts">
            <button type="button" className="btn" onClick={nextFromEmail}>{t("join.w.next")}</button>
          </div>
          <p className="small">{t("join.w.emailNote")}</p>
        </div>
      ) : null}

      {step.kind === "kid" ? (() => {
        const i = step.i;
        const k = kids[i];
        return (
          <div className="wiz-screen">
            <h1 className="wiz-h">{i === 0 ? t("join.w.kidH") : t("join.w.kidHMore")}</h1>
            <p className="wiz-p">{t("join.w.kidP")}</p>

            <label className="wiz-label">{t("join.kidName")}</label>
            <input ref={firstField} className="wiz-in" value={k.name} onChange={(e) => patch(i, { name: e.target.value })} onKeyDown={onEnter(() => (document.activeElement as HTMLElement | null)?.blur())} autoComplete="off" enterKeyHint="done" />
            {err(`kids.${i}.name`) ? <p className="wiz-err">{err(`kids.${i}.name`)}</p> : null}

            <label className="wiz-label">{t("join.gender")} <span className="wiz-hint">{t("join.genderHint")}</span></label>
            <div className="chips" role="radiogroup" aria-label={t("join.gender")}>
              <button type="button" className={"chip" + (k.feminine === "0" ? " on" : "")} aria-pressed={k.feminine === "0"} onClick={() => patch(i, { feminine: "0" })}>{t("join.boy")}</button>
              <button type="button" className={"chip" + (k.feminine === "1" ? " on" : "")} aria-pressed={k.feminine === "1"} onClick={() => patch(i, { feminine: "1" })}>{t("join.girl")}</button>
            </div>
            {err(`kids.${i}.feminine`) ? <p className="wiz-err">{err(`kids.${i}.feminine`)}</p> : null}

            <label className="wiz-label" htmlFor={`grade-${k.key}`}>{t("join.grade")} <b className="wiz-val">{k.grade || "—"}</b></label>
            <div className="slider">
              <input id={`grade-${k.key}`} type="range" min={0} max={grades.length - 1} step={1} value={k.grade ? Math.max(0, grades.indexOf(k.grade)) : 3} onChange={(e) => { const gi = Number(e.target.value); patch(i, { grade: grades[gi], age: String(7 + gi) }); }} />
              <div className="ticks" aria-hidden="true">{grades.map((g) => <i key={g}>{g}</i>)}</div>
            </div>
            {err(`kids.${i}.age`) || err(`kids.${i}.grade`) ? <p className="wiz-err">{err(`kids.${i}.age`) || err(`kids.${i}.grade`)}</p> : null}

            <label className="wiz-label" htmlFor={`lvl-${k.key}`}>{t("join.level")} <b className="wiz-val">{levels.find((l) => l.value === k.level)?.label}</b></label>
            <div className="slider">
              <input id={`lvl-${k.key}`} type="range" min={0} max={levels.length - 1} step={1} value={Math.max(0, levels.findIndex((l) => l.value === k.level))} onChange={(e) => patch(i, { level: levels[Number(e.target.value)]?.value ?? defaultLevel })} />
              <div className="ticks" aria-hidden="true">{levels.map((l) => <i key={l.value}>{l.label}</i>)}</div>
            </div>
            <p className="wiz-hint">{levels.find((l) => l.value === k.level)?.blurb}</p>

            <details className="sheet" open={!!(err(`kids.${i}.email`) || err(`kids.${i}.extra`))}>
              <summary>{t("join.w.optional")}</summary>
              <div className="field">
                <label>{t("join.kidEmail")}</label>
                <input type="email" inputMode="email" dir="ltr" value={k.email} onChange={(e) => patch(i, { email: e.target.value })} />
                <span className="hint">{t("join.kidEmailHint")}</span>
                {err(`kids.${i}.email`) ? <span className="wiz-err">{err(`kids.${i}.email`)}</span> : null}
              </div>
              <div className="field">
                <label>{t("join.extraAdult")}</label>
                <input placeholder={t("join.extraName")} value={k.extraName} onChange={(e) => patch(i, { extraName: e.target.value })} />
                <input type="email" inputMode="email" dir="ltr" placeholder={t("join.extraEmail")} value={k.extraEmail} onChange={(e) => patch(i, { extraEmail: e.target.value })} />
                {err(`kids.${i}.extra`) ? <span className="wiz-err">{err(`kids.${i}.extra`)}</span> : null}
              </div>
            </details>

            <div className="wiz-acts">
              <button type="button" className="btn" onClick={() => finishKids(i)}>{t("join.w.kidDone")}</button>
              {kids.length < maxKids ? <button type="button" className="btn ghost" onClick={() => addKid(i)}>{t("join.w.kidMore")}</button> : null}
            </div>
            <p className="wiz-nav">
              <button type="button" className="lnk" onClick={back}>{t("join.w.back")}</button>
              {kids.length > 1 ? <button type="button" className="lnk" onClick={() => removeKid(i)}>{t("join.removeKid")}</button> : null}
            </p>
          </div>
        );
      })() : null}

      {step.kind === "final" ? (
        <div className="wiz-screen">
          <h1 className="wiz-h">{t("join.w.finalH")}</h1>
          <p className="wiz-p">{t("join.w.finalP", { kids: kids.map((k) => k.name.trim()).filter(Boolean).join(", "), email })}</p>
          <label className="wiz-label">{t("join.parentName")}</label>
          <input ref={firstField} className="wiz-in" autoComplete="given-name" enterKeyHint="done" value={parentName} onChange={(e) => setParentName(e.target.value)} onKeyDown={onEnter(() => (document.activeElement as HTMLElement | null)?.blur())} />
          {err("parentName") ? <p className="wiz-err">{err("parentName")}</p> : null}
          <label className="wiz-consent">
            <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
            <span>{t("join.consent")} (<a href="/privacy" target="_blank" rel="noopener">{t("join.privacyLink")}</a>)</span>
          </label>
          {err("consent") ? <p className="wiz-err">{err("consent")}</p> : null}
          <div className="wiz-acts">
            <button type="button" className="btn" onClick={submitAll} disabled={pending}>{pending ? t("join.submitting") : t("join.w.submit")}</button>
          </div>
          <p className="wiz-nav"><button type="button" className="lnk" onClick={back}>{t("join.w.back")}</button></p>
        </div>
      ) : null}

      {/* the real submission: everything collected, as the server action expects it */}
      <form ref={formRef} action={formAction} hidden aria-hidden="true">
        <input type="hidden" name="email" value={email.trim()} />
        <input type="hidden" name="parentName" value={parentName.trim()} />
        {consent ? <input type="hidden" name="consent" value="1" /> : null}
        {kids.map((k, i) => (
          <span key={k.key}>
            <input type="hidden" name={`kid_${i}_name`} value={k.name.trim()} />
            <input type="hidden" name={`kid_${i}_feminine`} value={k.feminine} />
            <input type="hidden" name={`kid_${i}_age`} value={k.age} />
            <input type="hidden" name={`kid_${i}_grade`} value={k.grade} />
            <input type="hidden" name={`kid_${i}_level`} value={k.level} />
            <input type="hidden" name={`kid_${i}_email`} value={k.email.trim()} />
            <input type="hidden" name={`kid_${i}_extraName`} value={k.extraName.trim()} />
            <input type="hidden" name={`kid_${i}_extraEmail`} value={k.extraEmail.trim()} />
          </span>
        ))}
      </form>
    </section>
  );
}

function Progress({ n, at }: { n: number; at: number }) {
  return (
    <div className="wiz-prog" aria-label={`שלב ${at} מתוך ${n}`}>
      {Array.from({ length: n }, (_, i) => (
        <i key={i} className={i < at ? "on" : ""} />
      ))}
    </div>
  );
}
