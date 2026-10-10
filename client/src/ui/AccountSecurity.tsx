// Sécurité du compte bancaire : passkey (biométrie / verrouillage de l'appareil) pour la connexion et les montants élevés.
import { useEffect, useState } from "react";
import { passkeyStatus, registerPasskey } from "../lib/bank";

export function AccountSecurity() {
  const [count, setCount] = useState<number | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  useEffect(() => { passkeyStatus().then((s) => setCount(s.count), () => setCount(null)); }, []);
  return (
    <div className="acct-sec">
      <p className="small"><strong>Passkey</strong> : {count === null ? "…" : count > 0 ? `enabled (${count})` : "not enabled"}</p>
      <p className="muted small">Passwordless login, and confirmation of high-value transfers.</p>
      <button className="btn-secondary" onClick={async () => { setMsg(null); try { const r = await registerPasskey(); setCount(r.count); setMsg("Passkey enabled."); } catch (e: any) { setMsg(e.message); } }}>
        {count ? "Add a passkey" : "Enable a passkey"}
      </button>
      {msg && <p className="small">{msg}</p>}
    </div>
  );
}
