// Transferts entre le compte crypto Swissquote (custodial) et le wallet self-custody, sous la Travel Rule :
// Swissquote n'envoie vers le wallet qu'après une preuve de propriété (faite automatiquement par le Wallet du client),
// et ne crédite un dépôt que si sa provenance est un wallet enregistré du client.
import { useCallback, useEffect, useState } from "react";
import { type WalletConfig, outputAt } from "@sq/bitcoin";
import { type TravelRuleRecord, custody, depositAddress, ownershipStatus, syncDeposits, travelRule, withdrawToWallet } from "../lib/bank";
import { txLink } from "../lib/chain";
import { btcFmt, parseBtc } from "../lib/format";
import { proveOwnership } from "../lib/ownership";
import { useT } from "../i18n";

// Statuts enregistrés par bank-mock (valeurs en base) -> libellés affichés.
const STATUS: Record<string, string> = { "envoyé": "sent", "crédité": "credited", "en attente de vérification": "awaiting verification" };

export function Transfer({ cfg, receiveIndex, onDone, onDeposit }: { cfg: WalletConfig; receiveIndex: number; onDone: () => void; onDeposit: (address: string) => void }) {
  const { tr } = useT();
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
        setStatus(tr("Travel Rule: proving ownership of your wallet…"));
        const v = await proveOwnership(cfg, receiveIndex);
        if (!v.verified) throw new Error(`${tr("proof rejected:")} ${v.proves}`);
      }
      setStatus(tr("Ownership verified. Swissquote is sending…"));
      const r = await withdrawToWallet(address, sats);
      setStatus(null);
      setResult({ ok: true, text: `${tr("Transfer sent:")} ${r.txid}` });
      await load();
      onDone();
    } catch (e: any) { setStatus(null); setResult({ ok: false, text: e.message }); } finally { setBusy(false); }
  };

  return (
    <div className="transfer">
      <div className="sq-account">
        <p className="muted small">{tr("Swissquote crypto account (held in custody by Swissquote)")}</p>
        <p className="stat" data-testid="custody-balance">{bal === null ? "…" : btcFmt(BigInt(bal))}</p>
      </div>

      <h3>{tr("To my wallet")}</h3>
      <p className="small">{tr("Funds go from your Swissquote account to address #{i} of your wallet. Swissquote first checks that this wallet really is yours (Travel Rule).", { i: receiveIndex })}</p>
      <label><span>{tr("Amount (BTC)")}</span><input value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.1" /></label>
      <button className="btn-primary wide" disabled={busy || !amount} onClick={withdraw}>{tr("Transfer to my wallet")}</button>
      {status && <p className="note">{status}</p>}
      {result && (
        <p className={result.ok ? "success" : "error"} data-testid="transfer-result">
          {result.text}
          {result.ok && txLink(result.text.split(": ")[1]) && <> · <a href={txLink(result.text.split(": ")[1])!} target="_blank" rel="noreferrer">{tr("explorer")}</a></>}
        </p>
      )}

      <div className="divider" />
      <h3>{tr("To my Swissquote account")}</h3>
      <p className="small">{tr("Send from your wallet to your deposit address. The deposit is only credited if it comes from one of your registered wallets.")}</p>
      <div className="btn-row">
        <button className="btn-secondary" onClick={async () => { try { onDeposit(await depositAddress()); } catch (e: any) { setResult({ ok: false, text: e.message }); } }}>{tr("Prepare a deposit")}</button>
        <button className="btn-secondary" onClick={async () => { try { const s = await syncDeposits(); setResult({ ok: true, text: tr("Deposits: {c} credited, {h} awaiting verification", { c: s.credited, h: s.held }) }); await load(); } catch (e: any) { setResult({ ok: false, text: e.message }); } }}>{tr("Check my deposits")}</button>
      </div>

      {recs.length > 0 && (
        <>
          <div className="divider" />
          <h3>{tr("Transfers and Travel Rule")}</h3>
          <div className="tr-list" data-testid="travel-rule">
            {recs.map((r) => (
              <div key={r.id} className={`tr-item ${r.status === "en attente de vérification" ? "held" : ""}`}>
                <p><strong>{r.direction === "sortant" ? tr("Withdrawal to wallet") : tr("Deposit to Swissquote")}</strong> · {btcFmt(BigInt(r.amount_sats))} · {tr(STATUS[r.status] ?? r.status)}</p>
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
