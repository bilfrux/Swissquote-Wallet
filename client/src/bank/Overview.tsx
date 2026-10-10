// Aperçu du patrimoine : comptes CHF (simulés) et wallet Bitcoin (réel, self-custody).
import type { BankAccount } from "../lib/bank";
import { BTC_CHF } from "../lib/config";
import { btcFmt } from "../lib/format";

const chf = (n: number) => n.toLocaleString("fr-CH", { style: "currency", currency: "CHF" });

export function Overview({ accounts, btcSats, onOpenWallet }: { accounts: BankAccount[] | null; btcSats: bigint | null; onOpenWallet: () => void }) {
  const btcChf = btcSats === null ? 0 : (Number(btcSats) / 1e8) * BTC_CHF;
  const total = (accounts ?? []).reduce((s, a) => s + a.balance, 0) + btcChf;
  return (
    <>
      <section className="hero">
        <p className="label">Patrimoine total</p>
        <p className="big">{chf(total)}</p>
        <p className="note small-text">Bitcoin converti au cours simulé de {chf(BTC_CHF)} / BTC</p>
      </section>
      <div className="grid">
        {(accounts ?? []).map((a) => (
          <section key={a.iban} className="tile">
            <p className="label">{a.label}</p>
            <p className="amount">{chf(a.balance)}</p>
            <p className="mono small-text">{a.iban}</p>
          </section>
        ))}
        <section className="tile crypto" onClick={onOpenWallet} role="button">
          <p className="label">Wallet Bitcoin · self-custody</p>
          <p className="amount">{btcSats === null ? "—" : btcFmt(btcSats)}</p>
          <p className="small-text">{btcSats === null ? "Créer mon wallet →" : `≈ ${chf(btcChf)} · vous seul détenez la clé`}</p>
        </section>
      </div>
    </>
  );
}
