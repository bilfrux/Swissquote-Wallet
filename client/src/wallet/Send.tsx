// Dépense du client : l'appli prépare le PSBT et le simule ; le Wallet du client le décode, le fait confirmer et le signe ;
// l'appli finalise et diffuse. Autre wallet externe : PSBT à exporter et à recoller.
import { useEffect, useState } from "react";
import { type FeeRates, type PsbtSummary as Summary, type WalletConfig, type WalletUtxo, buildSpend, finalizePsbt, nextIndex, outputAt, simulate } from "@sq/bitcoin";
import { chain, txLink } from "../lib/chain";
import { btcFmt, parseBtc } from "../lib/format";
import { walletRequest } from "../lib/walletBridge";
import { HIGH_VALUE_SATS, stepUp } from "../lib/bank";
import { PsbtSummary } from "../simulation/PsbtSummary";

// mode « send » : envoi vers un destinataire ; « refresh » : tout renvoyer vers une adresse neuve du compte.
export function Send({ cfg, utxos, onSent, mode = "send", initialTo }: { cfg: WalletConfig; utxos: WalletUtxo[]; onSent: () => void; mode?: "send" | "refresh"; initialTo?: string }) {
  const [to, setTo] = useState(initialTo ?? "");
  const [amount, setAmount] = useState("");
  const [feeRate, setFeeRate] = useState("2");
  const [rates, setRates] = useState<FeeRates | null>(null);
  const [touched, setTouched] = useState(false);
  // Estimation des frais par le réseau (Esplora) ou le nœud (regtest) ; « Normal » par défaut.
  useEffect(() => { chain.feeRates().then((r) => { setRates(r); if (!touched) setFeeRate(String(r.normal)); }, () => undefined); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const [unsigned, setUnsigned] = useState<{ psbt: string; summary: Summary } | null>(null);
  const [signedPsbt, setSignedPsbt] = useState<string | null>(null);
  const [manual, setManual] = useState("");
  const [result, setResult] = useState<{ txid?: string; error?: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [stepNote, setStepNote] = useState<string | null>(null);

  const guard = (f: () => Promise<void> | void) => async () => {
    setError(null);
    setBusy(true);
    try { await f(); } catch (e: any) { setError(e.message); } finally { setBusy(false); }
  };
  const sameTx = (psbt: string) => {
    const s = simulate(cfg, psbt);
    const key = (x: Summary) => JSON.stringify(x.outputs.map((o) => [o.address, String(o.value)]));
    if (key(s) !== key(unsigned!.summary)) throw new Error("the signed PSBT does not match the prepared transaction");
    if (s.inputs.some((i) => i.signatures === 0)) throw new Error("the PSBT is not signed");
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

  // Montant qui quitte le compte : au-delà du seuil, ré-authentification par passkey (si Swissquote répond).
  const sentExternal = unsigned ? unsigned.summary.outputs.filter((o) => !o.own).reduce((t, o) => t + o.value, 0n) : 0n;
  const high = mode === "send" && sentExternal >= HIGH_VALUE_SATS;
  return (
    <div className="send">
      {mode === "send" ? (
        <>
          <label><span>Recipient</span><input className="mono" value={to} onChange={(e) => setTo(e.target.value)} placeholder="tb1… / bcrt1…" /></label>
          <label><span>Amount (BTC)</span><input value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.0001" /></label>
        </>
      ) : (
        <p className="small">All your coins are sent to a new address of your account. The recovery delay restarts from zero: Swissquote and your trusted contact can no longer move them for {cfg.delay} blocks.</p>
      )}
      <label><span>Fee (sat/vB)</span><input value={feeRate} onChange={(e) => { setTouched(true); setFeeRate(e.target.value); }} /></label>
      {rates && (
        <div className="fee-presets" data-testid="fee-presets">
          {([["slow", "Economy", "~1 day"], ["normal", "Normal", "~30 min"], ["fast", "Fast", "~10 min"]] as const).map(([k, label, eta]) => (
            <button key={k} type="button" className={String(rates[k]) === feeRate ? "on" : ""} onClick={() => { setTouched(true); setFeeRate(String(rates[k])); }}>
              <strong>{label}</strong><span>{rates[k]} sat/vB</span><span>{eta}</span>
            </button>
          ))}
          <span className="muted small">{rates.source === "réseau" ? "Network estimate" : "Default values (no estimate on this network)"} · minimum 1 sat/vB</span>
        </div>
      )}
      {mode === "send"
        ? <button disabled={busy} className="btn-primary wide" onClick={prepare(false)}>Prepare the transfer</button>
        : <button disabled={busy} className="btn-primary wide" onClick={prepare(true)}>Prepare the refresh</button>}
      {error && <p className="error">{error}</p>}

      {unsigned && !result?.txid && (
        <div className="step">
          <h3>Review, then sign in your wallet</h3>
          <PsbtSummary summary={unsigned.summary} delay={cfg.delay} />
          {!signedPsbt ? (
            <>
              {high && <p className="warning small">High-value amount ({btcFmt(sentExternal)}): passkey confirmation with Swissquote, then enhanced confirmation in your wallet.</p>}
              <button disabled={busy} onClick={guard(async () => {
                if (high) {
                  const r = await stepUp(sentExternal, unsigned.summary.outputs.find((o) => !o.own)?.address ?? "", cfg.network);
                  setStepNote(r.status === "approuvé" ? "High-value amount confirmed by passkey." : "Swissquote unreachable: enhanced confirmation is handled by your wallet alone.");
                }
                setSignedPsbt(sameTx((await walletRequest<{ psbt: string }>("sign", { psbt: unsigned.psbt })).psbt));
              })}>
                Sign with my Client Wallet
              </button>
              {stepNote && <p className="note" data-testid="stepup-note">{stepNote}</p>}
              <p className="note">The app cannot sign: your wallet opens, shows the transaction and asks you to confirm.</p>
              <details>
                <summary>Other external wallet (PSBT)</summary>
                <textarea readOnly rows={3} className="mono" value={unsigned.psbt} />
                <button className="small" onClick={() => navigator.clipboard.writeText(unsigned.psbt)}>Copy the PSBT</button>
                <textarea rows={3} className="mono" value={manual} onChange={(e) => setManual(e.target.value)} placeholder="Signed PSBT (cHNidP8…)" />
                <button className="small" disabled={!manual.trim()} onClick={guard(() => { setSignedPsbt(sameTx(manual.trim())); })}>Use this signed PSBT</button>
              </details>
            </>
          ) : (
            <>
              <p className="success">Transaction signed by your wallet.</p>
              <button disabled={busy} onClick={guard(async () => {
                const { hex } = finalizePsbt(cfg, signedPsbt);
                try { setResult({ txid: await chain.broadcast(hex) }); onSent(); } catch (e: any) { setResult({ error: e.message }); }
              })}>Broadcast on the Bitcoin network</button>
            </>
          )}
        </div>
      )}

      {result?.txid && (
        <p className="success">
          Transaction broadcast: <span className="mono">{result.txid}</span>
          {txLink(result.txid) && <> · <a href={txLink(result.txid)!} target="_blank" rel="noreferrer">view in explorer</a></>}
        </p>
      )}
      {result?.error && <p className="error">Rejected by the network: {result.error}</p>}
    </div>
  );
}
