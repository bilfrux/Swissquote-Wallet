// Changement du contact de confiance (Bitcoin). Le contact fait partie du script du compte : en changer, c'est changer la
// règle, donc les adresses. Même clé client, même clé Swissquote, nouveau contact ; le client déplace TOUS ses coins vers la
// nouvelle règle (une transaction « clé du client seule », signée dans le Client Wallet avec la biométrie), ce qui fait aussi
// repartir le délai de zéro. Ensuite seulement : Swissquote met à jour son registre et le wallet enregistre la nouvelle politique.
import { useState } from "react";
import { type PsbtSummary as Summary, type WalletConfig, buildSpend, createWalletConfig, finalizePsbt, outputAt, parseAccountKey, scan, simulate } from "@sq/bitcoin";
import { changeTiers } from "../lib/bank";
import { chain, txLink } from "../lib/chain";
import { type BtcAccount, DELAY, NETWORK } from "../lib/config";
import { btcFmt } from "../lib/format";
import { walletRequest } from "../lib/walletBridge";
import { PsbtSummary } from "../simulation/PsbtSummary";
import { useT } from "../i18n";

type Policy = { network: string; delay: number; swissquote: string; tiers: string; tiersName: string };
type Pending = { policy: Policy; account: BtcAccount; txid: string | null; bank: boolean; wallet: boolean };
const PENDING = `sq-wallet:contact-change:${NETWORK}`;
const loadPending = (): Pending | null => JSON.parse(localStorage.getItem(PENDING) ?? "null");

export function ChangeContact({ cfg, account, onChanged }: { cfg: WalletConfig; account: BtcAccount; onChanged: (a: BtcAccount) => void }) {
  const { tr } = useT();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [key, setKey] = useState("");
  const [prep, setPrep] = useState<{ policy: Policy; psbt: string | null; summary: Summary | null; to: string } | null>(null);
  const [signed, setSigned] = useState<string | null>(null);
  const [pending, setPendingState] = useState<Pending | null>(loadPending);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const setPending = (p: Pending | null) => { if (p) localStorage.setItem(PENDING, JSON.stringify(p)); else localStorage.removeItem(PENDING); setPendingState(p); };
  const guard = (f: () => Promise<void>) => async () => { setError(null); setBusy(true); try { await f(); } catch (e: any) { setError(e.message); } finally { setBusy(false); } };
  const reset = () => { setOpen(false); setPrep(null); setSigned(null); setName(""); setKey(""); setError(null); };
  const newAccount = (p: Policy): BtcAccount => ({ ...account, tiers: p.tiers, tiersName: p.tiersName });

  const prepare = guard(async () => {
    if (!name.trim()) throw new Error(tr("Enter the new contact's name."));
    const parsed = parseAccountKey(key.trim(), NETWORK);
    if (parsed.raw === account.tiers) throw new Error(tr("This is already your trusted contact."));
    if (parsed.raw === account.client || parsed.raw === account.swissquote) throw new Error(tr("The trusted contact must be a third party (not you, not Swissquote)."));
    const newCfg = await createWalletConfig({ network: NETWORK, delay: cfg.delay, client: account.client, swissquote: account.swissquote, tiers: parsed.raw });
    const policy: Policy = { network: NETWORK, delay: cfg.delay || DELAY, swissquote: account.swissquote, tiers: newCfg.tiers.raw, tiersName: name.trim() };
    const to = outputAt(newCfg, 0, 0).getAddress();
    // Coins relus sur la chaîne à cet instant (pas la liste en mémoire, peut-être pas encore chargée) : jamais « aucun coin » par erreur.
    const coins = await scan(cfg, chain);
    if (!coins.length) return setPrep({ policy, psbt: null, summary: null, to });
    const rates = await chain.feeRates();
    const built = await buildSpend({ cfg, backend: chain, utxos: coins, path: "client", feeRate: rates.normal, to });
    setPrep({ policy, psbt: built.psbt, summary: built.summary, to });
  });

  const sign = guard(async () => {
    const r = await walletRequest<{ psbt: string }>("sign", { psbt: prep!.psbt, nextPolicy: prep!.policy });
    // La transaction signée doit être exactement celle qui a été préparée.
    const s = simulate(cfg, r.psbt);
    const key = (x: Summary) => JSON.stringify(x.outputs.map((o) => [o.address, String(o.value)]));
    if (key(s) !== key(prep!.summary!)) throw new Error(tr("the signed transaction does not match the prepared one"));
    if (s.inputs.some((i) => i.signatures === 0)) throw new Error(tr("the transaction is not signed"));
    setSigned(r.psbt);
  });

  // Point de non-retour : après la diffusion, les coins sont sous la nouvelle règle ; on garde l'état pour reprendre.
  const finishBank = async (p: Pending) => {
    try { await changeTiers(p.account.client, p.policy.tiers, p.policy.tiersName); return { ...p, bank: true }; }
    catch (e: any) { setError(`${tr("Swissquote could not be updated:")} ${e.message}`); return p; }
  };
  const broadcast = guard(async () => {
    const { hex } = finalizePsbt(cfg, signed!);
    const txid = await chain.broadcast(hex);
    setPending(await finishBank({ policy: prep!.policy, account: newAccount(prep!.policy), txid, bank: false, wallet: false }));
    reset();
  });
  const noCoins = guard(async () => { setPending(await finishBank({ policy: prep!.policy, account: newAccount(prep!.policy), txid: null, bank: false, wallet: false })); reset(); });
  const retryBank = guard(async () => { setPending(await finishBank(pending!)); });
  const saveWallet = guard(async () => {
    if (pending!.account.walletId) await walletRequest("policy", { walletId: pending!.account.walletId, policy: pending!.policy });
    setPending({ ...pending!, wallet: true });
  });
  const done = () => { const a = pending!.account; setPending(null); onChanged(a); };

  if (pending)
    return (
      <div className="sec-item" data-testid="contact-change-pending">
        <p className="sec-who">{tr("Change of trusted contact in progress")}</p>
        <p className="small">{tr("New contact: {n}.", { n: pending.policy.tiersName })} {pending.txid ? <>{tr("Your coins were moved to the new rule:")} <span className="mono">{pending.txid.slice(0, 16)}…</span>{txLink(pending.txid) && <> · <a href={txLink(pending.txid)!} target="_blank" rel="noreferrer">{tr("explorer")}</a></>}</> : tr("No coins had to be moved.")}</p>
        <p className="small">{pending.bank ? "✓" : "…"} {tr("Swissquote registry updated")}{!pending.bank && <> <button className="small" disabled={busy} onClick={retryBank}>{tr("Retry")}</button></>}</p>
        <p className="small">{pending.wallet ? "✓" : "…"} {tr("New rule saved in your Client Wallet")}{!pending.wallet && <> <button className="small" disabled={busy} onClick={saveWallet}>{tr("Save in my Client Wallet")}</button></>}</p>
        {error && <p className="error">{error}</p>}
        <button disabled={!pending.wallet || busy} onClick={done}>{tr("Finish and open my updated account")}</button>
      </div>
    );

  if (!open)
    return (
      <div className="sec-item">
        <p className="sec-who">{tr("Trusted contact")}: {account.tiersName || tr("your trusted contact")}</p>
        <p className="small">{tr("Swissquote and this contact together can help you recover your coins. You can replace the contact: your coins are moved to a new rule that includes the new contact, and the delay restarts.")}</p>
        <button className="btn-secondary" onClick={() => setOpen(true)}>{tr("Change my trusted contact")}</button>
      </div>
    );

  return (
    <div className="sec-item" data-testid="contact-change-form">
      <p className="sec-who">{tr("Change my trusted contact")}</p>
      {!prep && (
        <>
          <label><span>{tr("New contact's name")}</span><input value={name} onChange={(e) => setName(e.target.value)} placeholder="Marie Dupont" /></label>
          <label><span>{tr("New contact's public key")}</span><input className="mono" value={key} onChange={(e) => setKey(e.target.value)} placeholder="[fingerprint/48'/1'/0'/2']tpub…" /></label>
          <p className="small">{tr("Ask your contact to send you their public key from their console, and check it with them by another means.")}</p>
          {error && <p className="error">{error}</p>}
          <p><button className="btn-secondary" onClick={reset}>{tr("Cancel")}</button> <button disabled={busy || !name.trim() || !key.trim()} onClick={prepare}>{tr("Prepare the change")}</button></p>
        </>
      )}
      {prep && (
        <>
          <p>{tr("New trusted contact: {n}", { n: prep.policy.tiersName })}</p>
          {prep.summary ? (
            <>
              <p className="small">{tr("All your coins ({a}) move to a new address of your account. You alone can still spend them; Swissquote and {n} together will be able to move them after {d} blocks without movement.", { a: btcFmt(prep.summary.inputs.reduce((s, i) => s + i.value, 0n)), n: prep.policy.tiersName, d: prep.policy.delay })}</p>
              <PsbtSummary summary={prep.summary} delay={cfg.delay} labels={{ [prep.to]: tr("your new account (new trusted contact)") }} />
              {!signed
                ? <button disabled={busy} onClick={sign}>{tr("Sign with my Client Wallet")}</button>
                : <><p className="success">{tr("Transaction signed by your wallet.")}</p><button disabled={busy} onClick={broadcast}>{tr("Broadcast on the Bitcoin network")}</button></>}
            </>
          ) : (
            <>
              <p className="small">{tr("Your account holds no coins: nothing has to be moved.")}</p>
              <button disabled={busy} onClick={noCoins}>{tr("Change the contact")}</button>
            </>
          )}
          {error && <p className="error">{error}</p>}
          <p><button className="link" onClick={reset}>{tr("Cancel")}</button></p>
        </>
      )}
    </div>
  );
}
