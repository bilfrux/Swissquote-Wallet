// Sécurité du compte bancaire : passkey pour la confirmation des montants élevés.
import { useEffect, useState } from "react";
import { passkeyStatus, registerPasskey } from "../lib/bank";
import { useT } from "../i18n";

export function AccountSecurity() {
  const { tr } = useT();
  const [count, setCount] = useState<number | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  useEffect(() => { passkeyStatus().then((s) => setCount(s.count), () => setCount(null)); }, []);
  return (
    <div className="acct-sec">
      <p className="small"><strong>Passkey</strong> : {count === null ? "…" : count > 0 ? `${tr("enabled")} (${count})` : tr("not enabled")}</p>
      <p className="muted small">{tr("Passkey used only to confirm high-value transfers.")}</p>
      {count === 0 && <button className="btn-secondary" onClick={async () => { setMsg(null); try { const r = await registerPasskey(); setCount(r.count); setMsg(tr("Passkey enabled.")); } catch (e: any) { setMsg(e.message); } }}>
        {tr("Enable a passkey")}
      </button>}
      {msg && <p className="small">{msg}</p>}
    </div>
  );
}
