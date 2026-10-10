// Banque : comptes et opérations (SIMULÉS).
import type { BankAccount } from "../lib/bank";
import { num, signed } from "../ui/format";
import { useIsMobile } from "../ui/useIsMobile";

export function Accounts({ accounts }: { accounts: BankAccount[] | null }) {
  const mobile = useIsMobile();
  if (!accounts) return <section className="card"><p>Chargement…</p></section>;
  return (
    <div className={mobile ? "" : "d-page"}>
      {!mobile && <div className="d-page-head"><h1>Comptes</h1><span className="muted small">Comptes et opérations simulés pour la démo</span></div>}
      {accounts.map((a) => (
        <section key={a.iban} className="card">
          <div className="card-head">
            <div><h2>{a.label}</h2><p className="muted small mono">{a.iban}</p></div>
            <p className="stat">{num(a.balance)} <small>{a.currency}</small></p>
          </div>
          <table className="ops">
            {!mobile && <thead><tr><th>Date</th><th>Libellé</th><th className="num">Montant</th></tr></thead>}
            <tbody>
              {a.transactions.map((t, i) => (
                <tr key={i}><td className="muted">{t.date}</td><td>{t.label}</td><td className={`num ${t.amount < 0 ? "neg" : "pos"}`}>{signed(t.amount)} CHF</td></tr>
              ))}
            </tbody>
          </table>
        </section>
      ))}
      {mobile && <p className="muted small center">Comptes et opérations simulés pour la démo.</p>}
    </div>
  );
}
