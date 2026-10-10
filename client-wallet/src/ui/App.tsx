// Interface du Wallet du client. Ouverte par l'appli Swissquote (fenêtre séparée, postMessage) pour :
//  - créer un wallet (phrase affichée une fois, seule la clé publique est renvoyée) ;
//  - enregistrer la politique du compte (données publiques) ;
//  - signer un envoi APRÈS confirmation explicite du client.
// Ouverte seule, elle liste les wallets et permet de simuler la perte de l'appareil.
import { useEffect, useRef, useState } from "react";

const ALLOWED = (import.meta.env.VITE_WALLET_ALLOWED_ORIGINS ?? "http://localhost:5173").split(",");
type Req = { id: string; action: "create" | "sign" | "policy" | "prove" | "evm-address" | "evm-sign"; network: "regtest" | "signet"; payload: any; origin: string; source: Window };
type WalletView = { id: string; label: string; accountKey: string; createdAt: string; protected: boolean; evmAddress?: string; policy?: { delay: number; tiersName?: string; network: string } };

// Saisie du code PIN (6 à 12 chiffres). Le PIN n'est envoyé qu'au serveur du wallet (même origine).
function PinInput({ value, onChange, label = "Wallet PIN" }: { value: string; onChange: (v: string) => void; label?: string }) {
  return (
    <label className="pin">
      <span>{label}</span>
      <input type="password" inputMode="numeric" autoComplete="off" maxLength={12} value={value} onChange={(e) => onChange(e.target.value.replace(/\D/g, ""))} />
    </label>
  );
}
const pinOk = (p: string) => /^\d{6,12}$/.test(p);
type Description = {
  wallet: WalletView | null; path: "client" | "recovery" | "mixte"; delay: number | null;
  inputs: { value: string }[]; outputs: { address: string; value: string; mine: string | null }[]; fee: string;
  sent: string; high: boolean; highValueSats: string; confirmTarget: string | null;
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
  const reply = (ok: boolean, data: unknown) => {
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
          <svg width="34" height="34" viewBox="0 0 34 34" aria-hidden="true"><rect width="34" height="34" rx="10" fill="#1f2633" /><circle cx="13" cy="15" r="5" fill="none" stroke="#fff" strokeWidth="2.2" /><path d="M17 17.5h9v3.5M22.5 17.5v3" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" fill="none" /></svg>
          <div><div className="brand-name">Client Wallet</div><div className="tag">Independent of Swissquote · your keys stay on this device</div></div>
        </div>
        <div className="ref">Reference implementation · in production: hardware wallet or phone app</div>
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
      {(!req || done) && <Wallets />}
    </main>
  );
}

function Create({ req, onDone, onError }: { req: Req; onDone: (d: unknown) => void; onError: (e: string) => void }) {
  const [created, setCreated] = useState<{ wallet: WalletView; mnemonic: string } | null>(null);
  const [noted, setNoted] = useState(false);
  const [pin, setPin] = useState("");
  const [pin2, setPin2] = useState("");
  const words = useRef<string[]>([]);
  if (!created)
    return (
      <section>
        <h2>Create your Bitcoin wallet</h2>
        <p>The app <strong>{req.origin}</strong> is asking to create a wallet. Your secret phrase will be generated here, on this device. Swissquote will only receive your public key.</p>
        <p className="small">Choose a PIN: it encrypts your phrase on this device and will be requested for every signature.</p>
        <PinInput value={pin} onChange={setPin} label="New PIN (6 to 12 digits)" />
        <PinInput value={pin2} onChange={setPin2} label="Confirm the PIN" />
        {pin2 && pin !== pin2 && <p className="error">The two codes do not match.</p>}
        <button disabled={!pinOk(pin) || pin !== pin2} onClick={async () => { try { const c = await api("/api/wallets", { network: req.network, label: req.payload?.label, pin }); setPin(""); setPin2(""); words.current = c.mnemonic.split(" "); setCreated(c); } catch (e: any) { onError(e.message); } }}>
          Generate my secret phrase
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
  const [pin, setPin] = useState("");
  const [confirmDest, setConfirmDest] = useState("");
  useEffect(() => { api("/api/describe", { psbt: req.payload.psbt, network: req.network }).then(setD, (e) => onError(e.message)); }, [req]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!d) return <section><p>Reading the transaction…</p></section>;
  const total = d.inputs.reduce((s, i) => s + BigInt(i.value), 0n);
  const ext = d.outputs.filter((o) => !o.mine);
  const sent = ext.reduce((s, o) => s + BigInt(o.value), 0n);
  return (
    <section>
      <h2>Confirm the transfer</h2>
      <p className="small muted">Request from <strong>{req.origin}</strong> · wallet “{d.wallet?.label ?? "unknown"}”</p>
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
      {d.wallet?.protected && <PinInput value={pin} onChange={setPin} />}
      <div className="row">
        <button className="secondary" onClick={onRefuse}>Refuse</button>
        <button disabled={d.path !== "client" || !d.wallet || (d.wallet.protected && !pinOk(pin)) || (d.high && confirmDest.length !== 6)} onClick={async () => { try { onDone(await api("/api/sign", { psbt: req.payload.psbt, network: req.network, pin, confirmDest })); } catch (e: any) { onError(e.message); } finally { setPin(""); } }}>
          Confirm and sign
        </button>
      </div>
    </section>
  );
}

function Prove({ req, onDone, onRefuse, onError }: { req: Req; onDone: (d: unknown) => void; onRefuse: () => void; onError: (e: string) => void }) {
  const p = req.payload;
  const [pin, setPin] = useState("");
  const [w, setW] = useState<WalletView | null>(null);
  useEffect(() => { api("/api/wallets").then((l: WalletView[]) => setW(l.find((x) => x.accountKey === p.accountKey) ?? null)); }, [p.accountKey]);
  return (
    <section>
      <h2>Prove ownership of an address</h2>
      <p>Request from <strong>{req.origin}</strong>. Your wallet will sign this message with your key (address #{p.index}{p.change ? ", change" : ""}). <strong>This signature moves no funds</strong> and cannot be used to spend.</p>
      <pre className="card mono message">{p.message}</pre>
      {w?.protected && <PinInput value={pin} onChange={setPin} />}
      <div className="row">
        <button className="secondary" onClick={onRefuse}>Refuse</button>
        <button disabled={!!w?.protected && !pinOk(pin)} onClick={async () => { try { onDone(await api("/api/prove", { accountKey: p.accountKey, change: p.change, index: p.index, message: p.message, network: req.network, pin })); } catch (e: any) { onError(e.message); } finally { setPin(""); } }}>
          Sign the proof
        </button>
      </div>
    </section>
  );
}

function Wallets() {
  const [list, setList] = useState<WalletView[] | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [protecting, setProtecting] = useState<string | null>(null);
  const [newPin, setNewPin] = useState("");
  const refresh = () => api("/api/wallets").then(setList, (e) => setErr(e.message));
  useEffect(() => { refresh(); }, []);
  if (!list) return null;
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
          {w.protected ? <p className="small ok">Phrase encrypted by PIN</p> : (
            protecting === w.id ? (
              <div>
                <PinInput value={newPin} onChange={setNewPin} label="New PIN (6 to 12 digits)" />
                <button disabled={!pinOk(newPin)} onClick={async () => { try { await api(`/api/wallets/${w.id}/protect`, { pin: newPin }); setNewPin(""); setProtecting(null); refresh(); } catch (e: any) { setErr(e.message); } }}>Encrypt my phrase</button>
              </div>
            ) : (
              <p className="small warnline">Not protected: phrase stored in clear. <button className="secondary" onClick={() => setProtecting(w.id)}>Protect with a PIN</button></p>
            )
          )}
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
  const [pin, setPin] = useState("");
  useEffect(() => { api("/api/wallets").then((l: WalletView[]) => setW(l.find((x) => x.accountKey === req.payload.accountKey) ?? null)); }, [req]);
  if (w === undefined) return <section><p>Loading…</p></section>;
  if (!w) return <section><p className="error">No wallet on this device matches your Bitcoin account.</p><button className="secondary" onClick={onRefuse}>Close</button></section>;
  return (
    <section>
      <h2>Add an Ethereum account</h2>
      <p>Request from <strong>{req.origin}</strong>. Your Ethereum key is derived from the same secret phrase, on this device. Swissquote will only receive its <strong>address</strong>.</p>
      {w.evmAddress ? <p className="mono card">{w.evmAddress}</p> : <p className="small">Your PIN is needed once to compute the address.</p>}
      {!w.evmAddress && w.protected && <PinInput value={pin} onChange={setPin} />}
      <div className="row">
        <button className="secondary" onClick={onRefuse}>Refuse</button>
        <button disabled={!w.evmAddress && w.protected && !pinOk(pin)} onClick={async () => { try { onDone(await api(`/api/wallets/${w.id}/evm`, { pin })); } catch (e: any) { onError(e.message); } finally { setPin(""); } }}>
          Send my Ethereum address
        </button>
      </div>
    </section>
  );
}

type EvmDescription = { wallet: WalletView; owner: string; safe: string; deploys: boolean; sponsored: boolean; paymaster: string | null; calls: { kind: string; text: string; risk?: string }[] };
// Confirmation d'une opération Ethereum : décodée par le wallet lui-même ; tout appel non reconnu bloque la signature.
function EvmSign({ req, onDone, onRefuse, onError }: { req: Req; onDone: (d: unknown) => void; onRefuse: () => void; onError: (e: string) => void }) {
  const [d, setD] = useState<EvmDescription | null>(null);
  const [pin, setPin] = useState("");
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
      {d.wallet.protected && <PinInput value={pin} onChange={setPin} />}
      <div className="row">
        <button className="secondary" onClick={onRefuse}>Refuse</button>
        <button disabled={blocked || (d.wallet.protected && !pinOk(pin))} onClick={async () => { try { onDone(await api("/api/evm/sign", { op: req.payload.op, pin })); } catch (e: any) { onError(e.message); } finally { setPin(""); } }}>
          Confirm and sign
        </button>
      </div>
    </section>
  );
}
