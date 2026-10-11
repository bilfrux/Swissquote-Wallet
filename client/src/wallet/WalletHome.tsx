// Accueil du wallet, façon MetaMask : un seul wallet (une phrase dans le Wallet du client), un sélecteur de réseau en
// haut, un seul réseau affiché à la fois. Les deux fiches restent montées (masquées) pour garder leur état
// (compte à rebours de recovery, opération préparée) et leurs soldes dans le menu.
import { useEffect, useRef, useState } from "react";
import { type WalletConfig, outputAt } from "@sq/bitcoin";
import { formatUnits } from "viem";
import { USDC_DECIMALS } from "@sq/evm";
import type { BtcAccount } from "../lib/config";
import { btcFmt } from "../lib/format";
import { priceOf, usePrices } from "../lib/market";
import { num } from "../ui/format";
import { useIsMobile } from "../ui/useIsMobile";
import { openCrypto } from "./Account";
import { Account, BtcIcon, RECEIVE_KEY } from "./Account";
import { EthIcon, Ethereum, type EvmInfo } from "./Ethereum";

type Network = "btc" | "evm";
const NET_KEY = (cid: string) => `sq-wallet:network:${cid}`;
const short = (a: string) => `${a.slice(0, 7)}…${a.slice(-5)}`;
// Changer de réseau depuis le reste de l'appli (accueil, rail) : événement « sq-network ».
export const selectNetwork = (n: Network) => window.dispatchEvent(new CustomEvent("sq-network", { detail: n }));

export function WalletHome({ customerId, cfg, account, custodySats = 0, onLost, onBalance, onUsdc }: {
  customerId: string; cfg: WalletConfig; account: BtcAccount; custodySats?: number; onLost: () => void; onBalance: (s: bigint) => void; onUsdc?: (u: bigint) => void;
}) {
  const mobile = useIsMobile();
  const market = usePrices();
  const [net, setNet] = useState<Network>(() => (localStorage.getItem(NET_KEY(customerId)) as Network) ?? "btc");
  const [open, setOpen] = useState(false);
  const [btcSats, setBtcSats] = useState<bigint | null>(null);
  const [evm, setEvmState] = useState<EvmInfo>({ added: false });
  const setEvm = (i: EvmInfo) => { setEvmState(i); if (i.usdc !== undefined) onUsdc?.(i.usdc); };
  const [copied, setCopied] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const choose = (n: Network) => { setNet(n); localStorage.setItem(NET_KEY(customerId), n); setOpen(false); };
  useEffect(() => {
    const on = (e: Event) => choose((e as CustomEvent<Network>).detail);
    const close = (e: MouseEvent) => { if (!menuRef.current?.contains(e.target as Node)) setOpen(false); };
    window.addEventListener("sq-network", on);
    document.addEventListener("mousedown", close);
    return () => { window.removeEventListener("sq-network", on); document.removeEventListener("mousedown", close); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const btcAddress = outputAt(cfg, 0, Number(localStorage.getItem(RECEIVE_KEY(cfg)) ?? 0)).getAddress();
  const rows = [
    { id: "btc" as const, icon: <BtcIcon size={28} />, name: "Bitcoin", sub: `${cfg.network} · BTC`, address: btcAddress, balance: btcSats === null ? "…" : btcFmt(btcSats) },
    { id: "evm" as const, icon: <EthIcon size={28} />, name: "Ethereum", sub: "Sepolia · USDC", address: evm.safe ?? null, balance: !evm.added ? "Add" : evm.usdc === undefined ? "…" : `${formatUnits(evm.usdc, USDC_DECIMALS)} USDC` },
  ];
  const current = rows.find((r) => r.id === net)!;
  const copy = (a: string) => { navigator.clipboard?.writeText(a); setCopied(a); setTimeout(() => setCopied(null), 1200); };

  // Vue d'ensemble et positions (prix du marché ; coins de test sans valeur réelle).
  const btcPx = priceOf(market, "bitcoin"), usdcPx = priceOf(market, "usd-coin");
  const btcChf = btcSats === null ? 0 : (Number(btcSats) / 1e8) * btcPx;
  const usdcUnits = evm.usdc === undefined ? 0 : Number(evm.usdc) / 10 ** USDC_DECIMALS;
  const usdcChf = usdcUnits * usdcPx;
  const custodyChf = (custodySats / 1e8) * btcPx;
  const total = btcChf + usdcChf + custodyChf;
  const daily = btcChf * ((market?.bitcoin.change24h ?? 0) / 100) / (1 + (market?.bitcoin.change24h ?? 0) / 100)
    + usdcChf * ((market?.["usd-coin"].change24h ?? 0) / 100) / (1 + (market?.["usd-coin"].change24h ?? 0) / 100)
    + custodyChf * ((market?.bitcoin.change24h ?? 0) / 100) / (1 + (market?.bitcoin.change24h ?? 0) / 100);
  const pct = (c: number | undefined) => <span className={(c ?? 0) >= 0 ? "up" : "down"}>{(c ?? 0) >= 0 ? "+" : ""}{num(c ?? 0)}%</span>;
  const go = (n: Network, panel: string) => { choose(n); setTimeout(() => (n === "btc" ? openCrypto(panel) : window.dispatchEvent(new CustomEvent("sq-evm", { detail: panel }))), 30); };

  const left = (
    <aside className="wallet-left">
      <section className="card kpis">
        <div><p className="kpi-label">Total crypto value</p><p className="kpi"><strong data-testid="crypto-total">{num(total)}</strong> CHF</p></div>
        <div><p className="kpi-label">Daily change</p><p className={`kpi ${daily >= 0 ? "up" : "down"}`}><strong>{daily >= 0 ? "+" : "−"}{num(Math.abs(daily))}</strong> CHF</p></div>
        <div><p className="kpi-label">Assets</p><p className="kpi"><strong>{2 + (custodySats > 0 ? 1 : 0)}</strong></p></div>
        <p className="muted small kpi-note">{market?.bitcoin.source === "CoinGecko" ? "Market prices (CoinGecko). The wallet's coins are on test networks and have no value." : "Simulated rates (market data unavailable)."}</p>
      </section>
      <section className="card positions" data-testid="positions">
        <div className="card-head"><h3>Positions</h3></div>
        <table>
          <thead><tr><th>Product · quantity</th><th className="num">Value CHF</th><th className="num">24h</th></tr></thead>
          <tbody>
            <tr className="group"><td colSpan={3}>Self-custody · your keys</td></tr>
            <tr className={`pos-row ${net === "btc" ? "on" : ""}`} onClick={() => choose("btc")}>
              <td><span className="pos-name"><BtcIcon size={22} /><span><strong>Bitcoin</strong><span className="muted small">{cfg.network} · {btcSats === null ? "…" : btcFmt(btcSats)}</span></span></span>
                <span className="pos-actions"><button className="pill blue" aria-label="Send BTC" onClick={(e) => { e.stopPropagation(); go("btc", "envoyer"); }}>Send</button><button className="pill red" aria-label="Receive BTC" onClick={(e) => { e.stopPropagation(); go("btc", "recevoir"); }}>Receive</button></span></td>
              <td className="num">{num(btcChf)}</td><td className="num">{pct(market?.bitcoin.change24h)}</td>
            </tr>
            <tr className={`pos-row ${net === "evm" ? "on" : ""}`} onClick={() => choose("evm")}>
              <td><span className="pos-name"><EthIcon size={22} /><span><strong>USDC</strong><span className="muted small">Ethereum Sepolia · {evm.usdc === undefined ? "—" : `${num(usdcUnits)} USDC`}</span></span></span>
                {evm.added
                  ? <span className="pos-actions"><button className="pill blue" aria-label="Send USDC (positions)" onClick={(e) => { e.stopPropagation(); go("evm", "send"); }}>Send</button><button className="pill red" aria-label="Receive USDC" onClick={(e) => { e.stopPropagation(); go("evm", "receive"); }}>Receive</button></span>
                  : <span className="pos-actions"><button className="pill" aria-label="Add USDC on Ethereum" onClick={(e) => { e.stopPropagation(); choose("evm"); }}>Add</button></span>}</td>
              <td className="num">{num(usdcChf)}</td><td className="num">{pct(market?.["usd-coin"].change24h)}</td>
            </tr>
            {custodySats > 0 && (
              <>
                <tr className="group"><td colSpan={3}>Held by Swissquote · custody</td></tr>
                <tr className="pos-row" onClick={() => go("btc", "transferer")}>
                  <td><span className="pos-name"><BtcIcon size={22} /><span><strong>Bitcoin</strong><span className="muted small">Swissquote crypto account · {(custodySats / 1e8).toFixed(8)} BTC</span></span></span>
                    <span className="pos-actions"><button className="pill" aria-label="Open Swissquote account ↔ wallet transfers" onClick={(e) => { e.stopPropagation(); go("btc", "transferer"); }}>Transfer</button></span></td>
                  <td className="num">{num(custodyChf)}</td><td className="num">{pct(market?.bitcoin.change24h)}</td>
                </tr>
              </>
            )}
          </tbody>
        </table>
      </section>
    </aside>
  );

  return (
    <div className={mobile ? "wallet-page m" : "wallet-page"} data-testid="wallet-page">
      {left}
      <div className="wallet-main">
      <div className="wallet-bar" ref={menuRef}>
        <div>
          <p className="wallet-name">My wallet</p>
          <button className="net-pill" data-testid="network-switcher" aria-expanded={open} onClick={() => setOpen(!open)}>
            {current.icon}<span className="net-name">{current.name}</span>
            {current.address && <span className="mono muted">{short(current.address)}</span>}
            <span className="caret">▾</span>
          </button>
        </div>
        {current.address && <button className="link small" onClick={() => copy(current.address!)}>{copied === current.address ? "Copied" : "Copy address"}</button>}
        {open && (
          <div className="net-menu" role="menu">
            {rows.map((r) => (
              <div key={r.id} className={`net-row ${r.id === net ? "on" : ""}`}>
                <button className="net-choose" role="menuitem" data-testid={`network-${r.id}`} onClick={() => choose(r.id)}>
                  {r.icon}
                  <span className="net-text"><strong>{r.name}</strong><span className="muted small">{r.sub}</span></span>
                  <span className="net-balance">{r.balance}</span>
                </button>
                {r.address && <button className="link mono small net-addr" title="Copy" onClick={() => copy(r.address!)}>{copied === r.address ? "Copied" : `${short(r.address)} ⧉`}</button>}
              </div>
            ))}
            <p className="muted small net-foot">Both accounts come from the same secret phrase, kept in your Client Wallet. Swissquote never holds their keys.</p>
          </div>
        )}
      </div>
      <div hidden={net !== "btc"}>
        <Account key={cfg.client.raw} cfg={cfg} account={account} onLost={onLost} onBalance={(s) => { setBtcSats(s); onBalance(s); }} />
      </div>
      <div hidden={net !== "evm"}>
        <Ethereum key={`evm:${account.client}`} customerId={customerId} accountKey={account.client} tiersName={account.tiersName} onInfo={setEvm} />
      </div>
      </div>
    </div>
  );
}
