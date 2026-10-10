// Vue du wallet Bitcoin : solde, réception, envoi, coins avec délai de recovery, sécurité.
import { useCallback, useEffect, useRef, useState } from "react";
import { type WalletConfig, type WalletUtxo, outputAt, scan } from "@sq/bitcoin";
import { addrLink, chain } from "../lib/chain";
import { BTC_CHF, type BtcAccount } from "../lib/config";
import { btcFmt } from "../lib/format";
import { num } from "../ui/format";
import { IconCrypto, IconReceive, IconRefresh, IconSend, IconShield } from "../ui/icons";
import { useIsMobile } from "../ui/useIsMobile";
import { ownershipChallenge, ownershipVerify } from "../lib/bank";
import { walletRequest } from "../lib/walletBridge";
import { Send } from "./Send";

const RECEIVE_KEY = (cfg: WalletConfig) => `sq-wallet:receive-index:${cfg.network}:${cfg.client.fingerprint}`;
const jump = (id: string) => document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });

export function Account({ cfg, account, onLost, onBalance }: { cfg: WalletConfig; account: BtcAccount; onLost: () => void; onBalance: (s: bigint) => void }) {
  const [utxos, setUtxos] = useState<WalletUtxo[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [proof, setProof] = useState<{ ok: boolean; text: string } | null>(null);
  // Preuve de propriété : défi Swissquote -> signature dans le Wallet du client (après confirmation) -> vérification Swissquote.
  const prove = async () => {
    setProof(null);
    try {
      const ch = await ownershipChallenge(cfg.client.raw, 0, receiveIndex);
      const sig = await walletRequest<{ signature: string }>("prove", { accountKey: cfg.client.raw, change: 0, index: receiveIndex, message: ch.message });
      const v = await ownershipVerify(ch.challengeId, sig.signature);
      setProof({ ok: v.verified, text: v.proves });
    } catch (e: any) { setProof({ ok: false, text: e.message }); }
  };
  const [receiveIndex, setReceiveIndex] = useState(() => Number(localStorage.getItem(RECEIVE_KEY(cfg)) ?? 0));
  const address = outputAt(cfg, 0, receiveIndex).getAddress();

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
    } catch (e: any) { if (n === lastScan.current) setError(`lecture de la chaîne impossible : ${e.message}`); }
  }, [cfg]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { refresh(); }, [refresh]);

  const balance = (utxos ?? []).reduce((s, u) => s + u.value, 0n);
  const soon = (utxos ?? []).filter((u) => u.recoveryOpensIn <= Math.ceil(cfg.delay / 3));
  const link = addrLink(address);
  const tiers = account.tiersName || "votre tiers";

  const mobile = useIsMobile();
  const nextOpen = utxos?.length ? Math.min(...utxos.map((u) => u.recoveryOpensIn)) : null;
  const balanceChf = (Number(balance) / 1e8) * BTC_CHF;
  return (
    <div className={mobile ? "" : "d-page"} id="crypto-top">
      {!mobile && (
        <div className="d-page-head">
          <h1>Crypto assets · Wallet Bitcoin</h1>
          <span className="muted small">Self-custody · réseau {cfg.network} · <button className="link" onClick={refresh}><IconRefresh /> Actualiser</button></span>
        </div>
      )}
      {mobile ? (
        <div className="m-home">
          <p className="m-total-label">Wallet Bitcoin · self-custody</p>
          <p className="m-total" data-testid="btc-balance"><strong>{utxos ? btcFmt(balance) : "…"}</strong></p>
          <p className="muted center small">≈ {num(balanceChf)} CHF (cours simulé) · <button className="link" onClick={refresh}>Actualiser</button></p>
          <div className="round-actions">
            <button onClick={() => jump("recevoir")}><span className="round dark"><IconReceive /></span>Recevoir</button>
            <button onClick={() => jump("envoyer")}><span className="round dark"><IconSend /></span>Envoyer</button>
            <button onClick={() => jump("securite")}><span className="round dark"><IconShield /></span>Sécurité</button>
          </div>
        </div>
      ) : (
        <section className="card stats">
          <div><p className="stat-label"><IconCrypto /> Solde</p><p className="stat" data-testid="btc-balance">{utxos ? btcFmt(balance) : "…"}</p></div>
          <div><p className="stat-label">Contre-valeur (cours simulé)</p><p className="stat">{num(balanceChf)} <small>CHF</small></p></div>
          <div><p className="stat-label"><IconShield /> Recovery possible</p><p className="stat">{nextOpen === null ? "—" : nextOpen === 0 ? <span className="neg">ouverte</span> : `dans ${nextOpen} bloc(s)`}</p></div>
        </section>
      )}
      {error && <p className="error">{error}</p>}

      {soon.length > 0 && (
        <p className="warning">
          {soon.length} coin(s) bientôt dépensable(s) par Swissquote + {tiers}. S'il ne s'agit pas d'une recovery voulue, utilisez « Rafraîchir mes coins » pour remettre le délai à zéro.
        </p>
      )}

      <div className={mobile ? "" : "d-cols even"}>
        <section className="card" id="recevoir">
          <h2>Recevoir</h2>
          <p className="mono address">{address}</p>
          <p className="small muted">
            Adresse n°{receiveIndex}
            {link && <> · <a href={link} target="_blank" rel="noreferrer">explorateur</a></>}
            {" · "}
            <button className="link" onClick={() => { const n = receiveIndex + 1; localStorage.setItem(RECEIVE_KEY(cfg), String(n)); setReceiveIndex(n); setProof(null); }}>Nouvelle adresse</button>
          </p>
          <button className="btn-secondary" onClick={prove}>Prouver à Swissquote que je contrôle cette adresse</button>
          {proof && <p className={proof.ok ? "success" : "error"} data-testid="ownership-result">{proof.ok ? "Propriété vérifiée. " : ""}{proof.text}</p>}
        </section>
        <section className="card" id="securite">
          <h2>Sécurité de votre wallet</h2>
          <ul className="promise compact">
            <li><strong>Vous</strong> : dépensez seul, à tout moment, avec votre Wallet du client (empreinte {cfg.client.fingerprint}).</li>
            <li><strong>Swissquote + {tiers}</strong> : ensemble seulement, et uniquement pour des coins immobiles depuis {cfg.delay} blocs.</li>
            <li><strong>Swissquote seule</strong> : ne peut rien dépenser.</li>
          </ul>
          <button className="btn-secondary" onClick={onLost}>J'ai perdu mon wallet : récupérer mes bitcoins</button>
        </section>
      </div>

      <section className="card" id="coins">
        <h2>Coins</h2>
        {utxos && utxos.length === 0 && <p>Aucun coin.</p>}
        {utxos && utxos.length > 0 && (
          <table>
            <thead><tr><th className="hide-m">Coin</th><th>Montant</th><th>Confirmations</th><th>Recovery possible</th></tr></thead>
            <tbody>
              {utxos.map((u) => (
                <tr key={`${u.txid}:${u.vout}`}>
                  <td className="mono hide-m">{u.txid.slice(0, 12)}…:{u.vout} {u.change ? "(change)" : ""}</td>
                  <td>{btcFmt(u.value)}</td>
                  <td>{u.confirmations || "en attente"}</td>
                  <td className={u.recoveryOpensIn === 0 ? "danger" : ""}>{u.recoveryOpensIn === 0 ? "ouverte" : `dans ${u.recoveryOpensIn} bloc(s)`}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {utxos && utxos.length > 0 && <Send cfg={cfg} utxos={utxos} onSent={refresh} />}
    </div>
  );
}
