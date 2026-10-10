// Comptes bancaires (SIMULÉS) et dernières opérations.
import type { BankAccount } from "../lib/bank";

const chf = (n: number) => n.toLocaleString("fr-CH", { style: "currency", currency: "CHF" });

export function Accounts({ accounts }: { accounts: BankAccount[] | null }) {
  if (!accounts) return <section><p>Chargement…</p></section>;
  return (
    <>
      {accounts.map((a) => (
        <section key={a.iban}>
          <h2>{a.label} <span className="amount-inline">{chf(a.balance)}</span></h2>
          <p className="mono small-text">{a.iban}</p>
          <table>
            <thead><tr><th>Date</th><th>Libellé</th><th className="num">Montant</th></tr></thead>
            <tbody>
              {a.transactions.map((t, i) => (
                <tr key={i}><td>{t.date}</td><td>{t.label}</td><td className={`num ${t.amount < 0 ? "neg" : "pos"}`}>{chf(t.amount)}</td></tr>
              ))}
            </tbody>
          </table>
        </section>
      ))}
      <p className="note small-text">Comptes et opérations simulés pour la démo.</p>
    </>
  );
}
