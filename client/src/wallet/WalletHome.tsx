// Accueil du wallet, façon MetaMask : un seul wallet (une phrase dans le Wallet du client), un sélecteur de réseau en
// haut, un seul réseau affiché à la fois. Les deux fiches restent montées (masquées) pour garder leur état
// (compte à rebours de recovery, opération préparée) et leurs soldes dans le menu.
import { useEffect, useRef, useState } from "react";
import { type WalletConfig, outputAt } from "@sq/bitcoin";
import { formatUnits } from "viem";
import { USDC_DECIMALS } from "@sq/evm";
import type { BtcAccount } from "../lib/config";
import { btcFmt } from "../lib/format";
import { Account, BtcIcon, RECEIVE_KEY } from "./Account";
import { EthIcon, Ethereum, type EvmInfo } from "./Ethereum";

type Network = "btc" | "evm";
const NET_KEY = (cid: string) => `sq-wallet:network:${cid}`;
const short = (a: string) => `${a.slice(0, 7)}…${a.slice(-5)}`;
// Changer de réseau depuis le reste de l'appli (accueil, rail) : événement « sq-network ».
export const selectNetwork = (n: Network) => window.dispatchEvent(new CustomEvent("sq-network", { detail: n }));

export function WalletHome({ customerId, cfg, account, onLost, onBalance }: {
  customerId: string; cfg: WalletConfig; account: BtcAccount; onLost: () => void; onBalance: (s: bigint) => void;
}) {
  const [net, setNet] = useState<Network>(() => (localStorage.getItem(NET_KEY(customerId)) as Network) ?? "btc");
  const [open, setOpen] = useState(false);
  const [btcSats, setBtcSats] = useState<bigint | null>(null);
  const [evm, setEvm] = useState<EvmInfo>({ added: false });
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

  return (
    <>
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
    </>
  );
}
