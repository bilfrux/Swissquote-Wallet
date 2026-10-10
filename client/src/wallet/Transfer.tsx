// Transferts entre le compte crypto Swissquote (custodial) et le wallet self-custody, sous la Travel Rule :
// Swissquote n'envoie vers le wallet qu'après une preuve de propriété (faite automatiquement par le Wallet du client),
// et ne crédite un dépôt que si sa provenance est un wallet enregistré du client.
import { useCallback, useEffect, useState } from "react";
import { type WalletConfig, outputAt } from "@sq/bitcoin";
import { type TravelRuleRecord, custody, depositAddress, ownershipStatus, syncDeposits, travelRule, withdrawToWallet } from "../lib/bank";
import { txLink } from "../lib/chain";
import { btcFmt, parseBtc } from "../lib/format";
import { proveOwnership } from "../lib/ownership";

export function Transfer({ cfg, receiveIndex, onDone, onDeposit }: { cfg: WalletConfig; receiveIndex: number; onDone: () => void; onDeposit: (address: string) => void }) {
  const [bal, setBal] = useState<number | null>(null);
  const [recs, setRecs] = useState<TravelRuleRecord[]>([]);
  const [amount, setAmount] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const address = outputAt(cfg, 0, receiveIndex).getAddress();

  const load = useCallback(async () => {
    try { setBal((await custody()).balanceSats); setRecs(await travelRule()); }
    catch (e: any) { setResult({ ok: false, text: e.message }); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const withdraw = async () => {
    setBusy(true);
    setResult(null);
    try {
      const sats = Number(parseBtc(amount));
      // Travel Rule : Swissquote exige la preuve que ce wallet vous appartient. Si elle n'existe pas encore pour
      // cette adresse, votre wallet la signe d'abord (sans déplacer de fonds).
      if (!(await ownershipStatus(address))) {
        setStatus("Travel Rule : preuve de propriété de votre wallet en cours…");
        const v = await proveOwnership(cfg, receiveIndex);
        if (!v.verified) throw new Error(`preuve refusée : ${v.proves}`);
      }
      setStatus("Propriété vérifiée. Envoi par Swissquote…");
      const r = await withdrawToWallet(address, sats);
      setStatus(null);
      setResult({ ok: true, text: `Transfert envoyé : ${r.txid}` });
      await load();
      onDone();
    } catch (e: any) { setStatus(null); setResult({ ok: false, text: e.message }); } finally { setBusy(false); }
  };

  return (
    <div className="transfer">
      <div className="sq-account">
        <p className="muted small">Compte crypto Swissquote (en garde chez Swissquote)</p>
        <p className="stat" data-testid="custody-balance">{bal === null ? "…" : btcFmt(BigInt(bal))}</p>
      </div>

      <h3>Vers mon wallet</h3>
      <p className="small">Les fonds partent de votre compte Swissquote vers l'adresse n°{receiveIndex} de votre wallet. Swissquote vérifie d'abord que ce wallet est bien le vôtre (Travel Rule).</p>
      <label><span>Montant (BTC)</span><input value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.1" /></label>
      <button className="btn-primary wide" disabled={busy || !amount} onClick={withdraw}>Transférer vers mon wallet</button>
      {status && <p className="note">{status}</p>}
      {result && (
        <p className={result.ok ? "success" : "error"} data-testid="transfer-result">
          {result.text}
          {result.ok && txLink(result.text.split(": ")[1]) && <> · <a href={txLink(result.text.split(": ")[1])!} target="_blank" rel="noreferrer">explorateur</a></>}
        </p>
      )}

      <div className="divider" />
      <h3>Vers mon compte Swissquote</h3>
      <p className="small">Envoyez depuis votre wallet vers votre adresse de dépôt. Le dépôt n'est crédité que s'il vient d'un de vos wallets enregistrés.</p>
      <div className="btn-row">
        <button className="btn-secondary" onClick={async () => { try { onDeposit(await depositAddress()); } catch (e: any) { setResult({ ok: false, text: e.message }); } }}>Préparer un dépôt</button>
        <button className="btn-secondary" onClick={async () => { try { const s = await syncDeposits(); setResult({ ok: true, text: `Dépôts : ${s.credited} crédité(s), ${s.held} en attente de vérification` }); await load(); } catch (e: any) { setResult({ ok: false, text: e.message }); } }}>Vérifier mes dépôts</button>
      </div>

      {recs.length > 0 && (
        <>
          <div className="divider" />
          <h3>Transferts et Travel Rule</h3>
          <div className="tr-list" data-testid="travel-rule">
            {recs.map((r) => (
              <div key={r.id} className={`tr-item ${r.status === "en attente de vérification" ? "held" : ""}`}>
                <p><strong>{r.direction === "sortant" ? "Retrait vers le wallet" : "Dépôt sur Swissquote"}</strong> · {btcFmt(BigInt(r.amount_sats))} · {r.status}</p>
                <p className="small muted">{r.originator} → {r.beneficiary}</p>
                <p className="small">{r.verification}</p>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
