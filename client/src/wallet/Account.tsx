// Vue du wallet Bitcoin : solde, réception, envoi, coins avec délai de recovery, sécurité.
import { useCallback, useEffect, useRef, useState } from "react";
import { type WalletConfig, type WalletUtxo, outputAt, scan } from "@sq/bitcoin";
import { addrLink, chain } from "../lib/chain";
import { BTC_CHF, type BtcAccount } from "../lib/config";
import { btcFmt } from "../lib/format";
import { Send } from "./Send";

const RECEIVE_KEY = (cfg: WalletConfig) => `sq-wallet:receive-index:${cfg.network}:${cfg.client.fingerprint}`;
const chf = (n: number) => n.toLocaleString("fr-CH", { style: "currency", currency: "CHF" });

export function Account({ cfg, account, onLost, onBalance }: { cfg: WalletConfig; account: BtcAccount; onLost: () => void; onBalance: (s: bigint) => void }) {
  const [utxos, setUtxos] = useState<WalletUtxo[] | null>(null);
  const [error, setError] = useState<string | null>(null);
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

  return (
    <>
      <section className="hero">
        <p className="label">Wallet Bitcoin · self-custody · {cfg.network}</p>
        <p className="big" data-testid="btc-balance">{utxos ? btcFmt(balance) : "…"}</p>
        <p className="note small-text">≈ {chf((Number(balance) / 1e8) * BTC_CHF)} (cours simulé) · <button className="link" onClick={refresh}>Actualiser</button></p>
        {error && <p className="error">{error}</p>}
      </section>

      {soon.length > 0 && (
        <p className="warning">
          {soon.length} coin(s) bientôt dépensable(s) par Swissquote + {tiers}. S'il ne s'agit pas d'une recovery voulue, utilisez « Rafraîchir mes coins » pour remettre le délai à zéro.
        </p>
      )}

      <div className="grid two">
        <section>
          <h2>Recevoir</h2>
          <p className="mono address">{address}</p>
          <p className="small-text">
            Adresse n°{receiveIndex}
            {link && <> · <a href={link} target="_blank" rel="noreferrer">explorateur</a></>}
            {" · "}
            <button className="link" onClick={() => { const n = receiveIndex + 1; localStorage.setItem(RECEIVE_KEY(cfg), String(n)); setReceiveIndex(n); }}>Nouvelle adresse</button>
          </p>
        </section>
        <section>
          <h2>Sécurité de votre wallet</h2>
          <ul className="promise compact">
            <li><strong>Vous</strong> : dépensez seul, à tout moment, avec votre Wallet du client (empreinte {cfg.client.fingerprint}).</li>
            <li><strong>Swissquote + {tiers}</strong> : ensemble seulement, et uniquement pour des coins immobiles depuis {cfg.delay} blocs.</li>
            <li><strong>Swissquote seule</strong> : ne peut rien dépenser.</li>
          </ul>
          <button className="secondary" onClick={onLost}>J'ai perdu mon wallet : récupérer mes bitcoins</button>
        </section>
      </div>

      <section>
        <h2>Coins</h2>
        {utxos && utxos.length === 0 && <p>Aucun coin.</p>}
        {utxos && utxos.length > 0 && (
          <table>
            <thead><tr><th>Coin</th><th>Montant</th><th>Confirmations</th><th>Recovery possible</th></tr></thead>
            <tbody>
              {utxos.map((u) => (
                <tr key={`${u.txid}:${u.vout}`}>
                  <td className="mono">{u.txid.slice(0, 12)}…:{u.vout} {u.change ? "(change)" : ""}</td>
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
    </>
  );
}
