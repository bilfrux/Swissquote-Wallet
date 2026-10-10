// Console du TIERS DE CONFIANCE : indépendante de l'app cliente et de Swissquote.
// La phrase du tiers est lue dans le champ au moment du clic, utilisée, puis effacée : jamais mise dans l'état React,
// jamais écrite dans localStorage/sessionStorage, jamais journalisée.
import { useRef, useState } from "react";
import { btc } from "@bitcoinerlab/descriptors-scure";
import { base64 } from "@scure/base";
import { type NetworkName, btcNetwork } from "@sq/bitcoin";
import { accountKey, masterFromMnemonic } from "@sq/bitcoin/keys";
import { signPsbtWithMnemonic } from "@sq/bitcoin/sign";

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
  const [error, setError] = useState<string | null>(null);

  // Lit la phrase, l'utilise, l'efface du champ, quoi qu'il arrive.
  const withPhrase = <T,>(f: (phrase: string) => T): T | undefined => {
    const el = phraseRef.current!;
    const phrase = el.value;
    el.value = "";
    setError(null);
    try {
      if (!phrase.trim()) throw new Error("phrase requise");
      return f(phrase);
    } catch (e: any) {
      setError(e.message);
    }
  };

  let decoded: ReturnType<typeof decode> | null = null;
  let decodeError: string | null = null;
  if (psbt.trim()) try { decoded = decode(psbt); } catch (e: any) { decodeError = `PSBT illisible : ${e.message}`; }
  const recovery = decoded?.inputs.every((i) => i.delay !== null);

  return (
    <main>
      <header>
        <h1>Console guardian · tiers de confiance</h1>
        <p className="badge">Indépendante de Swissquote et de l'app cliente · réseau {NETWORK} · aucune donnée conservée</p>
      </header>

      <section>
        <h2>Votre phrase de guardian</h2>
        <p className="note">Saisie à chaque utilisation, effacée immédiatement après. Rien n'est enregistré.</p>
        <textarea ref={phraseRef} rows={2} className="mono" autoComplete="off" spellCheck={false} placeholder="mot1 mot2 … mot24" />
        <button className="secondary small" onClick={() => withPhrase((p) => setPubKey(accountKey(masterFromMnemonic(p, NETWORK))))}>
          Afficher ma clé publique (à transmettre au client)
        </button>
        {pubKey && <p className="mono address">{pubKey}</p>}
      </section>

      <section>
        <h2>Signer une demande de recovery</h2>
        <textarea rows={4} className="mono" value={psbt} onChange={(e) => { setPsbt(e.target.value); setSigned(null); }} placeholder="PSBT reçu du client (cHNidP8…)" />
        {decodeError && <p className="error">{decodeError}</p>}
        {decoded && (
          <div className="summary">
            <p>
              <strong>Type :</strong>{" "}
              {recovery
                ? `recovery (valable seulement si les coins n'ont pas bougé depuis ${decoded.inputs[0].delay} blocs)`
                : "PAS une recovery : dépense courante du client. Un guardian n'a pas à la signer."}
            </p>
            <p><strong>Coins dépensés :</strong> {decoded.inputs.length}, {fmt(decoded.inputs.reduce((s, i) => s + i.value, 0n))} · signatures déjà présentes : {decoded.inputs.map((i) => i.sigs).join(", ")}</p>
            <table>
              <thead><tr><th>Montant</th><th>Destination (doit être une NOUVELLE adresse du client)</th></tr></thead>
              <tbody>{decoded.outputs.map((o, i) => <tr key={i}><td>{fmt(o.value)}</td><td className="mono">{o.address}</td></tr>)}</tbody>
            </table>
            <p><strong>Frais :</strong> {fmt(decoded.fee)}</p>
          </div>
        )}
        <p className="note">Vérifiez avec le client, par un autre canal, que l'adresse de destination est bien la sienne.</p>
        <button
          disabled={!decoded || !recovery}
          onClick={() => withPhrase((p) => {
            const r = signPsbtWithMnemonic(psbt, p, NETWORK);
            if (r.added === 0) throw new Error("cette phrase ne correspond à aucune clé de guardian dans ce PSBT");
            setSigned(r);
          })}
        >
          Signer en tant que tiers
        </button>
        {error && <p className="error">{error}</p>}
        {signed && (
          <div className="step">
            <p className="success">{signed.added} signature(s) ajoutée(s). Renvoyez ce PSBT au client.</p>
            <textarea readOnly rows={4} className="mono" value={signed.psbt} />
            <button className="small" onClick={() => navigator.clipboard.writeText(signed.psbt)}>Copier le PSBT signé</button>
          </div>
        )}
      </section>
    </main>
  );
}
