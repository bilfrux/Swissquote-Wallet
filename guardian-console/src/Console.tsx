// Console du TIERS DE CONFIANCE : indépendante de l'app cliente et de Swissquote.
// La phrase du tiers est lue dans le champ au moment du clic, utilisée, puis effacée : jamais mise dans l'état React,
// jamais écrite dans localStorage/sessionStorage, jamais journalisée.
import { useEffect, useRef, useState } from "react";
import { btc } from "@bitcoinerlab/descriptors-scure";
import { base64 } from "@scure/base";
import { type NetworkName, btcNetwork } from "@sq/bitcoin";
import { accountKey, masterFromMnemonic, newMnemonic } from "@sq/bitcoin/keys";
import { signPsbtWithMnemonic } from "@sq/bitcoin/sign";
import { evmAccountFromMnemonic, evmAddressFromMnemonic } from "@sq/evm/keys";
import { EXPLORER, RECOVERY_DELAY_LABEL, readState, recoveryTypedData } from "@sq/evm";

// Relais Swissquote (A3) : la demande arrive par un lien ?req=… ; la signature y est renvoyée. Swissquote transporte
// seulement : la phrase du tiers ne quitte jamais cette console.
const BANK_URL = import.meta.env.VITE_BANK_MOCK_URL ?? "http://localhost:4000";
const REQ = new URLSearchParams(location.search).get("req");
const NETWORK = (import.meta.env.VITE_BTC_NETWORK ?? "signet") as NetworkName;
const fmt = (s: bigint) => `${s.toString().padStart(9, "0").replace(/(\d{8})$/, ".$1")} BTC`;

// nSequence BIP68 : délai relatif en blocs si le bit 31 (désactivation) et le bit 22 (unité de temps) sont à 0.
const relativeBlocks = (seq: number) => (seq & 0x80000000 || seq & 0x00400000 ? null : seq & 0xffff);

function decode(psbt: string) {
  const tx = btc.Transaction.fromPSBT(base64.decode(psbt.trim()));
  const inputs = Array.from({ length: tx.inputsLength }, (_, i) => tx.getInput(i));
  const outputs = Array.from({ length: tx.outputsLength }, (_, i) => tx.getOutput(i));
  const totalIn = inputs.reduce((s, i) => s + (i.witnessUtxo?.amount ?? 0n), 0n);
  const totalOut = outputs.reduce((s, o) => s + o.amount!, 0n);
  return {
    inputs: inputs.map((i) => ({ value: i.witnessUtxo?.amount ?? 0n, delay: relativeBlocks(i.sequence!), sigs: i.partialSig?.length ?? 0 })),
    outputs: outputs.map((o) => ({ value: o.amount!, address: btc.Address(btcNetwork(NETWORK)).encode(btc.OutScript.decode(o.script!)) })),
    fee: totalIn - totalOut,
  };
}

export function Console() {
  const phraseRef = useRef<HTMLTextAreaElement>(null);
  const [psbt, setPsbt] = useState("");
  const [signed, setSigned] = useState<{ psbt: string; added: number } | null>(null);
  const [pubKey, setPubKey] = useState<string | null>(null);
  // Identité de tiers créée ici : phrase affichée une fois (jusqu'à « J'ai noté »), jamais stockée.
  const [identity, setIdentity] = useState<{ words: string[]; key: string; evm: string } | null>(null);
  const [evmAddr, setEvmAddr] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  useEffect(() => {
    if (!REQ) return;
    fetch(`${BANK_URL}/relay?id=${REQ}`).then(async (r) => { const j = await r.json(); if (!r.ok) throw new Error(j.error); setPsbt(j.psbt); })
      .catch((e) => setError(`request not found: ${e.message}`));
  }, []);

  // Lit la phrase, l'utilise, l'efface du champ, quoi qu'il arrive.
  const withPhrase = <T,>(f: (phrase: string) => T): T | undefined => {
    const el = phraseRef.current!;
    const phrase = el.value;
    el.value = "";
    setError(null);
    try {
      if (!phrase.trim()) throw new Error("phrase required");
      return f(phrase);
    } catch (e: any) {
      setError(e.message);
    }
  };

  // Demande de recovery Ethereum (relais A3, format JSON) : signée en EIP-712 par la clé Ethereum du tiers.
  const evmReq: { kind: "evm-recovery"; safe: `0x${string}`; newOwner: `0x${string}`; nonce: string } | null = psbt.trim().startsWith("{") ? JSON.parse(psbt) : null;
  if (evmReq) return <EvmRecovery req={evmReq} phraseRef={phraseRef} withPhrase={withPhrase} error={error} setError={setError} />;
  let decoded: ReturnType<typeof decode> | null = null;
  let decodeError: string | null = null;
  if (psbt.trim()) try { decoded = decode(psbt); } catch (e: any) { decodeError = `unreadable PSBT: ${e.message}`; }
  const recovery = decoded?.inputs.every((i) => i.delay !== null);

  return (
    <main>
      <header>
        <div className="brand">
          <img src="/swissquote-logo.png" alt="Swissquote" />
          <div><strong>Trusted Contact</strong><span>Guardian console</span></div>
        </div>
        <p className="badge">Independent of Swissquote and the client app · {NETWORK} network · no data stored</p>
      </header>

      <section>
        <div className="section-title"><span className="eyebrow">SETUP</span><h2>Become a trusted contact</h2></div>
        <p className="note">Create your guardian key. The phrase is shown only once: write it down, it will be required to sign a recovery.</p>
        {!identity ? (
          <button className="secondary small" onClick={() => { const m = newMnemonic(); setIdentity({ words: m.split(" "), key: accountKey(masterFromMnemonic(m, NETWORK)), evm: evmAddressFromMnemonic(m) }); setPubKey(null); }}>
            Create my trusted-contact identity
          </button>
        ) : (
          <>
            {identity.words.length > 0 && (
              <>
                <ol className="mono identity-words">{identity.words.map((w, i) => <li key={i}>{w}</li>)}</ol>
                <button className="small" onClick={() => setIdentity({ ...identity, words: [] })}>I have written down my phrase: hide it permanently</button>
              </>
            )}
            <p><strong>Public key to send to the client:</strong></p>
            <p className="mono address identity-key">{identity.key}</p>
            <p><strong>Ethereum address to send to the client</strong> (same phrase):</p>
            <p className="mono address identity-evm">{identity.evm}</p>
          </>
        )}
      </section>

      <section>
        <h2>Your guardian phrase</h2>
        <p className="note">Entered for each use, erased immediately afterwards. Nothing is stored.</p>
        <textarea ref={phraseRef} rows={2} className="mono" autoComplete="off" spellCheck={false} placeholder="word1 word2 … word24" />
        <button className="secondary small" onClick={() => withPhrase((p) => setPubKey(accountKey(masterFromMnemonic(p, NETWORK))))}>
          Show my public key (to send to the client)
        </button>
        {pubKey && <p className="mono address">{pubKey}</p>}
        <button className="secondary small" onClick={() => withPhrase((p) => setEvmAddr(evmAddressFromMnemonic(p)))}>
          Show my Ethereum address (to send to the client)
        </button>
        {evmAddr && <p className="mono address" data-testid="evm-address">{evmAddr}</p>}
      </section>

      <section>
        <h2>Sign a recovery request</h2>
        <textarea rows={4} className="mono" value={psbt} onChange={(e) => { setPsbt(e.target.value); setSigned(null); }} placeholder="PSBT received from the client (cHNidP8…)" />
        {decodeError && <p className="error">{decodeError}</p>}
        {decoded && (
          <div className="summary">
            <p>
              <strong>Type:</strong>{" "}
              {recovery
                ? `recovery (valid only if the coins have not moved for ${decoded.inputs[0].delay} blocks)`
                : "NOT a recovery: ordinary client spending. A guardian must not sign it."}
            </p>
            <p><strong>Coins spent:</strong> {decoded.inputs.length}, {fmt(decoded.inputs.reduce((s, i) => s + i.value, 0n))} · signatures already present: {decoded.inputs.map((i) => i.sigs).join(", ")}</p>
            <table>
              <thead><tr><th>Amount</th><th>Destination (must be a NEW address of the client)</th></tr></thead>
              <tbody>{decoded.outputs.map((o, i) => <tr key={i}><td>{fmt(o.value)}</td><td className="mono">{o.address}</td></tr>)}</tbody>
            </table>
            <p><strong>Fee:</strong> {fmt(decoded.fee)}</p>
          </div>
        )}
        <p className="note">Check with the client, through another channel, that the destination address is really theirs.</p>
        <button
          disabled={!decoded || !recovery}
          onClick={() => withPhrase((p) => {
            const r = signPsbtWithMnemonic(psbt, p, NETWORK);
            if (r.added === 0) throw new Error("this phrase matches no guardian key in this PSBT");
            setSigned(r);
          })}
        >
          Sign as trusted contact
        </button>
        {error && <p className="error">{error}</p>}
        {signed && (
          <div className="step">
            <p className="success">{signed.added} signature(s) added. Send this PSBT back to the client.</p>
            <textarea readOnly rows={4} className="mono" value={signed.psbt} />
            <button className="small" onClick={() => navigator.clipboard.writeText(signed.psbt)}>Copy the signed PSBT</button>
            {REQ && (sent ? <p className="success" data-testid="relay-sent">Signature sent back to the client via Swissquote.</p> : (
              <button onClick={async () => {
                const r = await fetch(`${BANK_URL}/relay/signed`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: REQ, psbt: signed.psbt }) });
                if (r.ok) setSent(true); else setError((await r.json()).error);
              }}>Send back to the client via Swissquote</button>
            ))}
          </div>
        )}
      </section>
    </main>
  );
}

function EvmRecovery({ req, phraseRef, withPhrase, error, setError }: {
  req: { safe: `0x${string}`; newOwner: `0x${string}`; nonce: string };
  phraseRef: React.RefObject<HTMLTextAreaElement | null>;
  withPhrase: <T,>(f: (p: string) => T) => T | undefined;
  error: string | null; setError: (e: string | null) => void;
}) {
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  return (
    <main>
      <header>
        <h1>Guardian console · trusted contact</h1>
        <p className="badge">Independent of Swissquote and the client app · Ethereum Sepolia · no data stored</p>
      </header>
      <section>
        <h2>Ethereum recovery request</h2>
        <div className="summary">
          <p><strong>Account:</strong> <a className="mono" href={`${EXPLORER}/address/${req.safe}`} target="_blank" rel="noreferrer">{req.safe}</a></p>
          <p><strong>New owner (must be a NEW key of the client):</strong> <span className="mono" data-testid="evm-new-owner">{req.newOwner}</span></p>
          <p><strong>Effect:</strong> once you and Swissquote have both signed, the request can be started; it applies only after the {RECOVERY_DELAY_LABEL} delay enforced by the contract, and the current owner can cancel it in the meantime.</p>
        </div>
        <p className="note">Check with the client, through another channel, that this new key is really theirs.</p>
        <p><strong>Your guardian phrase</strong> (entered for this signature, erased immediately):</p>
        <textarea ref={phraseRef} rows={2} className="mono" autoComplete="off" spellCheck={false} placeholder="word1 word2 … word24" />
        {sent ? <p className="success" data-testid="relay-sent">Signature sent back to the client via Swissquote.</p> : (
          <button disabled={busy} onClick={async () => {
            setBusy(true);
            try {
              const signed = withPhrase((p) => evmAccountFromMnemonic(p).account);
              if (!signed) return;
              const st = await readState(req.safe);
              if (!st.guardians.map((g) => g.toLowerCase()).includes(signed.address.toLowerCase())) throw new Error(`your Ethereum key ${signed.address} is not a guardian of this account`);
              const signature = await signed.signTypedData((await recoveryTypedData(req.safe, req.newOwner, BigInt(req.nonce))) as any);
              const r = await fetch(`${BANK_URL}/relay/signed`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: REQ, signature }) });
              if (!r.ok) throw new Error((await r.json()).error);
              setSent(true);
            } catch (e: any) { setError(e.message); } finally { setBusy(false); }
          }}>{busy ? "Signing…" : "Sign as trusted contact and send back via Swissquote"}</button>
        )}
        {error && <p className="error">{error}</p>}
      </section>
    </main>
  );
}
