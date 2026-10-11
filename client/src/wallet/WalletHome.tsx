// Accueil du wallet, façon MetaMask : un seul wallet (une phrase dans le Wallet du client), un sélecteur de réseau en
// haut, un seul réseau affiché à la fois. Les deux fiches restent montées (masquées) pour garder leur état
// (compte à rebours de recovery, opération préparée) et leurs soldes dans le menu.
import { useEffect, useRef, useState } from "react";
import { type WalletConfig, outputAt } from "@sq/bitcoin";
import { formatUnits } from "viem";
import { USDC_DECIMALS } from "@sq/evm";
import type { BtcAccount } from "../lib/config";
import { priceOf, usePrices } from "../lib/market";
import { btcFmt } from "../lib/format";
import { num } from "../ui/format";
import { useIsMobile } from "../ui/useIsMobile";
import { openCrypto } from "./Account";
import { useT } from "../i18n";
import { Account, BtcIcon, RECEIVE_KEY } from "./Account";
import { EthIcon, Ethereum, type EvmInfo } from "./Ethereum";

type Network = "btc" | "evm";
const NET_KEY = (cid: string) => `sq-wallet:network:${cid}`;
const short = (a: string) => `${a.slice(0, 7)}…${a.slice(-5)}`;
// Changer de réseau depuis le reste de l'appli (accueil, rail) : événement « sq-network ».
export const selectNetwork = (n: Network) => window.dispatchEvent(new CustomEvent("sq-network", { detail: n }));

export function WalletHome({ customerId, cfg, account, custodySats = 0, onLost, onBalance, onUsdc, onContactChanged }: {
  customerId: string; cfg: WalletConfig; account: BtcAccount; custodySats?: number; onLost: () => void; onBalance: (s: bigint) => void; onUsdc?: (u: bigint) => void; onContactChanged: (a: BtcAccount) => void;
}) {
  const mobile = useIsMobile();
  const { tr } = useT();
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
    { id: "evm" as const, icon: <EthIcon size={28} />, name: "Ethereum", sub: "Sepolia · USDC", address: evm.safe ?? null, balance: !evm.added ? tr("Add") : evm.usdc === undefined ? "…" : `${formatUnits(evm.usdc, USDC_DECIMALS)} USDC` },
  ];
  const current = rows.find((r) => r.id === net)!;
  const copy = (a: string) => { navigator.clipboard?.writeText(a); setCopied(a); setTimeout(() => setCopied(null), 1200); };

  const usdcUnits = evm.usdc === undefined ? 0 : Number(evm.usdc) / 10 ** USDC_DECIMALS;
  const btcUnits = Number(btcSats ?? 0n) / 1e8;
  const custodyBtcUnits = custodySats / 1e8;
  const btcPrice = priceOf(market, "bitcoin");
  const usdcPrice = priceOf(market, "usd-coin");
  const btcValue = (btcUnits + custodyBtcUnits) * btcPrice;
  const usdcValue = usdcUnits * usdcPrice;
  const totalValue = btcValue + usdcValue;
  const dailyChange = btcValue * (market?.bitcoin.change24h ?? 0) / 100
    + usdcValue * (market?.["usd-coin"].change24h ?? 0) / 100;
  const chf = (value: number) => `${num(value)} CHF`;
  const changePct = (change: number) => `${change >= 0 ? "+" : ""}${num(change)}%`;
  const assetCount = ((btcSats ?? 0n) > 0n ? 1 : 0)
    + (evm.added && (evm.usdc ?? 0n) > 0n ? 1 : 0)
    + (custodySats > 0 ? 1 : 0);
  const go = (n: Network, panel: string) => { choose(n); setTimeout(() => (n === "btc" ? openCrypto(panel) : window.dispatchEvent(new CustomEvent("sq-evm", { detail: panel }))), 30); };

  const left = (
    <aside className="wallet-left">
      <section className="card kpis">
        <div><p className="kpi-label">{tr("Total crypto value")}</p><p className="kpi"><strong data-testid="crypto-total">{chf(totalValue)}</strong></p></div>
        <div><p className="kpi-label">{tr("Daily change")}</p><p className={`kpi ${dailyChange >= 0 ? "up" : "down"}`}><strong>{dailyChange >= 0 ? "+" : "−"}{chf(Math.abs(dailyChange))}</strong></p></div>
        <div><p className="kpi-label">{tr("Assets")}</p><p className="kpi"><strong>{assetCount}</strong></p></div>
        <p className="muted small kpi-note">{tr("Testnet quantities valued at current mainnet token prices.")}</p>
      </section>
      <section className="card positions" data-testid="positions">
        <div className="card-head"><h3>{tr("Positions")}</h3></div>
        <table>
          <thead><tr><th>{tr("Product · quantity")}</th><th className="num">{tr("Value CHF")}</th><th className="num">24h</th></tr></thead>
          <tbody>
            <tr className="group"><td colSpan={3}>{tr("Self-custody · your keys")}</td></tr>
            <tr className={`pos-row ${net === "btc" ? "on" : ""}`} onClick={() => choose("btc")}>
              <td><span className="pos-name"><BtcIcon size={22} /><span><strong>Bitcoin</strong><span className="muted small">{cfg.network} · {btcSats === null ? "…" : btcFmt(btcSats)}</span></span></span>
                <span className="pos-actions"><button className="pill blue" aria-label="Send BTC" onClick={(e) => { e.stopPropagation(); go("btc", "envoyer"); }}>{tr("Send")}</button><button className="pill red" aria-label="Receive BTC" onClick={(e) => { e.stopPropagation(); go("btc", "recevoir"); }}>{tr("Receive")}</button></span></td>
              <td className="num">{chf(btcUnits * btcPrice)}</td><td className="num">{changePct(market?.bitcoin.change24h ?? 0)}</td>
            </tr>
            <tr className={`pos-row ${net === "evm" ? "on" : ""}`} onClick={() => choose("evm")}>
              <td><span className="pos-name"><EthIcon size={22} /><span><strong>USDC</strong><span className="muted small">Ethereum Sepolia · {evm.usdc === undefined ? "—" : `${num(usdcUnits)} USDC`}</span></span></span>
                {evm.added
                  ? <span className="pos-actions"><button className="pill blue" aria-label="Send USDC (positions)" onClick={(e) => { e.stopPropagation(); go("evm", "send"); }}>{tr("Send")}</button><button className="pill red" aria-label="Receive USDC" onClick={(e) => { e.stopPropagation(); go("evm", "receive"); }}>{tr("Receive")}</button></span>
                  : <span className="pos-actions"><button className="pill" aria-label="Add USDC on Ethereum" onClick={(e) => { e.stopPropagation(); choose("evm"); }}>{tr("Add")}</button></span>}</td>
              <td className="num">{chf(usdcValue)}</td><td className="num">{changePct(market?.["usd-coin"].change24h ?? 0)}</td>
            </tr>
            {custodySats > 0 && (
              <>
                <tr className="group"><td colSpan={3}>{tr("Held by Swissquote · custody")}</td></tr>
                <tr className="pos-row" onClick={() => go("btc", "transferer")}>
                  <td><span className="pos-name"><BtcIcon size={22} /><span><strong>Bitcoin</strong><span className="muted small">{tr("Swissquote crypto account")} · {(custodySats / 1e8).toFixed(8)} BTC</span></span></span>
                    <span className="pos-actions"><button className="pill" aria-label="Open Swissquote account ↔ wallet transfers" onClick={(e) => { e.stopPropagation(); go("btc", "transferer"); }}>{tr("Transfer")}</button></span></td>
                  <td className="num">{chf(custodyBtcUnits * btcPrice)}</td><td className="num">{changePct(market?.bitcoin.change24h ?? 0)}</td>
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
          <p className="wallet-name">{tr("My wallet")}</p>
          <button className="net-pill" data-testid="network-switcher" aria-expanded={open} onClick={() => setOpen(!open)}>
            {current.icon}<span className="net-name">{current.name}</span>
            {current.address && <span className="mono muted">{short(current.address)}</span>}
            <span className="caret">▾</span>
          </button>
        </div>
        {current.address && <button className="link small" onClick={() => copy(current.address!)}>{copied === current.address ? tr("Copied") : tr("Copy address")}</button>}
        {open && (
          <div className="net-menu" role="menu">
            {rows.map((r) => (
              <div key={r.id} className={`net-row ${r.id === net ? "on" : ""}`}>
                <button className="net-choose" role="menuitem" data-testid={`network-${r.id}`} onClick={() => choose(r.id)}>
                  {r.icon}
                  <span className="net-text"><strong>{r.name}</strong><span className="muted small">{r.sub}</span></span>
                  <span className="net-balance">{r.balance}</span>
                </button>
                {r.address && <button className="link mono small net-addr" title={tr("Copy")} onClick={() => copy(r.address!)}>{copied === r.address ? tr("Copied") : `${short(r.address)} ⧉`}</button>}
              </div>
            ))}
            <p className="muted small net-foot">{tr("Both accounts come from the same secret phrase, kept in your Client Wallet. Swissquote never holds their keys.")}</p>
          </div>
        )}
      </div>
      <div hidden={net !== "btc"}>
        <Account key={cfg.client.raw} cfg={cfg} account={account} onLost={onLost} onContactChanged={onContactChanged} onBalance={(s) => { setBtcSats(s); onBalance(s); }} />
      </div>
      <div hidden={net !== "evm"}>
        <Ethereum key={`evm:${account.client}`} customerId={customerId} accountKey={account.client} tiersName={account.tiersName} onInfo={setEvm} />
      </div>
      </div>
    </div>
  );
}
