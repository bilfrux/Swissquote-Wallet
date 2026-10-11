// Banque : comptes et opérations (SIMULÉS).
import type { BankAccount } from "../lib/bank";
import { num, signed } from "../ui/format";
import { useIsMobile } from "../ui/useIsMobile";
import { useT } from "../i18n";

export function Accounts({ accounts }: { accounts: BankAccount[] | null }) {
  const mobile = useIsMobile();
  const { t } = useT();
  if (!accounts) return <section className="card"><p>{t("ac.loading")}</p></section>;
  return (
    <div className={mobile ? "" : "d-page"}>
      {!mobile && <div className="d-page-head"><h1>{t("ac.title")}</h1><span className="muted small">{t("ac.sim")}</span></div>}
      {accounts.map((a) => (
        <section key={a.iban} className="card">
          <div className="card-head">
            <div><h2>{a.label}</h2><p className="muted small mono">{a.iban}</p></div>
            <p className="stat">{num(a.balance)} <small>{a.currency}</small></p>
          </div>
          <table className="ops">
            {!mobile && <thead><tr><th>{t("ac.date")}</th><th>{t("ac.desc")}</th><th className="num">{t("ac.amount")}</th></tr></thead>}
            <tbody>
              {a.transactions.map((r, i) => (
                <tr key={i}><td className="muted">{r.date}</td><td>{r.label}</td><td className={`num ${r.amount < 0 ? "neg" : "pos"}`}>{signed(r.amount)} CHF</td></tr>
              ))}
            </tbody>
          </table>
        </section>
      ))}
      {mobile && <p className="muted small center">{t("ac.sim")}.</p>}
    </div>
  );
}
