// Interface du Wallet du client. Ouverte par l'appli Swissquote (fenêtre séparée, postMessage) pour :
//  - créer un wallet (phrase affichée une fois, seule la clé publique est renvoyée) ;
//  - enregistrer la politique du compte (données publiques) ;
//  - signer un envoi APRÈS confirmation explicite du client.
// Ouverte seule, elle liste les wallets et permet de simuler la perte de l'appareil.
import { useEffect, useRef, useState } from "react";

const ALLOWED = (import.meta.env.VITE_WALLET_ALLOWED_ORIGINS ?? "http://localhost:5173").split(",");
type Req = { id: string; action: "create" | "sign" | "policy" | "prove"; network: "regtest" | "signet"; payload: any; origin: string; source: Window };
type WalletView = { id: string; label: string; accountKey: string; createdAt: string; protected: boolean; policy?: { delay: number; tiersName?: string; network: string } };

// Saisie du code PIN (6 à 12 chiffres). Le PIN n'est envoyé qu'au serveur du wallet (même origine).
function PinInput({ value, onChange, label = "Code PIN du wallet" }: { value: string; onChange: (v: string) => void; label?: string }) {
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
          <div><div className="brand-name">Wallet du client</div><div className="tag">Indépendant de Swissquote · vos clés restent sur cet appareil</div></div>
        </div>
        <div className="ref">Implémentation de référence · en production : wallet matériel ou appli téléphone</div>
      </header>
      {error && <p className="error">{error}</p>}
      {done && <p className="done">{done}</p>}
      {req?.action === "create" && !done && <Create req={req} onDone={(d) => { reply(true, d); setDone("Clé publique transmise à Swissquote. Vous pouvez fermer cette fenêtre."); }} onError={setError} />}
      {req?.action === "policy" && !done && <PolicyReq req={req} onDone={(d) => { reply(true, d); setDone("Politique du compte enregistrée dans votre wallet."); }} onError={setError} />}
      {req?.action === "sign" && !done && (
        <Sign
          req={req}
          onDone={(d) => { reply(true, d); setDone("Transaction signée et renvoyée à l'appli. Vous pouvez fermer cette fenêtre."); }}
          onRefuse={() => { reply(false, "refusé par le client"); setDone("Signature refusée."); }}
          onError={setError}
        />
      )}
      {req?.action === "prove" && !done && (
        <Prove
          req={req}
          onDone={(d) => { reply(true, d); setDone("Preuve signée et renvoyée à l'appli. Aucun fonds n'a été déplacé."); }}
          onRefuse={() => { reply(false, "refusé par le client"); setDone("Preuve refusée."); }}
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
        <h2>Créer votre wallet Bitcoin</h2>
        <p>L'appli <strong>{req.origin}</strong> demande la création d'un wallet. Votre phrase secrète sera générée ici, sur cet appareil. Swissquote ne recevra que votre clé publique.</p>
        <p className="small">Choisissez un code PIN : il chiffre votre phrase sur cet appareil et vous sera demandé à chaque signature.</p>
        <PinInput value={pin} onChange={setPin} label="Nouveau code PIN (6 à 12 chiffres)" />
        <PinInput value={pin2} onChange={setPin2} label="Confirmer le code PIN" />
        {pin2 && pin !== pin2 && <p className="error">Les deux codes ne correspondent pas.</p>}
        <button disabled={!pinOk(pin) || pin !== pin2} onClick={async () => { try { const c = await api("/api/wallets", { network: req.network, label: req.payload?.label, pin }); setPin(""); setPin2(""); words.current = c.mnemonic.split(" "); setCreated(c); } catch (e: any) { onError(e.message); } }}>
          Générer ma phrase secrète
        </button>
      </section>
    );
  return (
    <section>
      <h2>Notez votre phrase secrète</h2>
      <p className="warn">Elle ne sera plus jamais affichée. Quiconque la connaît contrôle vos bitcoins. Ne la photographiez pas, ne la transmettez à personne, pas même à Swissquote.</p>
      <ol className="words">{words.current.map((w, i) => <li key={i}>{w}</li>)}</ol>
      <label className="check"><input type="checkbox" checked={noted} onChange={(e) => setNoted(e.target.checked)} /> J'ai noté ma phrase en lieu sûr</label>
      <button disabled={!noted} onClick={() => { words.current = []; setCreated({ ...created, mnemonic: "" }); onDone({ accountKey: created.wallet.accountKey, walletId: created.wallet.id }); }}>
        Transmettre ma clé publique à Swissquote
      </button>
    </section>
  );
}

function PolicyReq({ req, onDone, onError }: { req: Req; onDone: (d: unknown) => void; onError: (e: string) => void }) {
  useEffect(() => {
    api(`/api/wallets/${req.payload.walletId}/policy`, { policy: req.payload.policy }).then(onDone, (e) => onError(e.message));
  }, [req]); // eslint-disable-line react-hooks/exhaustive-deps
  return <section><p>Enregistrement de la politique du compte…</p></section>;
}

function Sign({ req, onDone, onRefuse, onError }: { req: Req; onDone: (d: unknown) => void; onRefuse: () => void; onError: (e: string) => void }) {
  const [d, setD] = useState<Description | null>(null);
  const [pin, setPin] = useState("");
  const [confirmDest, setConfirmDest] = useState("");
  useEffect(() => { api("/api/describe", { psbt: req.payload.psbt, network: req.network }).then(setD, (e) => onError(e.message)); }, [req]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!d) return <section><p>Lecture de la transaction…</p></section>;
  const total = d.inputs.reduce((s, i) => s + BigInt(i.value), 0n);
  const ext = d.outputs.filter((o) => !o.mine);
  const sent = ext.reduce((s, o) => s + BigInt(o.value), 0n);
  return (
    <section>
      <h2>Confirmer l'envoi</h2>
      <p className="small muted">Demande de <strong>{req.origin}</strong> · wallet « {d.wallet?.label ?? "inconnu"} »</p>
      <div className="hero">
        <p className="hero-label">{ext.length ? "Vous envoyez" : "Envoi à vous-même"}</p>
        <p className="hero-amount">{btc(ext.length ? sent : total - BigInt(d.fee))}</p>
        {ext.length > 0 && <p className="hero-to">à <span className="mono">{ext[0].address}</span></p>}
        <p className="hero-fee">+ frais {btc(d.fee)}</p>
      </div>
      <div className="card">
        <p><span className="k">Chemin de dépense</span>{" "}
          {d.path === "client" ? "votre clé seule (dépense normale, sans délai)" : d.path === "recovery" ? `recovery Swissquote + tiers (délai ${d.delay} blocs) : votre wallet ne signe pas ce chemin` : "mixte (refusé)"}
        </p>
        <p><span className="k">Coins dépensés</span> {d.inputs.length} · {btc(total)}</p>
        <table>
          <tbody>
            {d.outputs.map((o, i) => (
              <tr key={i} className={o.mine ? "mine" : "ext"}>
                <td>{o.mine ?? "vers"}</td><td className="amt">{btc(o.value)}</td><td className="mono">{o.address}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p><span className="k">Frais</span> {btc(d.fee)}</p>
      </div>
      <p className="hint">Vérifiez l'adresse du destinataire par un autre moyen que l'appli qui vous l'a proposée.</p>
      {d.high && (
        <div className="high">
          <p><strong>Montant élevé</strong> (seuil : {btc(d.highValueSats)}). Pour confirmer, saisissez les <strong>6 derniers caractères</strong> de l'adresse du destinataire.</p>
          <label className="pin"><span>6 derniers caractères de l'adresse</span>
            <input value={confirmDest} maxLength={6} autoComplete="off" onChange={(e) => setConfirmDest(e.target.value.trim())} />
          </label>
        </div>
      )}
      {d.wallet?.protected && <PinInput value={pin} onChange={setPin} />}
      <div className="row">
        <button className="secondary" onClick={onRefuse}>Refuser</button>
        <button disabled={d.path !== "client" || !d.wallet || (d.wallet.protected && !pinOk(pin)) || (d.high && confirmDest.length !== 6)} onClick={async () => { try { onDone(await api("/api/sign", { psbt: req.payload.psbt, network: req.network, pin, confirmDest })); } catch (e: any) { onError(e.message); } finally { setPin(""); } }}>
          Confirmer et signer
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
      <h2>Prouver la propriété d'une adresse</h2>
      <p>Demande de <strong>{req.origin}</strong>. Votre wallet va signer ce message avec votre clé (adresse n°{p.index}{p.change ? ", change" : ""}). <strong>Cette signature ne déplace aucun fonds</strong> et ne peut pas servir à dépenser.</p>
      <pre className="card mono message">{p.message}</pre>
      {w?.protected && <PinInput value={pin} onChange={setPin} />}
      <div className="row">
        <button className="secondary" onClick={onRefuse}>Refuser</button>
        <button disabled={!!w?.protected && !pinOk(pin)} onClick={async () => { try { onDone(await api("/api/prove", { accountKey: p.accountKey, change: p.change, index: p.index, message: p.message, network: req.network, pin })); } catch (e: any) { onError(e.message); } finally { setPin(""); } }}>
          Signer la preuve
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
      <h2>Mes wallets</h2>
      {err && <p className="error">{err}</p>}
      {list.length === 0 && <p>Aucun wallet sur cet appareil.</p>}
      {list.map((w) => (
        <div key={w.id} className="card">
          <p><strong>{w.label}</strong> · empreinte {w.id} · créé le {w.createdAt.slice(0, 16).replace("T", " ")}</p>
          <p className="mono small">{w.accountKey}</p>
          {w.policy && <p className="small">Politique : vous seul, ou Swissquote + {w.policy.tiersName ?? "tiers"} après {w.policy.delay} blocs d'inactivité ({w.policy.network})</p>}
          {w.protected ? <p className="small ok">Phrase chiffrée par code PIN</p> : (
            protecting === w.id ? (
              <div>
                <PinInput value={newPin} onChange={setNewPin} label="Nouveau code PIN (6 à 12 chiffres)" />
                <button disabled={!pinOk(newPin)} onClick={async () => { try { await api(`/api/wallets/${w.id}/protect`, { pin: newPin }); setNewPin(""); setProtecting(null); refresh(); } catch (e: any) { setErr(e.message); } }}>Chiffrer ma phrase</button>
              </div>
            ) : (
              <p className="small warnline">Non protégé : phrase stockée en clair. <button className="secondary" onClick={() => setProtecting(w.id)}>Protéger par un code PIN</button></p>
            )
          )}
          {confirming === w.id ? (
            <div className="row">
              <button className="secondary" onClick={() => setConfirming(null)}>Annuler</button>
              <button className="danger" onClick={async () => { try { await api(`/api/wallets/${w.id}`, undefined, "DELETE"); setConfirming(null); refresh(); } catch (e: any) { setErr(e.message); } }}>Effacer définitivement</button>
            </div>
          ) : (
            <button className="secondary" onClick={() => setConfirming(w.id)}>Simuler la perte de cet appareil</button>
          )}
        </div>
      ))}
    </section>
  );
}
