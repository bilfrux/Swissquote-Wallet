// Accueil : patrimoine (comptes CHF SIMULÉS + wallet Bitcoin réel), sur le modèle de l'appli et de la plateforme Swissquote.
import { useMemo, useState } from "react";
import type { BankAccount } from "../lib/bank";
import { priceOf, usePrices } from "../lib/market";
import { btcFmt } from "../lib/format";
import { Chart } from "../ui/Chart";
import { num, signed } from "../ui/format";
import { IconCash, IconChevron, IconCrypto, IconList, IconPortfolio, IconReceive, IconSavings, IconSend, SwissFlag } from "../ui/icons";
import type { Tab } from "../ui/Shell";
import { useIsMobile } from "../ui/useIsMobile";

const PERIODS = ["1W", "1M", "6M", "1Y", "All"] as const;
type Period = (typeof PERIODS)[number];
// Courbe SIMULÉE (déterministe) qui se termine sur la valeur actuelle : illustration de l'interface, pas des données.
function series(total: number, period: Period) {
  const n = { "1W": 7, "1M": 30, "6M": 26, "1Y": 52, All: 60 }[period];
  const amp = { "1W": 0.004, "1M": 0.012, "6M": 0.04, "1Y": 0.07, All: 0.12 }[period];
  return Array.from({ length: n }, (_, i) => total * (1 - amp * (1 - i / (n - 1)) + amp * 0.35 * Math.sin(i * 1.7 + n)));
}

type Props = { accounts: BankAccount[] | null; btcSats: bigint | null | undefined; custodySats?: number; usdc?: bigint | null; customerId: string; onTab: (t: Tab, anchor?: string) => void };

export function Overview({ accounts, btcSats, custodySats = 0, usdc = null, customerId, onTab }: Props) {
  const market = usePrices();
  const mobile = useIsMobile();
  const [period, setPeriod] = useState<Period>("1W");
  const cash = (accounts ?? []).reduce((s, a) => s + a.balance, 0);
  // Prix du marché (CoinGecko) ou cours simulé ; « Crypto » = wallet self-custody (BTC + USDC).
  const usdcChf = usdc === null ? 0 : (Number(usdc) / 1e6) * priceOf(market, "usd-coin");
  const btcChf = btcSats == null ? 0 : (Number(btcSats) / 1e8) * priceOf(market, "bitcoin");
  const selfChf = btcChf + usdcChf;
  const custodyChf = (custodySats / 1e8) * priceOf(market, "bitcoin");
  const total = cash + selfChf + custodyChf;
  const points = useMemo(() => series(total || 1, period), [total, period]);
  const change = total - points[points.length - 2];
  const pct = points[points.length - 2] ? (change / points[points.length - 2]) * 100 : 0;
  const priv = accounts?.find((a) => /private/i.test(a.label));
  const save = accounts?.find((a) => /savings/i.test(a.label));
  const recent = (accounts ?? []).flatMap((a) => a.transactions.map((t) => ({ ...t, account: a.label }))).sort((a, b) => b.date.localeCompare(a.date)).slice(0, 5);

  const periodSelector = (
    <div className="segmented">{PERIODS.map((p) => <button key={p} className={p === period ? "on" : ""} onClick={() => setPeriod(p)}>{p}</button>)}</div>
  );
  const changeLine = (
    <p className={change >= 0 ? "up" : "down"}>
      {signed(change)} CHF {change >= 0 ? "▲" : "▼"} {num(Math.abs(pct))}% <span className="muted">daily change (simulated)</span>
    </p>
  );

  if (mobile)
    return (
      <div className="m-home">
        <p className="m-total-label">Total value</p>
        <p className="m-total"><strong>{num(total)}</strong> CHF</p>
        <section className="card">
          <p className="muted-strong">Portfolio {customerId}</p>
          <p className="m-amount">{num(total)} <SwissFlag /></p>
          {changeLine}
          <Chart points={points} height={110} />
          {periodSelector}
          <div className="tiles">
            <button className="tile-btn" onClick={() => onTab("banque")}><span><IconPortfolio /> Accounts</span><strong>{num(cash)}</strong><IconChevron /></button>
            <button className="tile-btn" data-testid="home-crypto" onClick={() => onTab("crypto")}><span><IconCrypto /> Crypto</span><strong>{btcSats === undefined ? "…" : btcSats === null ? "Create" : num(selfChf)}</strong><IconChevron /></button>
            <button className="tile-btn" onClick={() => onTab("banque")}><span><IconCash /> Cash</span><strong>{num(priv?.balance ?? 0)}</strong><IconChevron /></button>
            <button className="tile-btn" onClick={() => onTab("banque")}><span><IconSavings /> Savings</span><strong>{num(save?.balance ?? 0)}</strong><IconChevron /></button>
          </div>
          <div className="round-actions">
            <button onClick={() => onTab("crypto", "recevoir")}><span className="round dark"><IconReceive /></span>Receive</button>
            <button onClick={() => onTab("crypto", "envoyer")}><span className="round dark"><IconSend /></span>Send</button>
            <button onClick={() => onTab("banque")}><span className="round dark"><IconList /></span>Transactions</button>
          </div>
        </section>
      </div>
    );

  return (
    <div className="d-page">
      <div className="d-page-head">
        <h1>Overview</h1>
        <span className="muted small">Client {customerId} · IBAN {priv?.iban ?? "—"}</span>
      </div>
      <div className="d-cols">
        <div className="d-col-main">
          <section className="card stats">
            <div><p className="stat-label"><IconCash /> CHF accounts</p><p className="stat">{num(cash)} <small>CHF</small></p></div>
            <div><p className="stat-label"><IconCrypto /> Crypto</p><p className="stat">{num(selfChf)} <small>CHF</small></p></div>
            <div><p className="stat-label"><IconPortfolio /> Total value</p><p className="stat">{num(total)} <small>CHF</small></p></div>
          </section>
          <section className="card rows">
            <h2>Accounts</h2>
            {(accounts ?? []).map((a) => (
              <button key={a.iban} className="row-line" onClick={() => onTab("banque")}>
                <span>{a.label}<small className="muted mono"> {a.iban}</small></span><strong>{num(a.balance)} {a.currency}</strong><IconChevron />
              </button>
            ))}
            {custodySats > 0 && (
              <button className="row-line" onClick={() => onTab("crypto", "transferer")}>
                <span>Swissquote crypto account<small className="muted"> held in custody by Swissquote</small></span><strong>{btcFmt(BigInt(custodySats))} · {num(custodyChf)} CHF</strong><IconChevron />
              </button>
            )}
          </section>
          <section className="card rows" data-testid="home-crypto">
            <h2>Crypto · self-custody</h2>
            <button className="row-line" onClick={() => onTab("crypto")}>
              <span>Bitcoin wallet <small className="muted">only you hold the key</small></span>
              <strong>{btcSats === undefined ? "…" : btcSats === null ? "Create my wallet" : `${btcFmt(btcSats)} · ${num(btcChf)} CHF`}</strong><IconChevron />
            </button>
            {usdc !== null && (
              <button className="row-line" onClick={() => onTab("crypto")}>
                <span>USDC on Ethereum <small className="muted">same wallet, only you hold the key</small></span>
                <strong>{`${(Number(usdc) / 1e6).toFixed(2)} USDC · ${num(usdcChf)} CHF`}</strong><IconChevron />
              </button>
            )}
          </section>
          <section className="card rows">
            <h2>Recent transactions</h2>
            <table>
              <tbody>{recent.map((t, i) => <tr key={i}><td className="muted">{t.date}</td><td>{t.label}<small className="muted"> · {t.account}</small></td><td className={`num ${t.amount < 0 ? "neg" : "pos"}`}>{signed(t.amount)} CHF</td></tr>)}</tbody>
            </table>
          </section>
        </div>
        <div className="d-col-side">
          <section className="card">
            <h2>Portfolio performance</h2>
            <p className="d-chart-value">{num(total)} CHF</p>
            {changeLine}
            <Chart points={points} height={150} />
            {periodSelector}
          </section>
          <section className="card highlight">
            <h2>Your Bitcoin wallet</h2>
            <p className="small">Only you hold the key. If you lose it, Swissquote and your trusted contact can together help you recover your funds, without ever being able to act alone.</p>
            <button className="btn-primary" onClick={() => onTab("crypto")}>{btcSats === undefined ? "Open" : btcSats === null ? "Create my wallet" : "Open my wallet"}</button>
          </section>
        </div>
      </div>
    </div>
  );
}
