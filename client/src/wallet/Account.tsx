// Vue du compte Bitcoin : politique, adresse de réception, coins (avec délai de recovery), envoi.
import { useCallback, useEffect, useState } from "react";
import { type WalletConfig, type WalletUtxo, descriptor, outputAt, policyString, scan } from "@sq/bitcoin";
import { addrLink, chain } from "../lib/chain";
import { btcFmt } from "../lib/format";
import { Send } from "./Send";

const RECEIVE_KEY = (cfg: WalletConfig) => `sq-wallet:receive-index:${cfg.network}:${cfg.client.fingerprint}`;

export function Account({ cfg, onReset }: { cfg: WalletConfig; onReset: () => void }) {
  const [utxos, setUtxos] = useState<WalletUtxo[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [receiveIndex, setReceiveIndex] = useState(() => Number(localStorage.getItem(RECEIVE_KEY(cfg)) ?? 0));
  const address = outputAt(cfg, 0, receiveIndex).getAddress();

  const refresh = useCallback(async () => {
    setError(null);
    try { setUtxos(await scan(cfg, chain)); } catch (e: any) { setError(`lecture de la chaîne impossible : ${e.message}`); }
  }, [cfg]);
  useEffect(() => { refresh(); }, [refresh]);

  const balance = (utxos ?? []).reduce((s, u) => s + u.value, 0n);
  const soon = (utxos ?? []).filter((u) => u.recoveryOpensIn <= Math.ceil(cfg.delay / 3));
  const link = addrLink(address);

  return (
    <>
      <section>
        <h2>Compte Bitcoin ({cfg.network})</h2>
        <p><strong>Solde :</strong> {utxos ? btcFmt(balance) : "…"} <button className="small" onClick={refresh}>Actualiser</button></p>
        {error && <p className="error">{error}</p>}
        <details>
          <summary>Politique de dépense (appliquée par le consensus Bitcoin)</summary>
          <p>Vous dépensez seul à tout moment. Swissquote + votre tiers ne peuvent dépenser qu'un coin resté immobile {cfg.delay} blocs.</p>
          <p className="mono">{policyString(cfg.delay).replace("@C", "VOUS").replace("@S", "SWISSQUOTE").replace("@T", "TIERS")}</p>
          <p className="mono small-text">{descriptor(cfg, 0)}</p>
        </details>
        <button className="link" onClick={onReset}>Changer de compte</button>
      </section>

      <section>
        <h2>Recevoir</h2>
        <p className="mono address">{address}</p>
        <p>
          Index {receiveIndex}
          {link && <> · <a href={link} target="_blank" rel="noreferrer">explorateur</a></>}
          {" · "}
          <button className="small" onClick={() => { const n = receiveIndex + 1; localStorage.setItem(RECEIVE_KEY(cfg), String(n)); setReceiveIndex(n); }}>
            Nouvelle adresse
          </button>
        </p>
      </section>

      <section>
        <h2>Coins</h2>
        {soon.length > 0 && (
          <p className="warning">
            {soon.length} coin(s) bientôt dépensable(s) par Swissquote + tiers. S'il ne s'agit pas d'une recovery voulue, envoyez-les à vous-même pour remettre le délai à zéro.
          </p>
        )}
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
