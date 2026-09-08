"use client";
/**
 * The registration form (PRD §5.2). Kid cards are client state so "+ עוד ילד/ה" costs no round trip;
 * every field is controlled so a validation round trip never loses what the parent typed.
 *
 * The level/grade tables live in server-only modules, so the page passes them in as plain data.
 */
import { useActionState, useId, useState } from "react";
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
  /** age (7–13) → the grade to pre-fill, from `gradeForAge` */
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
  gradeTouched: boolean;
  level: string;
  email: string;
  extraName: string;
  extraEmail: string;
}

const JOIN_INITIAL: JoinState = { status: "idle", errors: {} };

let nextKey = 1;
function blankKid(level: string): KidState {
  return { key: nextKey++, name: "", feminine: "", age: "", grade: "", gradeTouched: false, level, email: "", extraName: "", extraEmail: "" };
}

export default function JoinForm({ levels, grades, gradeByAge, ages, maxKids }: JoinFormProps) {
  const defaultLevel = levels.some((l) => l.value === "standard") ? "standard" : levels[0]?.value ?? "";
  const [state, formAction, pending] = useActionState<JoinState, FormData>(register, JOIN_INITIAL);
  const [parentName, setParentName] = useState("");
  const [email, setEmail] = useState("");
  const [consent, setConsent] = useState(false);
  const [kids, setKids] = useState<KidState[]>(() => [blankKid(levels.some((l) => l.value === "standard") ? "standard" : levels[0]?.value ?? "")]);
  const uid = useId();

  const patch = (i: number, p: Partial<KidState>) => setKids((ks) => ks.map((k, j) => (j === i ? { ...k, ...p } : k)));
  const err = (field: string) => state.errors[field];

  if (state.status === "done") {
    return (
      <div className="panel">
        <h2>{t("join.doneTitle")}</h2>
        <p>{t("join.done", { email: state.email ?? "" })}</p>
        {state.note ? <p className="msg info">{state.note}</p> : null}
        <div className="controls">
          {(state.kids ?? []).map((k) => (
            <a className="btn" key={k.link} href={k.link}>
              {t("join.openFor", { name: k.name })}
            </a>
          ))}
        </div>
        <p className="small">{t("join.doneNote")}</p>
      </div>
    );
  }

  return (
    <form action={formAction} noValidate>
      {state.message ? <p className={`msg ${state.status === "exists" ? "info" : "bad"}`}>{state.message}</p> : null}

      <section className="panel">
        <h2>{t("join.parent")}</h2>

        <div className="field">
          <label htmlFor={`${uid}-pname`}>{t("join.parentName")}</label>
          <input id={`${uid}-pname`} name="parentName" autoComplete="given-name" value={parentName} onChange={(e) => setParentName(e.target.value)} />
          {err("parentName") ? <span className="msg bad">{err("parentName")}</span> : null}
        </div>

        <div className="field">
          <label htmlFor={`${uid}-pmail`}>{t("join.parentEmail")}</label>
          <input id={`${uid}-pmail`} name="email" type="email" inputMode="email" autoComplete="email" dir="ltr" value={email} onChange={(e) => setEmail(e.target.value)} />
          <span className="hint">{t("join.parentEmailHint")}</span>
          {err("email") ? <span className="msg bad">{err("email")}</span> : null}
        </div>

        <div className="field inline">
          <input id={`${uid}-consent`} name="consent" type="checkbox" value="1" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
          <label htmlFor={`${uid}-consent`}>
            {t("join.consent")} (<a href="/privacy">{t("join.privacyLink")}</a>)
          </label>
        </div>
        {err("consent") ? <p className="msg bad">{err("consent")}</p> : null}
      </section>

      <h2>{t("join.kids")}</h2>
      {err("kids") ? <p className="msg bad">{err("kids")}</p> : null}

      {kids.map((kid, i) => (
        <section className="kidcard" key={kid.key}>
          <h3>
            {t("join.kidN", { n: i + 1 })}
            {kids.length > 1 ? (
              <button type="button" className="rm" onClick={() => setKids((ks) => ks.filter((_, j) => j !== i))}>
                {t("join.removeKid")}
              </button>
            ) : null}
          </h3>

          <div className="field">
            <label htmlFor={`${uid}-n${kid.key}`}>{t("join.kidName")}</label>
            <input id={`${uid}-n${kid.key}`} name={`kid_${i}_name`} value={kid.name} onChange={(e) => patch(i, { name: e.target.value })} />
            {err(`kids.${i}.name`) ? <span className="msg bad">{err(`kids.${i}.name`)}</span> : null}
          </div>

          <fieldset className="field" style={{ border: 0, margin: "12px 0", padding: 0 }}>
            <legend style={{ fontWeight: 700, fontSize: ".98rem", padding: 0 }}>{t("join.gender")}</legend>
            <div className="seg">
              <label>
                <input type="radio" name={`kid_${i}_feminine`} value="0" checked={kid.feminine === "0"} onChange={() => patch(i, { feminine: "0" })} />
                {t("join.boy")}
              </label>
              <label>
                <input type="radio" name={`kid_${i}_feminine`} value="1" checked={kid.feminine === "1"} onChange={() => patch(i, { feminine: "1" })} />
                {t("join.girl")}
              </label>
            </div>
            <span className="hint">{t("join.genderHint")}</span>
            {err(`kids.${i}.feminine`) ? <span className="msg bad">{err(`kids.${i}.feminine`)}</span> : null}
          </fieldset>

          <div className="field">
            <label htmlFor={`${uid}-a${kid.key}`}>{t("join.age")}</label>
            <select
              id={`${uid}-a${kid.key}`}
              name={`kid_${i}_age`}
              value={kid.age}
              onChange={(e) => {
                const age = e.target.value;
                patch(i, { age, ...(kid.gradeTouched ? {} : { grade: gradeByAge[age] ?? "" }) });
              }}
            >
              <option value="">—</option>
              {ages.map((a) => (
                <option key={a} value={a}>
                  {a}
                </option>
              ))}
            </select>
            {err(`kids.${i}.age`) ? <span className="msg bad">{err(`kids.${i}.age`)}</span> : null}
          </div>

          <div className="field">
            <label htmlFor={`${uid}-g${kid.key}`}>{t("join.grade")}</label>
            <select id={`${uid}-g${kid.key}`} name={`kid_${i}_grade`} value={kid.grade} onChange={(e) => patch(i, { grade: e.target.value, gradeTouched: true })}>
              <option value="">—</option>
              {grades.map((g) => (
                <option key={g} value={g}>
                  {g}
                </option>
              ))}
            </select>
            <span className="hint">{t("join.gradeHint")}</span>
            {err(`kids.${i}.grade`) ? <span className="msg bad">{err(`kids.${i}.grade`)}</span> : null}
          </div>

          <fieldset className="field" style={{ border: 0, margin: "12px 0", padding: 0 }}>
            <legend style={{ fontWeight: 700, fontSize: ".98rem", padding: 0 }}>{t("join.level")}</legend>
            <div className="levels">
              {levels.map((l) => (
                <label key={l.value}>
                  <input type="radio" name={`kid_${i}_level`} value={l.value} checked={kid.level === l.value} onChange={() => patch(i, { level: l.value })} />
                  <span>
                    <b>{l.label}</b>
                    <small>{l.blurb}</small>
                  </span>
                </label>
              ))}
            </div>
            {err(`kids.${i}.level`) ? <span className="msg bad">{err(`kids.${i}.level`)}</span> : null}
          </fieldset>

          <div className="field">
            <label htmlFor={`${uid}-e${kid.key}`}>{t("join.kidEmail")}</label>
            <input id={`${uid}-e${kid.key}`} name={`kid_${i}_email`} type="email" inputMode="email" dir="ltr" value={kid.email} onChange={(e) => patch(i, { email: e.target.value })} />
            <span className="hint">{t("join.kidEmailHint")}</span>
            {err(`kids.${i}.email`) ? <span className="msg bad">{err(`kids.${i}.email`)}</span> : null}
          </div>

          <details className="sheet" open={!!kid.extraName || !!kid.extraEmail || !!err(`kids.${i}.extra`)}>
            <summary>{t("join.extraAdultShort")}</summary>
            <p className="small">{t("join.extraAdult")}</p>
            <div className="field">
              <label htmlFor={`${uid}-xn${kid.key}`}>{t("join.extraName")}</label>
              <input id={`${uid}-xn${kid.key}`} name={`kid_${i}_extraName`} value={kid.extraName} onChange={(e) => patch(i, { extraName: e.target.value })} />
            </div>
            <div className="field">
              <label htmlFor={`${uid}-xe${kid.key}`}>{t("join.extraEmail")}</label>
              <input id={`${uid}-xe${kid.key}`} name={`kid_${i}_extraEmail`} type="email" inputMode="email" dir="ltr" value={kid.extraEmail} onChange={(e) => patch(i, { extraEmail: e.target.value })} />
            </div>
            {err(`kids.${i}.extra`) ? <p className="msg bad">{err(`kids.${i}.extra`)}</p> : null}
          </details>
        </section>
      ))}

      <div className="controls">
        {kids.length < maxKids ? (
          <button type="button" className="btn ghost" onClick={() => setKids((ks) => [...ks, blankKid(defaultLevel)])}>
            {t("join.addKid")}
          </button>
        ) : (
          <span className="small">{t("join.maxKids", { max: maxKids })}</span>
        )}
      </div>

      <button className="btn block" type="submit" disabled={pending}>
        {pending ? t("join.submitting") : t("join.submit")}
      </button>
    </form>
  );
}
