// Banque : comptes et opérations (SIMULÉS).
import type { BankAccount } from "../lib/bank";
import { num, signed } from "../ui/format";
import { useIsMobile } from "../ui/useIsMobile";

export function Accounts({ accounts }: { accounts: BankAccount[] | null }) {
  const mobile = useIsMobile();
  if (!accounts) return <section className="card"><p>Loading…</p></section>;
  return (
    <div className={mobile ? "" : "d-page"}>
      {!mobile && <div className="d-page-head"><h1>Accounts</h1><span className="muted small">Accounts and transactions simulated for the demo</span></div>}
      {accounts.map((a) => (
        <section key={a.iban} className="card">
          <div className="card-head">
            <div><h2>{a.label}</h2><p className="muted small mono">{a.iban}</p></div>
            <p className="stat">{num(a.balance)} <small>{a.currency}</small></p>
          </div>
          <table className="ops">
            {!mobile && <thead><tr><th>Date</th><th>Description</th><th className="num">Amount</th></tr></thead>}
            <tbody>
              {a.transactions.map((t, i) => (
                <tr key={i}><td className="muted">{t.date}</td><td>{t.label}</td><td className={`num ${t.amount < 0 ? "neg" : "pos"}`}>{signed(t.amount)} CHF</td></tr>
              ))}
            </tbody>
          </table>
        </section>
      ))}
      {mobile && <p className="muted small center">Accounts and transactions simulated for the demo.</p>}
    </div>
  );
}
