import type { Metadata } from "next";
import JoinForm, { type LevelOption } from "./JoinForm";
import { gradeForAge } from "@/lib/family";
import { GRADES, LEVELS_UI, type Level } from "@/lib/kids";
import { t } from "@/i18n";

export const metadata: Metadata = { title: t("join.title"), description: t("meta.join"), robots: { index: true, follow: true } };

const AGES = [7, 8, 9, 10, 11, 12, 13];
const MAX_KIDS = 6;

export default function JoinPage() {
  // The level/grade tables come from server-only modules; hand the form plain data instead of the modules.
  const levels: LevelOption[] = (Object.keys(LEVELS_UI) as (keyof typeof LEVELS_UI)[]).map((value) => ({ value, ...LEVELS_UI[value] }));
  const gradeByAge = Object.fromEntries(AGES.map((a) => [String(a), gradeForAge(a)]));

  return (
    <main className="page">
      <JoinForm levels={levels} grades={[...GRADES]} gradeByAge={gradeByAge} ages={AGES} maxKids={MAX_KIDS} />
    </main>
  );
}
