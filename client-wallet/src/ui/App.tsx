// Interface du Wallet du client. Ouverte par l'appli Swissquote (fenêtre séparée, postMessage) pour :
//  - créer un wallet (phrase affichée une fois, seule la clé publique est renvoyée) ;
//  - enregistrer la politique du compte (données publiques) ;
//  - signer un envoi APRÈS confirmation explicite du client.
// Ouverte seule, elle liste les wallets et permet de simuler la perte de l'appareil.
import { useEffect, useRef, useState } from "react";
import { type Auth, type BioKey, bioAvailable, bioEnroll, bioSecret } from "./bio";

const ALLOWED = (import.meta.env.VITE_WALLET_ALLOWED_ORIGINS ?? "http://localhost:5173")
  .split(",").map((origin: string) => origin.trim()).filter(Boolean);
type Req = { id: string; action: "create" | "sign" | "policy" | "prove" | "evm-address" | "evm-sign"; network: "regtest" | "signet"; payload: any; origin: string; source: Window };
type WalletView = { id: string; label: string; accountKey: string; createdAt: string; protected: boolean; unlock?: { pin: boolean; bio: BioKey | null }; evmAddress?: string; policy?: { delay: number; tiersName?: string; network: string } };

// Saisie conservée uniquement pour migrer un ancien wallet PIN vers la biométrie.
function PinInput({ value, onChange, label = "Wallet PIN" }: { value: string; onChange: (v: string) => void; label?: string }) {
  return (
    <label className="pin">
      <span>{label}</span>
      <input type="password" inputMode="numeric" autoComplete="off" maxLength={12} value={value} onChange={(e) => onChange(e.target.value.replace(/\D/g, ""))} />
    </label>
  );
}
const pinOk = (p: string) => /^\d{6,12}$/.test(p);

// Les signatures utilisent toujours la biométrie. Le PIN n'est accepté ici que pour migrer un ancien wallet.
function UnlockAction({ wallet, label, disabled, allowPin = false, onAuth, onRefuse, onError }: {
  wallet: WalletView | null | undefined; label: string; disabled?: boolean; allowPin?: boolean; onAuth: (a: Auth) => Promise<void>; onRefuse?: () => void; onError: (e: string) => void;
}) {
  const [pin, setPin] = useState("");
  const [busy, setBusy] = useState(false);
  const bio = wallet?.protected ? wallet.unlock?.bio ?? null : null;
  const hasPin = !!wallet?.protected && !!wallet.unlock?.pin;
  const mode = !wallet?.protected ? "none" : bio ? "bio" : allowPin && hasPin ? "pin" : "unavailable";
  const go = async () => {
    setBusy(true);
    try { await onAuth(mode === "bio" ? { prf: await bioSecret(bio!) } : mode === "pin" ? { pin } : {}); }
    catch (e: any) { onError(e.message); }
    finally { setPin(""); setBusy(false); }
  };
  return (
    <>
      {mode === "pin" && <PinInput value={pin} onChange={setPin} />}
      {mode === "bio" && <p className="small bio-hint" data-testid="bio-hint"><span aria-hidden="true">◉</span> Your device will ask for your fingerprint or face (Touch ID, Face ID…).</p>}
      {mode === "unavailable" && (
        <>
          <p className="small error">Biometrics must be enabled before this wallet can be used. Enable them in the wallet settings, then come back to this request.</p>
          <p><button className="secondary" onClick={() => window.dispatchEvent(new Event("open-wallet-settings"))}>Open wallet settings</button></p>
        </>
      )}
      <div className="row">
        {onRefuse && <button className="secondary" onClick={onRefuse}>Refuse</button>}
        {mode !== "unavailable" && <button disabled={disabled || busy || (mode === "pin" && !pinOk(pin))} onClick={go}>{busy && mode === "bio" ? "Waiting for biometrics…" : label}</button>}
      </div>
    </>
  );
}
type Description = {
  wallet: WalletView | null; path: "client" | "recovery" | "mixte"; delay: number | null;
  inputs: { value: string }[]; outputs: { address: string; value: string; mine: string | null }[]; fee: string;
  sent: string; high: boolean; highValueSats: string; confirmTarget: string | null;
  contactChange: { from: string | null; to: string | null; key: string; delay: number } | null;
};

async function api(path: string, body?: unknown, method = body ? "POST" : "GET") {
  const r = await fetch(path, { method, headers: body ? { "content-type": "application/json" } : {}, body: body ? JSON.stringify(body) : undefined });
  const j = await r.json();
  if (!r.ok) throw new Error(j.error);
  return j;
}
const btc = (sats: string | bigint) => { const s = BigInt(sats).toString().padStart(9, "0"); return `${s.slice(0, -8)}.${s.slice(-8)} BTC`; };

export function App() {
  const [req, setReq] = useState<Req | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Réglages (liste des wallets) ouverts pendant une demande, pour activer la biométrie d'un ancien wallet.
  const [settings, setSettings] = useState(false);
  useEffect(() => {
    const open = () => setSettings(true);
    window.addEventListener("open-wallet-settings", open);
    return () => window.removeEventListener("open-wallet-settings", open);
  }, []);
  const reply =(ok: boolean, data: unknown) => {
    req!.source.postMessage({ type: "wallet-response", id: req!.id, ok, ...(ok ? { data } : { error: data }) }, req!.origin);
  };

  useEffect(() => {
    const onMsg = (e: MessageEvent) => {
      if (!ALLOWED.includes(e.origin) || e.data?.type !== "wallet-request") return; // origine non autorisée : ignorée
      setReq({ ...e.data, origin: e.origin, source: e.source as Window });
      setDone(null);
      setError(null);
    };
    window.addEventListener("message", onMsg);
    // Signal « prêt » à la fenêtre qui nous a ouverts (aucune donnée sensible).
    window.opener?.postMessage({ type: "wallet-ready" }, "*");
    return () => window.removeEventListener("message", onMsg);
  }, []);

  return (
    <main>
      <header>
        <div className="brand">
          <img className="swissquote-logo" src="/swissquote-logo.png" alt="Swissquote" />
          <div className="brand-copy"><div className="brand-name">Client Wallet</div><div className="tag">Swissquote · self-custody</div></div>
        </div>
        <div className="ref">Independent wallet · your keys stay on this device</div>
      </header>
      {error && <p className="error">{error}</p>}
      {done && <p className="done">{done}</p>}
      {req?.action === "create" && !done && <Create req={req} onDone={(d) => { reply(true, d); setDone("Public key sent to Swissquote. You can close this window."); }} onError={setError} />}
      {req?.action === "policy" && !done && <PolicyReq req={req} onDone={(d) => { reply(true, d); setDone("Account policy saved in your wallet."); }} onError={setError} />}
      {req?.action === "sign" && !done && (
        <Sign
          req={req}
          onDone={(d) => { reply(true, d); setDone("Transaction signed and returned to the app. You can close this window."); }}
          onRefuse={() => { reply(false, "refused by the client"); setDone("Signature refused."); }}
          onError={setError}
        />
      )}
      {req?.action === "prove" && !done && (
        <Prove
          req={req}
          onDone={(d) => { reply(true, d); setDone("Proof signed and returned to the app. No funds were moved."); }}
          onRefuse={() => { reply(false, "refused by the client"); setDone("Proof refused."); }}
          onError={setError}
        />
      )}
      {req?.action === "evm-address" && !done && (
        <EvmAddress
          req={req}
          onDone={(d) => { reply(true, d); setDone("Ethereum address sent to Swissquote. You can close this window."); }}
          onRefuse={() => { reply(false, "refused by the client"); setDone("Refused."); }}
          onError={setError}
        />
      )}
      {req?.action === "evm-sign" && !done && (
        <EvmSign
          req={req}
          onDone={(d) => { reply(true, d); setDone("Operation signed and returned to the app. You can close this window."); }}
          onRefuse={() => { reply(false, "refused by the client"); setDone("Signature refused."); }}
          onError={setError}
        />
      )}
      {(!req || done || settings) && <Wallets />}
    </main>
  );
}

function Create({ req, onDone, onError }: { req: Req; onDone: (d: unknown) => void; onError: (e: string) => void }) {
  const [created, setCreated] = useState<{ wallet: WalletView; mnemonic: string } | null>(null);
  const [noted, setNoted] = useState(false);
  const [method, setMethod] = useState<"bio" | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { Promise.resolve(bioAvailable()).then((ok) => setMethod(ok ? "bio" : null)); }, []);
  const words = useRef<string[]>([]);
  const generate = async () => {
    setBusy(true);
    try {
      const unlock = { bio: await bioEnroll(req.payload?.label ?? "My wallet") };
      const c = await api("/api/wallets", { network: req.network, label: req.payload?.label, ...unlock });
      words.current = c.mnemonic.split(" "); setCreated(c);
    } catch (e: any) { onError(e.message); } finally { setBusy(false); }
  };
  if (!created)
    return (
      <section>
        <h2>Create your Bitcoin wallet</h2>
        <p>The app <strong>{req.origin}</strong> is asking to create a wallet. Your secret phrase will be generated here, on this device. Swissquote will only receive your public key.</p>
        <p className="small">Biometrics are required to unlock and sign with this wallet. Your device will ask for your fingerprint or face twice: once to create the wallet key, once to use it.</p>
        {!method && <p className="error">This device does not provide the required biometric authenticator.</p>}
        <button disabled={busy || !method} onClick={generate}>
          {busy && method === "bio" ? "Waiting for biometrics…" : "Generate my secret phrase"}
        </button>
      </section>
    );
  return (
    <section>
      <h2>Write down your secret phrase</h2>
      <p className="warn">It will never be shown again. Anyone who knows it controls your bitcoin. Do not photograph it and do not share it with anyone, not even Swissquote.</p>
      <ol className="words">{words.current.map((w, i) => <li key={i}>{w}</li>)}</ol>
      <label className="check"><input type="checkbox" checked={noted} onChange={(e) => setNoted(e.target.checked)} /> I have written my phrase down in a safe place</label>
      <button disabled={!noted} onClick={() => { words.current = []; setCreated({ ...created, mnemonic: "" }); onDone({ accountKey: created.wallet.accountKey, walletId: created.wallet.id }); }}>
        Send my public key to Swissquote
      </button>
    </section>
  );
}

function PolicyReq({ req, onDone, onError }: { req: Req; onDone: (d: unknown) => void; onError: (e: string) => void }) {
  useEffect(() => {
    api(`/api/wallets/${req.payload.walletId}/policy`, { policy: req.payload.policy }).then(onDone, (e) => onError(e.message));
  }, [req]); // eslint-disable-line react-hooks/exhaustive-deps
  return <section><p>Saving the account policy…</p></section>;
}

function Sign({ req, onDone, onRefuse, onError }: { req: Req; onDone: (d: unknown) => void; onRefuse: () => void; onError: (e: string) => void }) {
  const [d, setD] = useState<Description | null>(null);
  const [confirmDest, setConfirmDest] = useState("");
  useEffect(() => { api("/api/describe", { psbt: req.payload.psbt, network: req.network, nextPolicy: req.payload.nextPolicy }).then(setD, (e) => onError(e.message)); }, [req]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!d) return <section><p>Reading the transaction…</p></section>;
  const total = d.inputs.reduce((s, i) => s + BigInt(i.value), 0n);
  const ext = d.outputs.filter((o) => !o.mine);
  const sent = ext.reduce((s, o) => s + BigInt(o.value), 0n);
  return (
    <section>
      <h2>{d.contactChange ? "Confirm the change of trusted contact" : "Confirm the transfer"}</h2>
      <p className="small muted">Request from <strong>{req.origin}</strong> · wallet “{d.wallet?.label ?? "unknown"}”</p>
      {d.contactChange && (
        <div className="card" data-testid="contact-change">
          <p><strong>Your trusted contact changes</strong> from {d.contactChange.from ?? "the current contact"} to <strong>{d.contactChange.to ?? "a new contact"}</strong>.</p>
          <p className="small">New contact's public key: <span className="mono">{d.contactChange.key}</span></p>
          <p className="small">All your coins move to a new address of your account. You alone can still spend them. Swissquote and the <strong>new</strong> contact together will be able to move them after {d.contactChange.delay} blocks without movement (the delay restarts). Check the key with your contact by another means.</p>
        </div>
      )}
      <div className="hero">
        <p className="hero-label">{ext.length ? "You are sending" : "Transfer to yourself"}</p>
        <p className="hero-amount">{btc(ext.length ? sent : total - BigInt(d.fee))}</p>
        {ext.length > 0 && <p className="hero-to">to <span className="mono">{ext[0].address}</span></p>}
        <p className="hero-fee">+ fee {btc(d.fee)}</p>
      </div>
      <div className="card">
        <p><span className="k">Spending path</span>{" "}
          {d.path === "client" ? "your key alone (normal spending, no delay)" : d.path === "recovery" ? `Swissquote + trusted contact recovery (${d.delay}-block delay): your wallet does not sign this path` : "mixed (refused)"}
        </p>
        <p><span className="k">Coins spent</span> {d.inputs.length} · {btc(total)}</p>
        <table>
          <tbody>
            {d.outputs.map((o, i) => (
              <tr key={i} className={o.mine ? "mine" : "ext"}>
                <td>{o.mine ?? "to"}</td><td className="amt">{btc(o.value)}</td><td className="mono">{o.address}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p><span className="k">Fee</span> {btc(d.fee)}</p>
      </div>
      <p className="hint">Check the recipient's address by a means other than the app that suggested it.</p>
      {d.high && (
        <div className="high">
          <p><strong>High-value amount</strong> (threshold: {btc(d.highValueSats)}). To confirm, enter the <strong>last 6 characters</strong> of the recipient's address.</p>
          <label className="pin"><span>Last 6 characters of the address</span>
            <input value={confirmDest} maxLength={6} autoComplete="off" onChange={(e) => setConfirmDest(e.target.value.trim())} />
          </label>
        </div>
      )}
      <UnlockAction wallet={d.wallet} label="Confirm and sign" onRefuse={onRefuse} onError={onError}
        disabled={d.path !== "client" || !d.wallet || (d.high && confirmDest.length !== 6)}
        onAuth={async (a) => onDone(await api("/api/sign", { psbt: req.payload.psbt, network: req.network, nextPolicy: req.payload.nextPolicy, confirmDest, ...a }))} />
    </section>
  );
}

function Prove({ req, onDone, onRefuse, onError }: { req: Req; onDone: (d: unknown) => void; onRefuse: () => void; onError: (e: string) => void }) {
  const p = req.payload;
  const [w, setW] = useState<WalletView | null>(null);
  useEffect(() => { api("/api/wallets").then((l: WalletView[]) => setW(l.find((x) => x.accountKey === p.accountKey) ?? null)); }, [p.accountKey]);
  return (
    <section>
      <h2>Prove ownership of an address</h2>
      <p>Request from <strong>{req.origin}</strong>. Your wallet will sign this message with your key (address #{p.index}{p.change ? ", change" : ""}). <strong>This signature moves no funds</strong> and cannot be used to spend.</p>
      <pre className="card mono message">{p.message}</pre>
      <UnlockAction wallet={w} label="Sign the proof" onRefuse={onRefuse} onError={onError}
        onAuth={async (a) => onDone(await api("/api/prove", { accountKey: p.accountKey, change: p.change, index: p.index, message: p.message, network: req.network, ...a }))} />
    </section>
  );
}

// Kit de sortie : envoie TOUS les coins du wallet vers une adresse choisie, sans le site Swissquote, sans bank-mock et sans
// compte Swissquote. Même écran de confirmation et même signature biométrique que tout envoi.
function Exit({ wallet, onClose }: { wallet: WalletView; onClose: () => void }) {
  const [to, setTo] = useState("");
  const [fee, setFee] = useState("");
  const [prepared, setPrepared] = useState<{ psbt: string; network: "regtest" | "signet"; coins: number; total: string } | null>(null);
  const [txid, setTxid] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const fail = (e: string) => { setError(e); setBusy(false); };
  if (txid) return (
    <section>
      <h2>Emergency exit</h2>
      <p className="done">Transaction broadcast: <span className="mono">{txid}</span></p>
      <p className="small muted">All coins of this wallet were sent to the address you chose. No Swissquote service was used.</p>
      <button className="secondary" onClick={onClose}>Close</button>
    </section>
  );
  if (prepared) return (
    <>
      {error && <p className="error">{error}</p>}
      <p className="small muted">{prepared.coins} coin(s), {btc(prepared.total)} in total, found on the {prepared.network} network.</p>
      <Sign
        req={{ id: "exit", action: "sign", network: prepared.network, payload: { psbt: prepared.psbt }, origin: "Emergency exit (this wallet, no Swissquote service)", source: window }}
        onDone={async (signed: any) => { try { setTxid((await api("/api/exit/broadcast", { walletId: wallet.id, psbt: signed.psbt })).txid); } catch (e: any) { fail(e.message); } }}
        onRefuse={() => { setPrepared(null); setError(null); }}
        onError={fail}
      />
    </>
  );
  return (
    <section>
      <h2>Emergency exit</h2>
      <p>Sends <strong>all</strong> the coins of “{wallet.label}” to an address you choose, with your key alone. It works without the Swissquote site, its servers or your Swissquote account: it only needs this wallet and access to the Bitcoin network.</p>
      <label><span>Destination address</span><input className="mono" value={to} onChange={(e) => setTo(e.target.value)} placeholder="tb1… / bcrt1…" /></label>
      <label><span>Fee (sat/vB, empty = network estimate)</span><input value={fee} onChange={(e) => setFee(e.target.value.replace(/[^\d.]/g, ""))} /></label>
      {error && <p className="error">{error}</p>}
      <div className="row">
        <button className="secondary" onClick={onClose}>Back</button>
        <button disabled={busy || !to.trim()} onClick={async () => {
          setBusy(true); setError(null);
          try { setPrepared(await api("/api/exit/prepare", { walletId: wallet.id, to, ...(fee ? { feeRate: Number(fee) } : {}) })); setBusy(false); } catch (e: any) { fail(e.message); }
        }}>{busy ? "Reading the network…" : "Prepare the exit"}</button>
      </div>
    </section>
  );
}

function Wallets() {
  const [exiting, setExiting] = useState<WalletView | null>(null);
  const [list, setList] = useState<WalletView[] | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [protecting, setProtecting] = useState<string | null>(null);
  const refresh = () => api("/api/wallets").then(setList, (e) => setErr(e.message));
  useEffect(() => { refresh(); }, []);
  if (!list) return null;
  if (exiting) return <Exit wallet={exiting} onClose={() => { setExiting(null); refresh(); }} />;
  return (
    <section>
      <h2>My wallets</h2>
      {err && <p className="error">{err}</p>}
      {list.length === 0 && <p>No wallet on this device.</p>}
      {list.map((w) => (
        <div key={w.id} className="card">
          <p><strong>{w.label}</strong> · fingerprint {w.id} · created on {w.createdAt.slice(0, 16).replace("T", " ")}</p>
          <p className="mono small">{w.accountKey}</p>
          {w.evmAddress && <p className="mono small">Ethereum: {w.evmAddress}</p>}
          {w.policy && <p className="small">Policy: you alone, or Swissquote + {w.policy.tiersName ?? "trusted contact"} after {w.policy.delay} blocks of inactivity ({w.policy.network})</p>}
          {w.protected ? <UnlockSettings w={w} onChanged={refresh} /> : (
            protecting === w.id ? (
              <div>
                <p className="small">Biometrics are required to protect this wallet.</p>
                <button onClick={async () => { try { await api(`/api/wallets/${w.id}/protect`, { bio: await bioEnroll(w.label) }); setProtecting(null); refresh(); } catch (e: any) { setErr(e.message); } }}>Protect with biometrics</button>
              </div>
            ) : (
              <p className="small warnline">Not protected: phrase stored in clear. <button className="secondary" onClick={() => setProtecting(w.id)}>Protect with biometrics</button></p>
            )
          )}
          {w.policy && w.protected && <p><button className="secondary" onClick={() => setExiting(w)}>Emergency exit (works without Swissquote)</button></p>}
          {confirming === w.id ? (
            <div className="row">
              <button className="secondary" onClick={() => setConfirming(null)}>Cancel</button>
              <button className="danger" onClick={async () => { try { await api(`/api/wallets/${w.id}`, undefined, "DELETE"); setConfirming(null); refresh(); } catch (e: any) { setErr(e.message); } }}>Erase permanently</button>
            </div>
          ) : (
            <button className="secondary" onClick={() => setConfirming(w.id)}>Simulate losing this device</button>
          )}
        </div>
      ))}
    </section>
  );
}

// Adresse Ethereum : dérivée de la même phrase. Le wallet est désigné par sa clé publique Bitcoin (donnée publique).
function EvmAddress({ req, onDone, onRefuse, onError }: { req: Req; onDone: (d: unknown) => void; onRefuse: () => void; onError: (e: string) => void }) {
  const [w, setW] = useState<WalletView | null | undefined>(undefined);
  useEffect(() => { api("/api/wallets").then((l: WalletView[]) => setW(l.find((x) => x.accountKey === req.payload.accountKey) ?? null)); }, [req]);
  if (w === undefined) return <section><p>Loading…</p></section>;
  if (!w) return <section><p className="error">No wallet on this device matches your Bitcoin account.</p><button className="secondary" onClick={onRefuse}>Close</button></section>;
  return (
    <section>
      <h2>Add an Ethereum account</h2>
      <p>Request from <strong>{req.origin}</strong>. Your Ethereum key is derived from the same secret phrase, on this device. Swissquote will only receive its <strong>address</strong>.</p>
      {w.evmAddress ? <p className="mono card">{w.evmAddress}</p> : <p className="small">Your wallet must be unlocked once to compute the address.</p>}
      <UnlockAction wallet={w.evmAddress ? null : w} label="Send my Ethereum address" onRefuse={onRefuse} onError={onError}
        onAuth={async (a) => onDone(await api(`/api/wallets/${w.id}/evm`, a))} />
    </section>
  );
}

type EvmDescription = { wallet: WalletView; owner: string; safe: string; deploys: boolean; sponsored: boolean; paymaster: string | null; calls: { kind: string; text: string; risk?: string }[] };
// Confirmation d'une opération Ethereum : décodée par le wallet lui-même ; tout appel non reconnu bloque la signature.
function EvmSign({ req, onDone, onRefuse, onError }: { req: Req; onDone: (d: unknown) => void; onRefuse: () => void; onError: (e: string) => void }) {
  const [d, setD] = useState<EvmDescription | null>(null);
  useEffect(() => { api("/api/evm/describe", { op: req.payload.op }).then(setD, (e) => onError(e.message)); }, [req]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!d) return <section><p>Reading the operation…</p></section>;
  const blocked = d.calls.some((c) => c.kind === "unknown" || c.risk);
  return (
    <section>
      <h2>Confirm the Ethereum operation</h2>
      <p className="small muted">Request from <strong>{req.origin}</strong> · account <span className="mono">{d.safe}</span> (Sepolia)</p>
      <div className="card">
        {d.deploys && <p><span className="k">Account</span> created on-chain with this operation</p>}
        <ol className="calls">{d.calls.map((c, i) => <li key={i} className={c.risk ? "risk" : ""}>{c.text}{c.risk && <strong> · {c.risk}</strong>}</li>)}</ol>
        <p><span className="k">Network fees</span> {d.sponsored ? `paid by a sponsor (paymaster ${d.paymaster}), not by you` : "paid in ETH by your account"}</p>
      </div>
      {blocked && <p className="error">This operation contains a call your wallet cannot explain: it will not sign it.</p>}
      <UnlockAction wallet={d.wallet} label="Confirm and sign" disabled={blocked} onRefuse={onRefuse} onError={onError}
        onAuth={async (a) => onDone(await api("/api/evm/sign", { op: req.payload.op, ...a }))} />
    </section>
  );
}

// La biométrie est le seul mécanisme présenté pour déverrouiller et signer.
type UnlockOp = "set-bio";
function UnlockSettings({ w, onChanged }: { w: WalletView; onChanged: () => void }) {
  const [op, setOp] = useState<UnlockOp | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const bio = w.unlock?.bio ?? null;
  const close = () => { setOp(null); setErr(null); };
  return (
    <div className="unlock-settings" data-testid={`unlock-${w.id}`}>
      <p className="small ok">Phrase encrypted · unlock with <strong>{bio ? "biometrics" : "biometrics required"}</strong></p>
      {!op && !bio && <p className="small"><button className="secondary tiny" onClick={() => setOp("set-bio")}>Enable biometrics</button></p>}
      {op && (
        <div className="card">
          <p><strong>Enable biometrics</strong> · your device will ask for your fingerprint or face twice</p>
          <p className="small muted">First unlock your wallet the current way:</p>
          {err && <p className="error">{err}</p>}
          <UnlockAction wallet={w} label="Confirm" allowPin={!bio} onRefuse={close} onError={setErr}
            onAuth={async (auth) => {
              // Vérification du déverrouillage AVANT de créer une passkey (sinon passkey orpheline si le PIN est faux).
              const extra = { bio: await (async () => { await api(`/api/wallets/${w.id}/unlock`, { op: "check", auth }).catch((e) => { if (!/unknown operation/.test(e.message)) throw e; }); return bioEnroll(w.label); })() };
              await api(`/api/wallets/${w.id}/unlock`, { op, auth, ...extra });
              close(); onChanged();
            }} />
        </div>
      )}
    </div>
  );
}
