// Fiche « Bitcoin » de l'onglet Crypto, sur le modèle de la plateforme Swissquote :
// en-tête d'actif + actions, sous-onglets (Historique, Coins, Sécurité) et panneau d'action à droite
// (Recevoir par défaut, Envoyer, Rafraîchir). Sur téléphone : tout empilé, panneau sous les actions.
import { useCallback, useEffect, useRef, useState } from "react";
import QRCode from "qrcode";
import { type HistoryEntry, type WalletConfig, type WalletUtxo, history, outputAt, scan } from "@sq/bitcoin";
import { addrLink, chain, txLink } from "../lib/chain";
import type { BtcAccount } from "../lib/config";
import { priceOf, usePrices } from "../lib/market";
import { PriceChart } from "../ui/PriceChart";
import { btcFmt } from "../lib/format";
import { proveOwnership } from "../lib/ownership";
import { num } from "../ui/format";
import { IconBank, IconReceive, IconRefresh, IconSend, IconShield } from "../ui/icons";
import { useIsMobile } from "../ui/useIsMobile";
import { Send } from "./Send";
import { Transfer } from "./Transfer";

export const RECEIVE_KEY = (cfg: WalletConfig) => `sq-wallet:receive-index:${cfg.network}:${cfg.client.fingerprint}`;
const KIND: Record<HistoryEntry["kind"], string> = {
  "reçu": "Received", "reçu par recovery": "Received by recovery", "envoyé": "Sent", "rafraîchissement": "Refresh", "recovery sortante": "Recovery (Swissquote + trusted contact)",
};
type Panel = "recevoir" | "envoyer" | "rafraichir" | "transferer";
type SubTab = "historique" | "coins" | "securite";
// Navigation depuis le reste de l'appli (accueil, rail) : événement « sq-crypto » avec le panneau ou l'onglet visé.
export const openCrypto = (target: string) => window.dispatchEvent(new CustomEvent("sq-crypto", { detail: target }));

export const BtcIcon = ({ size = 44 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 44 44" aria-hidden="true"><circle cx="22" cy="22" r="22" fill="#f7931a" /><text x="22" y="30" textAnchor="middle" fontSize="24" fontWeight="700" fill="#fff" fontFamily="Arial">₿</text></svg>
);

export function Account({ cfg, account, onLost, onBalance }: { cfg: WalletConfig; account: BtcAccount; onLost: () => void; onBalance: (s: bigint) => void }) {
  const mobile = useIsMobile();
  const market = usePrices();
  const [utxos, setUtxos] = useState<WalletUtxo[] | null>(null);
  const [hist, setHist] = useState<HistoryEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [panel, setPanel] = useState<Panel>("recevoir");
  const [sub, setSub] = useState<SubTab>("historique");
  const [receiveIndex, setReceiveIndex] = useState(() => Number(localStorage.getItem(RECEIVE_KEY(cfg)) ?? 0));
  const [qr, setQr] = useState<string>("");
  const [proof, setProof] = useState<{ ok: boolean; text: string } | null>(null);
  const [proving, setProving] = useState(false);
  const [sendTo, setSendTo] = useState<string | undefined>(undefined);
  const panelRef = useRef<HTMLDivElement>(null);
  const address = outputAt(cfg, 0, receiveIndex).getAddress();
  const tiers = account.tiersName || "your trusted contact";

  // Seule la réponse du DERNIER scan lancé est prise en compte (un scan plus ancien ne peut pas écraser le solde).
  const lastScan = useRef(0);
  const refresh = useCallback(async () => {
    const n = ++lastScan.current;
    setError(null);
    try {
      const u = await scan(cfg, chain);
      if (n !== lastScan.current) return;
      setUtxos(u);
      onBalance(u.reduce((s, x) => s + x.value, 0n));
      history(cfg, chain).then((h) => { if (n === lastScan.current) setHist(h); }, () => undefined);
    } catch (e: any) { if (n === lastScan.current) setError(`cannot read the chain: ${e.message}`); }
  }, [cfg]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { refresh(); }, [refresh]);
  useEffect(() => { QRCode.toString(`bitcoin:${address}`, { type: "svg", margin: 1, width: 180 }).then(setQr, () => setQr("")); }, [address]);
  useEffect(() => {
    const on = (e: Event) => {
      const t = (e as CustomEvent<string>).detail;
      if (t === "recevoir" || t === "envoyer" || t === "rafraichir" || t === "transferer") { setPanel(t); if (mobile) panelRef.current?.scrollIntoView({ behavior: "smooth" }); }
      if (t === "historique" || t === "coins" || t === "securite") setSub(t);
    };
    window.addEventListener("sq-crypto", on);
    return () => window.removeEventListener("sq-crypto", on);
  }, [mobile]);

  const prove = async () => {
    setProof(null);
    setProving(true);
    try {
      const v = await proveOwnership(cfg, receiveIndex);
      setProof({ ok: v.verified, text: v.proves });
    } catch (e: any) { setProof({ ok: false, text: e.message }); } finally { setProving(false); }
  };
  const open = (p: Panel) => { setPanel(p); if (mobile) setTimeout(() => panelRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 30); };

  const balance = (utxos ?? []).reduce((s, u) => s + u.value, 0n);
  const balanceChf = (Number(balance) / 1e8) * priceOf(market, "bitcoin");
  const nextOpen = utxos?.length ? Math.min(...utxos.map((u) => u.recoveryOpensIn)) : null;
  const soon = (utxos ?? []).filter((u) => u.recoveryOpensIn <= Math.ceil(cfg.delay / 3));
  const link = addrLink(address);
  const status = nextOpen === null ? null : nextOpen === 0 ? { cls: "bad", text: "Recovery open on a coin" } : nextOpen <= Math.ceil(cfg.delay / 3) ? { cls: "warn", text: `Recovery possible in ${nextOpen} block(s)` } : { cls: "ok", text: `Recovery possible in ${nextOpen} block(s)` };

  const header = (
    <section className="card asset-head">
      <div className="asset-id">
        <BtcIcon />
        <div><h1>Bitcoin</h1><p className="muted small">BTC · self-custody · {cfg.network}</p></div>
        {!mobile && <button className="link refresh" onClick={refresh}><IconRefresh /> Reload</button>}
      </div>
      <div className="asset-balance">
        <p className="asset-btc" data-testid="btc-balance">{utxos ? btcFmt(balance) : "…"}</p>
        <p className="muted">≈ {num(balanceChf)} CHF <span className="small">({market?.bitcoin.source === "CoinGecko" ? "market price, test coins have no value" : "simulated rate"})</span>{mobile && <> · <button className="link" onClick={refresh}>Reload</button></>}</p>
        {status && <span className={`chip ${status.cls}`}><IconShield /> {status.text}</span>}
      </div>
      <div className="round-actions asset-actions">
        <button className={panel === "recevoir" ? "on" : ""} onClick={() => open("recevoir")}><span className="round dark"><IconReceive /></span>Receive</button>
        <button className={panel === "envoyer" ? "on" : ""} onClick={() => open("envoyer")}><span className="round dark"><IconSend /></span>Send</button>
        <button className={panel === "rafraichir" ? "on" : ""} onClick={() => open("rafraichir")}><span className="round dark"><IconRefresh /></span>Refresh</button>
        <button className={panel === "transferer" ? "on" : ""} onClick={() => open("transferer")}><span className="round dark"><IconBank /></span>Transfer</button>
      </div>
    </section>
  );

  const receivePanel = (
    <section className="card side-panel" id="recevoir">
      <h2>Receive bitcoin</h2>
      {qr && <div className="qr" dangerouslySetInnerHTML={{ __html: qr }} />}
      <p className="mono address">{address}</p>
      <div className="btn-row">
        <button className="btn-secondary" onClick={() => navigator.clipboard?.writeText(address)}>Copy address</button>
        <button className="btn-secondary" onClick={() => { const n = receiveIndex + 1; localStorage.setItem(RECEIVE_KEY(cfg), String(n)); setReceiveIndex(n); setProof(null); }}>New address</button>
      </div>
      <p className="muted small">Address #{receiveIndex}{link && <> · <a href={link} target="_blank" rel="noreferrer">view in explorer</a></>}</p>
      <div className="divider" />
      <p className="small">For the Travel Rule, prove to Swissquote that you control this address. Your wallet signs a challenge, without moving any funds.</p>
      <button className="btn-secondary wide" disabled={proving} onClick={prove}>Prove to Swissquote that I control this address</button>
      {proof && <p className={proof.ok ? "success" : "error"} data-testid="ownership-result">{proof.ok ? "Ownership verified. " : ""}{proof.text}</p>}
    </section>
  );
  const sidePanel = panel === "recevoir" ? receivePanel : panel === "transferer" ? (
    <section className="card side-panel" id="transferer">
      <div className="panel-head">
        <h2>Swissquote account ↔ wallet</h2>
        <button className="link" aria-label="Close" onClick={() => setPanel("recevoir")}>✕</button>
      </div>
      <Transfer cfg={cfg} receiveIndex={receiveIndex} onDone={refresh} onDeposit={(addr) => { setSendTo(addr); setPanel("envoyer"); }} />
    </section>
  ) : (
    <section className="card side-panel" id={panel}>
      <div className="panel-head">
        <h2>{panel === "envoyer" ? "Send bitcoin" : "Refresh my coins"}</h2>
        <button className="link" aria-label="Close" onClick={() => setPanel("recevoir")}>✕</button>
      </div>
      {utxos && utxos.length > 0
        ? <Send key={`${panel}:${sendTo ?? ""}`} cfg={cfg} utxos={utxos} onSent={refresh} mode={panel === "rafraichir" ? "refresh" : "send"} initialTo={panel === "envoyer" ? sendTo : undefined} />
        : <p className="muted">No coins to spend.</p>}
    </section>
  );

  const chart = <section className="card"><PriceChart coin="bitcoin" label="Bitcoin · BTC/CHF" /></section>;
  const tabs = (
    <section className="card">
      <div className="segmented crypto-tabs">
        {([["historique", "Activity"], ["coins", "Coins"], ["securite", "Security"]] as const).map(([k, l]) => (
          <button key={k} className={sub === k ? "on" : ""} onClick={() => setSub(k)}>{l}</button>
        ))}
      </div>
      {sub === "historique" && (
        <div data-testid="history">
          {!hist && <p className="muted small">Loading…</p>}
          {hist && hist.length === 0 && <p className="muted small">No transactions.</p>}
          {hist && hist.length > 0 && (
            <div className="tx-list">
              {hist.map((h) => (
                <div key={h.txid} className={`tx-row kind-${h.kind.replace(/ /g, "-")}`}>
                  <span className={`tx-icon ${h.amount > 0n ? "in" : h.amount < 0n ? "out" : "self"}`}>{h.amount > 0n ? <IconReceive /> : h.amount < 0n ? <IconSend /> : <IconRefresh />}</span>
                  <div className="tx-main">
                    <p className="tx-kind">{KIND[h.kind]}</p>
                    <p className="muted small">
                      {h.height === null ? "pending" : h.time ? new Date(h.time * 1000).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" }) : `block ${h.height}`}
                      {h.fee !== null && ` · fee ${h.fee} sats`}
                      {txLink(h.txid) && <> · <a href={txLink(h.txid)!} target="_blank" rel="noreferrer">explorer</a></>}
                    </p>
                  </div>
                  <p className={`tx-amount ${h.amount < 0n ? "neg" : h.amount > 0n ? "pos" : "muted"}`}>{h.amount > 0n ? "+" : ""}{btcFmt(h.amount)}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
      {sub === "coins" && (
        <div id="coins">
          {utxos && utxos.length === 0 && <p className="muted small">No coins.</p>}
          {utxos && utxos.length > 0 && (
            <table>
              <thead><tr><th className="hide-m">Coin</th><th>Amount</th><th>Confirmations</th><th>Recovery possible</th></tr></thead>
              <tbody>
                {utxos.map((u) => (
                  <tr key={`${u.txid}:${u.vout}`}>
                    <td className="mono hide-m">{u.txid.slice(0, 12)}…:{u.vout} {u.change ? "(change)" : ""}</td>
                    <td>{btcFmt(u.value)}</td>
                    <td>{u.confirmations || "pending"}</td>
                    <td className={u.recoveryOpensIn === 0 ? "danger" : ""}>{u.recoveryOpensIn === 0 ? "open" : `in ${u.recoveryOpensIn} block(s)`}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
      {sub === "securite" && (
        <div id="securite">
          <div className="sec-grid">
            <div className="sec-item"><p className="sec-who">You</p><p className="small">Spend on your own, at any time, with your Client Wallet (fingerprint {cfg.client.fingerprint}).</p></div>
            <div className="sec-item"><p className="sec-who">Swissquote + {tiers}</p><p className="small">Only together, and only for coins that have not moved for {cfg.delay} blocks.</p></div>
            <div className="sec-item"><p className="sec-who">Swissquote alone</p><p className="small">Cannot spend anything.</p></div>
          </div>
          <button className="btn-secondary" onClick={onLost}>I lost my wallet: recover my bitcoin</button>
        </div>
      )}
    </section>
  );

  return (
    <div className={mobile ? "crypto m" : "d-page crypto"} id="crypto-top">
      {error && <p className="error">{error}</p>}
      {soon.length > 0 && (
        <p className="warning">
          {soon.length} coin(s) soon spendable by Swissquote + {tiers}. If this is not a recovery you asked for, use “Refresh” to reset the delay.
        </p>
      )}
      {mobile ? (
        <>{header}<div ref={panelRef}>{sidePanel}</div>{chart}{tabs}</>
      ) : (
        <div className="crypto-grid">
          <div>{header}{chart}{tabs}</div>
          <div ref={panelRef} className="crypto-side">{sidePanel}</div>
        </div>
      )}
    </div>
  );
}
