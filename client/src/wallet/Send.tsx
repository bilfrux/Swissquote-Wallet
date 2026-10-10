// Dépense du client : l'appli prépare le PSBT et le simule ; le Wallet du client le décode, le fait confirmer et le signe ;
// l'appli finalise et diffuse. Autre wallet externe : PSBT à exporter et à recoller.
import { useState } from "react";
import { type PsbtSummary as Summary, type WalletConfig, type WalletUtxo, buildSpend, finalizePsbt, nextIndex, outputAt, simulate } from "@sq/bitcoin";
import { chain, txLink } from "../lib/chain";
import { parseBtc } from "../lib/format";
import { walletRequest } from "../lib/walletBridge";
import { PsbtSummary } from "../simulation/PsbtSummary";

export function Send({ cfg, utxos, onSent }: { cfg: WalletConfig; utxos: WalletUtxo[]; onSent: () => void }) {
  const [to, setTo] = useState("");
  const [amount, setAmount] = useState("");
  const [feeRate, setFeeRate] = useState("2");
  const [unsigned, setUnsigned] = useState<{ psbt: string; summary: Summary } | null>(null);
  const [signedPsbt, setSignedPsbt] = useState<string | null>(null);
  const [manual, setManual] = useState("");
  const [result, setResult] = useState<{ txid?: string; error?: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const guard = (f: () => Promise<void> | void) => async () => {
    setError(null);
    setBusy(true);
    try { await f(); } catch (e: any) { setError(e.message); } finally { setBusy(false); }
  };
  const sameTx = (psbt: string) => {
    const s = simulate(cfg, psbt);
    const key = (x: Summary) => JSON.stringify(x.outputs.map((o) => [o.address, String(o.value)]));
    if (key(s) !== key(unsigned!.summary)) throw new Error("le PSBT signé ne correspond pas à la transaction préparée");
    if (s.inputs.some((i) => i.signatures === 0)) throw new Error("le PSBT n'est pas signé");
    return psbt;
  };
  const prepare = (refresh: boolean) =>
    guard(async () => {
      setResult(null);
      setSignedPsbt(null);
      setManual("");
      const changeIndex = nextIndex(utxos, 1);
      setUnsigned(await buildSpend({
        cfg, backend: chain, utxos, path: "client", feeRate: Number(feeRate),
        // Rafraîchissement : tout renvoyer vers une adresse de change neuve du compte (le délai repart de zéro).
        to: refresh ? outputAt(cfg, 1, changeIndex).getAddress() : to.trim(),
        amount: refresh ? undefined : parseBtc(amount),
        changeIndex: refresh ? changeIndex + 1 : changeIndex,
      }));
    });

  return (
    <section className="card" id="envoyer">
      <h2>Envoyer</h2>
      <div className="row">
        <label><span>Destinataire</span><input className="mono" value={to} onChange={(e) => setTo(e.target.value)} placeholder="tb1… / bcrt1…" /></label>
        <label><span>Montant (BTC)</span><input value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.0001" /></label>
        <label><span>Frais (sat/vB)</span><input value={feeRate} onChange={(e) => setFeeRate(e.target.value)} /></label>
      </div>
      <button disabled={busy} className="btn-primary" onClick={prepare(false)}>Préparer l'envoi</button>{" "}
      <button disabled={busy} className="btn-secondary" onClick={prepare(true)}>Rafraîchir mes coins (envoi à moi-même)</button>
      {error && <p className="error">{error}</p>}

      {unsigned && !result?.txid && (
        <div className="step">
          <h3>Vérifiez, puis signez dans votre wallet</h3>
          <PsbtSummary summary={unsigned.summary} delay={cfg.delay} />
          {!signedPsbt ? (
            <>
              <button disabled={busy} onClick={guard(async () => setSignedPsbt(sameTx((await walletRequest<{ psbt: string }>("sign", { psbt: unsigned.psbt })).psbt)))}>
                Signer avec mon Wallet du client
              </button>
              <p className="note">L'appli ne peut pas signer : votre wallet s'ouvre, affiche la transaction et vous demande de confirmer.</p>
              <details>
                <summary>Autre wallet externe (PSBT)</summary>
                <textarea readOnly rows={3} className="mono" value={unsigned.psbt} />
                <button className="small" onClick={() => navigator.clipboard.writeText(unsigned.psbt)}>Copier le PSBT</button>
                <textarea rows={3} className="mono" value={manual} onChange={(e) => setManual(e.target.value)} placeholder="PSBT signé (cHNidP8…)" />
                <button className="small" disabled={!manual.trim()} onClick={guard(() => { setSignedPsbt(sameTx(manual.trim())); })}>Utiliser ce PSBT signé</button>
              </details>
            </>
          ) : (
            <>
              <p className="success">Transaction signée par votre wallet.</p>
              <button disabled={busy} onClick={guard(async () => {
                const { hex } = finalizePsbt(cfg, signedPsbt);
                try { setResult({ txid: await chain.broadcast(hex) }); onSent(); } catch (e: any) { setResult({ error: e.message }); }
              })}>Diffuser sur le réseau Bitcoin</button>
            </>
          )}
        </div>
      )}

      {result?.txid && (
        <p className="success">
          Transaction diffusée : <span className="mono">{result.txid}</span>
          {txLink(result.txid) && <> · <a href={txLink(result.txid)!} target="_blank" rel="noreferrer">voir sur l'explorateur</a></>}
        </p>
      )}
      {result?.error && <p className="error">Refusée par le réseau : {result.error}</p>}
    </section>
  );
}
