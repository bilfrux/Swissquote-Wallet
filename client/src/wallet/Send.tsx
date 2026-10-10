// Dépense du client : l'appli prépare le PSBT, le client le signe dans SON wallet externe, l'appli finalise et diffuse.
import { useState } from "react";
import { type PsbtSummary as Summary, type WalletConfig, type WalletUtxo, buildSpend, finalizePsbt, nextIndex, outputAt, simulate } from "@sq/bitcoin";
import { chain, txLink } from "../lib/chain";
import { parseBtc } from "../lib/format";
import { PsbtSummary } from "../simulation/PsbtSummary";

export function Send({ cfg, utxos, onSent }: { cfg: WalletConfig; utxos: WalletUtxo[]; onSent: () => void }) {
  const [to, setTo] = useState("");
  const [amount, setAmount] = useState("");
  const [feeRate, setFeeRate] = useState("2");
  const [unsigned, setUnsigned] = useState<{ psbt: string; summary: Summary } | null>(null);
  const [signedText, setSignedText] = useState("");
  const [signed, setSigned] = useState<Summary | null>(null);
  const [result, setResult] = useState<{ txid?: string; error?: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const guard = (f: () => Promise<void> | void) => async () => {
    setError(null);
    try { await f(); } catch (e: any) { setError(e.message); }
  };
  const prepare = (refresh: boolean) =>
    guard(async () => {
      setResult(null);
      setSigned(null);
      setSignedText("");
      const changeIndex = nextIndex(utxos, 1);
      setUnsigned(
        await buildSpend({
          cfg, backend: chain, utxos, path: "client", feeRate: Number(feeRate),
          // Rafraîchissement : tout renvoyer vers une adresse de change neuve du compte.
          to: refresh ? outputAt(cfg, 1, changeIndex).getAddress() : to.trim(),
          amount: refresh ? undefined : parseBtc(amount),
          changeIndex: refresh ? changeIndex + 1 : changeIndex,
        }),
      );
    });
  const download = () => {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([unsigned!.psbt], { type: "text/plain" }));
    a.download = "a-signer.psbt";
    a.click();
  };

  return (
    <section>
      <h2>Envoyer</h2>
      <div className="row">
        <label><span>Destinataire</span><input className="mono" value={to} onChange={(e) => setTo(e.target.value)} placeholder="tb1…" /></label>
        <label><span>Montant (BTC)</span><input value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.0001" /></label>
        <label><span>Frais (sat/vB)</span><input value={feeRate} onChange={(e) => setFeeRate(e.target.value)} /></label>
      </div>
      <button onClick={prepare(false)}>Préparer la transaction</button>{" "}
      <button className="secondary" onClick={prepare(true)}>Rafraîchir tous mes coins (envoi à moi-même)</button>
      {error && <p className="error">{error}</p>}

      {unsigned && (
        <div className="step">
          <h3>1. Vérifiez puis signez dans votre wallet</h3>
          <PsbtSummary summary={unsigned.summary} delay={cfg.delay} />
          <textarea readOnly rows={4} className="mono" value={unsigned.psbt} />
          <button className="small" onClick={() => navigator.clipboard.writeText(unsigned.psbt)}>Copier le PSBT</button>{" "}
          <button className="small" onClick={download}>Télécharger le PSBT</button>
          <p className="note">L'appli ne peut pas signer : seule la clé de votre wallet externe le peut.</p>

          <h3>2. Collez le PSBT signé</h3>
          <textarea rows={4} className="mono" value={signedText} onChange={(e) => setSignedText(e.target.value)} placeholder="cHNidP8…" />
          <button
            onClick={guard(() => {
              const s = simulate(cfg, signedText);
              const same = JSON.stringify(s.outputs.map((o) => [o.address, String(o.value)])) === JSON.stringify(unsigned.summary.outputs.map((o) => [o.address, String(o.value)]));
              if (!same) throw new Error("le PSBT signé ne correspond pas à la transaction préparée");
              setSigned(s);
            })}
          >
            Vérifier
          </button>
        </div>
      )}

      {signed && (
        <div className="step">
          <h3>3. Finaliser et diffuser</h3>
          <PsbtSummary summary={signed} delay={cfg.delay} />
          <button
            onClick={guard(async () => {
              const { hex } = finalizePsbt(cfg, signedText);
              try { setResult({ txid: await chain.broadcast(hex) }); onSent(); } catch (e: any) { setResult({ error: e.message }); }
            })}
          >
            Diffuser
          </button>
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
