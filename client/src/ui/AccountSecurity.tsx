// Sécurité du compte bancaire : passkey (biométrie / verrouillage de l'appareil) pour la connexion et les montants élevés.
import { useEffect, useState } from "react";
import { passkeyStatus, registerPasskey } from "../lib/bank";

export function AccountSecurity() {
  const [count, setCount] = useState<number | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  useEffect(() => { passkeyStatus().then((s) => setCount(s.count), () => setCount(null)); }, []);
  return (
    <div className="acct-sec">
      <p className="small"><strong>Passkey</strong> : {count === null ? "…" : count > 0 ? `activée (${count})` : "non activée"}</p>
      <p className="muted small">Connexion sans mot de passe, et confirmation des envois de montant élevé.</p>
      <button className="btn-secondary" onClick={async () => { setMsg(null); try { const r = await registerPasskey(); setCount(r.count); setMsg("Passkey activée."); } catch (e: any) { setMsg(e.message); } }}>
        {count ? "Ajouter une passkey" : "Activer une passkey"}
      </button>
      {msg && <p className="small">{msg}</p>}
    </div>
  );
}
