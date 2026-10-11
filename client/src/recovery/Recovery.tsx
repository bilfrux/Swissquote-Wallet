// « Récupérer mon compte » : le client a perdu sa clé. Swissquote (après re-KYC) et le tiers signent chacun un PSBT
// qui envoie les coins vers un NOUVEAU compte du client. Le consensus Bitcoin refuse la transaction tant que les coins
// n'ont pas D confirmations : l'appli diffuse et affiche l'erreur réelle du nœud.
import { useEffect, useState } from "react";
import {
  type PsbtSummary as Summary, type WalletConfig, type WalletUtxo,
  buildSpend, combinePsbts, createWalletConfig, finalizePsbt, outputAt, scan, simulate,
} from "@sq/bitcoin";
import { type KycForm, type RegisteredAccount, cryptoUnlockKyc, guardianSign, listAccounts, registerAccount, relayCreate, relayGet, verifyIdentity } from "../lib/bank";
import { chain, txLink } from "../lib/chain";
import { type BtcAccount, NETWORK } from "../lib/config";
import { walletRequest } from "../lib/walletBridge";
import { btcFmt } from "../lib/format";
import { PsbtSummary } from "../simulation/PsbtSummary";
import { useT } from "../i18n";

const CONSOLE_URL = import.meta.env.VITE_GUARDIAN_CONSOLE_URL ?? "http://localhost:5174";

// État persistant (données publiques uniquement : clés publiques et PSBT), pour survivre aux D blocs d'attente.
type Saved = { old?: RegisteredAccount; newClient?: string; newAccountId?: number; newWalletId?: string; psbt?: string; sqPsbt?: string; relayId?: string; combined?: string; txid?: string };
const KEY = `sq-wallet:recovery:${NETWORK}`;
const load = (): Saved => JSON.parse(localStorage.getItem(KEY) ?? "{}");

export function Recovery({ onDone, onCancel }: { onDone: (a: BtcAccount) => void; onCancel: () => void }) {
  const { tr } = useT();
  const [s, setS] = useState<Saved>(load);
  const save = (patch: Partial<Saved>) => setS((prev) => { const n = { ...prev, ...patch }; localStorage.setItem(KEY, JSON.stringify(n)); return n; });
  const [token, setToken] = useState<string | null>(null); // jeton KYC : en mémoire seulement
  const [kyc, setKyc] = useState<KycForm>({ lastName: "", birthDate: "", otp: "" });
  const [accounts, setAccounts] = useState<RegisteredAccount[] | null>(null);
  const [oldCfg, setOldCfg] = useState<WalletConfig | null>(null);
  const [newCfg, setNewCfg] = useState<WalletConfig | null>(null);
  const [utxos, setUtxos] = useState<WalletUtxo[] | null>(null);
  const [newClientText, setNewClientText] = useState(s.newClient ?? "");
  const [tiersText, setTiersText] = useState("");
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const guard = (f: () => Promise<void> | void) => async () => { setError(null); try { await f(); } catch (e: any) { setError(e.message); } };
  // Nouveau compte : nouvelle clé client, mêmes guardians et même délai, enregistré chez Swissquote.
  const createNewAccount = async (client: string, walletId?: string) => {
    await createWalletConfig({ network: NETWORK, delay: s.old!.delay, client, swissquote: s.old!.swissquote, tiers: s.old!.tiers });
    const { accountId } = await registerAccount({ delay: s.old!.delay, client, tiers: s.old!.tiers, tiersName: s.old!.tiersName });
    save({ newClient: client, newAccountId: accountId, newWalletId: walletId });
  };

  useEffect(() => {
    if (!s.old) return setOldCfg(null);
    createWalletConfig({ network: NETWORK, delay: s.old.delay, client: s.old.client, swissquote: s.old.swissquote, tiers: s.old.tiers }).then(setOldCfg, (e) => setError(e.message));
  }, [s.old]);
  useEffect(() => {
    if (!s.old || !s.newClient) return setNewCfg(null);
    createWalletConfig({ network: NETWORK, delay: s.old.delay, client: s.newClient, swissquote: s.old.swissquote, tiers: s.old.tiers }).then(setNewCfg, (e) => setError(e.message));
  }, [s.old, s.newClient]);
  const refreshCoins = guard(async () => { if (oldCfg) setUtxos(await scan(oldCfg, chain)); });
  useEffect(() => { refreshCoins(); }, [oldCfg]); // eslint-disable-line react-hooks/exhaustive-deps

  const waitBlocks = utxos?.length ? Math.max(...utxos.map((u) => u.recoveryOpensIn)) : null;
  const labels = newCfg ? { [outputAt(newCfg, 0, 0).getAddress()]: tr("your new account") } : {};
  // Ajoute la signature du tiers (reçue par le relais Swissquote ou collée à la main) et vérifie qu'elle complète la recovery.
  const addTiers = (signed: string) => {
    const combined = combinePsbts([s.sqPsbt!, signed]);
    const sum = simulate(oldCfg!, combined);
    if (sum.path !== "recovery" || sum.inputs.some((i) => i.signatures < 2)) throw new Error(tr("a signature is missing (Swissquote + trusted contact required on every coin)"));
    save({ combined });
  };
  const combinedSummary: Summary | null = oldCfg && s.combined ? simulate(oldCfg, s.combined) : null;

  return (
    <section>
      <h2>{tr("Recover my account")}</h2>
      <p className="note">
        {tr("You have lost your wallet key. Swissquote (after identity verification) and your trusted contact can together move your coins to a new account, but only for coins that have not moved for {d} blocks. This rule is enforced by the Bitcoin network, not by Swissquote.", { d: s.old?.delay ?? "D" })}
      </p>
      {error && <p className="error">{error}</p>}

      <div className="step">
        <h3>{tr("1. Identity verification (Swissquote)")}</h3>
        {token ? <p className="success">{tr("Identity verified.")}</p> : (
          <>
            <div className="row">
              <label><span>{tr("Last name")}</span><input value={kyc.lastName} onChange={(e) => setKyc({ ...kyc, lastName: e.target.value })} /></label>
              <label><span>{tr("Date of birth")}</span><input placeholder={tr("YYYY-MM-DD")} value={kyc.birthDate} onChange={(e) => setKyc({ ...kyc, birthDate: e.target.value })} /></label>
              <label><span>{tr("Code received by SMS (mock)")}</span><input value={kyc.otp} onChange={(e) => setKyc({ ...kyc, otp: e.target.value })} /></label>
            </div>
            <button onClick={guard(async () => { const t = (await verifyIdentity(kyc)).token; await cryptoUnlockKyc(t); setToken(t); setAccounts(await listAccounts(t)); })}>{tr("Verify my identity")}</button>
          </>
        )}
      </div>

      {(accounts || s.old) && (
        <div className="step">
          <h3>{tr("2. Account to recover")}</h3>
          {s.old ? (
            <p>{tr("Account")} #{s.old.id} · {tr("lost key")} <span className="mono">{s.old.client.slice(0, 22)}…</span></p>
          ) : accounts!.length === 0 ? <p>{tr("No registered account.")}</p> : (
            accounts!.map((a) => (
              <p key={a.id}>
                <button className="small" onClick={() => save({ old: a })}>{tr("Select")}</button>{" "}
                {tr("Account #{id}, created on {d}, key", { id: a.id, d: a.createdAt })} <span className="mono">{a.client.slice(0, 22)}…</span>
              </p>
            ))
          )}
          {utxos && (
            <p>
              {tr("{n} coin(s)", { n: utxos.length })}, {btcFmt(utxos.reduce((t, u) => t + u.value, 0n))}
              {waitBlocks !== null && (waitBlocks === 0 ? ` · ${tr("delay elapsed for all coins")}` : ` · ${tr("delay elapsed in {n} block(s)", { n: waitBlocks })}`)}{" "}
              <button className="small" onClick={refreshCoins}>{tr("Reload")}</button>
            </p>
          )}
        </div>
      )}

      {s.old && (
        <div className="step">
          <h3>{tr("3. Your new key")}</h3>
          {!s.newClient ? (
            <>
              <p className="note">{tr("Create a new wallet on your new device. Its secret phrase will be generated in the Client Wallet; Swissquote will only receive its public key.")}</p>
              <button onClick={guard(async () => {
                const r = await walletRequest<{ accountKey: string; walletId: string }>("create", { label: "Swissquote Bitcoin wallet (after recovery)" });
                await createNewAccount(r.accountKey, r.walletId);
              })}>{tr("Create a new wallet with the Client Wallet")}</button>
              <details>
                <summary>{tr("I use another compatible wallet (Bitcoin Core, Liana…)")}</summary>
                <textarea rows={2} className="mono" placeholder="[fingerprint/48'/1'/0'/2']tpub…" value={newClientText} onChange={(e) => setNewClientText(e.target.value)} />
                <button className="secondary" onClick={guard(() => createNewAccount(newClientText.trim()))}>{tr("Create the new account with this key")}</button>
              </details>
            </>
          ) : <p className="success">{tr("New wallet created (key")} <span className="mono">{s.newClient.slice(0, 22)}…</span>).</p>}
          {newCfg && <p>{tr("New address:")} <span className="mono">{outputAt(newCfg, 0, 0).getAddress()}</span></p>}
        </div>
      )}

      {oldCfg && newCfg && utxos && (
        <div className="step">
          <h3>{tr("4. Recovery request and Swissquote signature")}</h3>
          {!s.psbt ? (
            <button disabled={!utxos.length} onClick={guard(async () => {
              const { psbt } = await buildSpend({ cfg: oldCfg, backend: chain, utxos, path: "recovery", feeRate: 2, to: outputAt(newCfg, 0, 0).getAddress() });
              save({ psbt });
            })}>{tr("Prepare the request")}</button>
          ) : (
            <>
              <PsbtSummary summary={simulate(oldCfg, s.sqPsbt ?? s.psbt)} delay={oldCfg.delay} labels={labels} />
              {!s.sqPsbt && (
                <button disabled={!token} onClick={guard(async () => save({ sqPsbt: (await guardianSign(token!, s.psbt!)).psbt }))}>
                  {tr("Request Swissquote's signature")}
                </button>
              )}
              {!token && !s.sqPsbt && <p className="note">{tr("Verify your identity first (step 1).")}</p>}
            </>
          )}
        </div>
      )}

      {s.sqPsbt && oldCfg && (
        <div className="step">
          <h3>{tr("5. Your trusted contact's signature")}</h3>
          <p className="note">{tr("Send this PSBT to {who}. They check and sign it in their guardian console, then send it back to you.", { who: s.old?.tiersName || tr("your trusted contact") })}</p>
          {!s.relayId ? (
            <button onClick={guard(async () => save({ relayId: await relayCreate(s.sqPsbt!) }))}>{tr("Send the request to {who}", { who: s.old?.tiersName || tr("my trusted contact") })}</button>
          ) : (
            <>
              <p className="note">{tr("Link to send to your trusted contact (it opens their console with the request already loaded):")}</p>
              <p className="mono small" data-testid="relay-link">{`${CONSOLE_URL}/?req=${s.relayId}`}</p>
              {!s.combined && <button onClick={guard(async () => {
                const r = await relayGet(s.relayId!);
                if (!r.signed) throw new Error(tr("not yet signed by your trusted contact"));
                addTiers(r.signed);
              })}>{tr("Fetch the trusted contact's signature")}</button>}
            </>
          )}
          <details><summary className="small">{tr("Without Swissquote: manual PSBT exchange")}</summary>
          <textarea readOnly rows={3} className="mono" value={s.sqPsbt} />
          <button className="small" onClick={() => navigator.clipboard.writeText(s.sqPsbt!)}>{tr("Copy for the trusted contact")}</button>
          {!s.combined && (
            <>
              <textarea rows={3} className="mono" placeholder={tr("PSBT signed by the trusted contact (cHNidP8…)")} value={tiersText} onChange={(e) => setTiersText(e.target.value)} />
              <button onClick={guard(() => addTiers(tiersText))}>{tr("Add the trusted contact's signature")}</button>
            </>
          )}
          </details>
        </div>
      )}

      {combinedSummary && oldCfg && newCfg && (
        <div className="step">
          <h3>{tr("6. Broadcast")}</h3>
          <PsbtSummary summary={combinedSummary} delay={oldCfg.delay} labels={labels} />
          {s.txid ? (
            <>
              <p className="success">
                {tr("Recovery broadcast:")} <span className="mono">{s.txid}</span>
                {txLink(s.txid) && <> · <a href={txLink(s.txid)!} target="_blank" rel="noreferrer">{tr("explorer")}</a></>}
              </p>
              <button onClick={guard(async () => {
                const o = s.old!;
                const account: BtcAccount = { id: s.newAccountId, client: s.newClient!, swissquote: o.swissquote, tiers: o.tiers, tiersName: o.tiersName, delay: o.delay, walletId: s.newWalletId };
                // Le nouveau wallet apprend la politique du compte (données publiques) pour reconnaître son change.
                if (s.newWalletId) await walletRequest("policy", { walletId: s.newWalletId, policy: { network: NETWORK, delay: o.delay, swissquote: o.swissquote, tiers: o.tiers, tiersName: o.tiersName } });
                localStorage.removeItem(KEY);
                onDone(account);
              })}>{tr("Open my new account")}</button>
            </>
          ) : (
            <button onClick={guard(async () => {
              setResult(null);
              const { hex } = finalizePsbt(oldCfg, s.combined!);
              try { save({ txid: await chain.broadcast(hex) }); } catch (e: any) {
                const m = String(e.message);
                setResult(m.includes("non-BIP68-final")
                  ? tr("Rejected by the Bitcoin network: “{m}”. The {d}-block delay has not elapsed", { m, d: oldCfg.delay }) + (waitBlocks ? ` (${tr("{n} block(s) to go", { n: waitBlocks })})` : "") + `. ${tr("Try again later.")}`
                  : `${tr("Rejected by the network:")} ${m}`);
                refreshCoins();
              }
            })}>{tr("Broadcast the recovery")}</button>
          )}
          {result && <p className="error">{result}</p>}
        </div>
      )}

      <p>
        <button className="link" onClick={onCancel}>{tr("Back")}</button>{" · "}
        <button className="link" onClick={() => { localStorage.removeItem(KEY); setS({}); setUtxos(null); setTiersText(""); setResult(null); }}>{tr("Restart the recovery")}</button>
      </p>
    </section>
  );
}
