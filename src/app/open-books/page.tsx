/**
 * Open books (PRD §5.6). Public, no sign-in, no database required: with nothing configured the table
 * shows one honest row of zeros for the current month.
 */
import type { Metadata } from "next";
import { t } from "@/i18n";
import { monthlyRows, usdIls } from "@/lib/openbooks";
import { heMonth, ils, n, nums } from "@/lib/format";

export const metadata: Metadata = { title: "ספרים פתוחים", description: "כמה משפחות, כמה ילדים, כמה עלה העוזר, כמה נכנס. כל חודש, בלי ייפוי." };

export default async function OpenBooks() {
  const rows = await monthlyRows();

  return (
    <main className="page wide">
      <h1>{t("openbooks.title")}</h1>
      <p className="lede cap">{t("openbooks.lede")}</p>

      <div className="scroll">
        <table className="table">
          <thead>
            <tr>
              <th scope="col">{t("openbooks.colMonth")}</th>
              <th scope="col">{t("openbooks.colFamilies")}</th>
              <th scope="col">{t("openbooks.colKids")}</th>
              <th scope="col">{t("openbooks.colSubs")}</th>
              <th scope="col">{t("openbooks.colTokens")}</th>
              <th scope="col">{t("openbooks.colBuild")}</th>
              <th scope="col">{t("openbooks.colIncome")}</th>
              <th scope="col">{t("openbooks.colDiff")}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.month}>
                <th scope="row">{heMonth(r.month)}</th>
                <td>{n(r.families)}</td>
                <td>{n(r.kids)}</td>
                <td>{n(r.subs)}</td>
                <td>{ils(r.token_cost)}</td>
                <td>{ils(r.build_cost)}</td>
                <td>{ils(r.income)}</td>
                <td>{ils(r.difference)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="small">{nums(t("openbooks.rate", { rate: usdIls() }))}</p>

      {rows.some((r) => r.note) ? (
        <section className="panel">
          <h2>{t("openbooks.notes")}</h2>
          {rows
            .filter((r) => r.note)
            .map((r) => (
              <p className="cap" key={r.month}>
                <b>{heMonth(r.month)}</b> — {nums(r.note)}
              </p>
            ))}
        </section>
      ) : null}

      <section className="panel soft">
        <h2>{t("landing.costTitle")}</h2>
        <p>{nums(t("landing.cost"))}</p>
        <p>{t("openbooks.surplus")}</p>
      </section>

      <p className="note">{t("openbooks.honesty")}</p>
      <p className="small">
        <a href="/api/open-books">{t("openbooks.json")} ›</a>
      </p>
    </main>
  );
}

export const dynamic = "force-dynamic";
