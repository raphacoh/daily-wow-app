/**
 * `FormData` → `RegistrationInput` for the registration form (PRD §5.2).
 *
 * Its own module because `actions.ts` carries the "use server" directive, and Next.js only lets a
 * server-action module export async functions. This one is pure and synchronous, so the unit tests
 * (and the action) can call it directly.
 */
import type { KidInput, RegistrationInput } from "@/lib/family";
import type { Level } from "@/lib/kids";

function str(fd: FormData, key: string): string {
  const v = fd.get(key);
  return typeof v === "string" ? v.trim() : "";
}

/** Indices of the kid cards actually present in the payload, in order. */
function kidIndices(fd: FormData): number[] {
  const seen = new Set<number>();
  for (const key of fd.keys()) {
    const m = /^kid_(\d+)_/.exec(key);
    if (m) seen.add(Number(m[1]));
  }
  return [...seen].sort((a, b) => a - b);
}

/**
 * `FormData` → `RegistrationInput`. Deliberately lossy-free: missing/blank values become the empty
 * string or `NaN` so `validateRegistration` produces the message, not the parser.
 */
export function parseJoinForm(formData: FormData): RegistrationInput {
  const kids: KidInput[] = kidIndices(formData).map((i) => {
    const p = `kid_${i}_`;
    const feminineRaw = str(formData, `${p}feminine`);
    const extraName = str(formData, `${p}extraName`);
    const extraEmail = str(formData, `${p}extraEmail`);
    const ageRaw = str(formData, `${p}age`);
    return {
      name: str(formData, `${p}name`),
      // left undefined when nothing was picked — validateKid asks "בן או בת?"
      feminine: (feminineRaw === "1" ? true : feminineRaw === "0" ? false : undefined) as boolean,
      age: ageRaw === "" ? NaN : Number(ageRaw),
      grade: str(formData, `${p}grade`),
      level: str(formData, `${p}level`) as Level,
      email: str(formData, `${p}email`).toLowerCase() || null,
      extra: extraName || extraEmail ? { name: extraName, email: extraEmail.toLowerCase() } : null,
    };
  });
  return {
    parentName: str(formData, "parentName"),
    email: str(formData, "email").toLowerCase(),
    consent: formData.get("consent") !== null,
    kids,
  };
}
