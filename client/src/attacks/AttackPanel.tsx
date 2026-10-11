// Panneau « Attaques » (démo regtest) : chaque bouton exécute un vrai scénario contre bitcoind, via le serveur
// d'attaques (processus séparé, graines de démo jetables). L'appli n'affiche que le verdict et le message de la chaîne.
import { useState } from "react";
import { useT } from "../i18n";

const URL_ATTACKS = import.meta.env.VITE_ATTACKS_URL ?? "http://localhost:4200";
type Result = { id: string; title: string; expected: string; outcome: string; ok: boolean; chainMessage: string; steps: string[] };

const BUTTONS = [
  { id: "attaque-1", label: "Steal the phone and email", hint: "The attacker has neither your key nor the guardians' keys." },
  { id: "attaque-2", label: "Swissquote + trusted contact collude before the delay", hint: "Both guardians sign together, too early." },
  { id: "attaque-3", label: "Swissquote disappears", hint: "The Swissquote server is stopped; the client spends alone." },
];

export function AttackPanel() {
  const { tr } = useT();
  const [results, setResults] = useState<Record<string, Result | { error: string }>>({});
  const [running, setRunning] = useState<string | null>(null);
  const run = async (id: string) => {
    setRunning(id);
    try {
      const r = await fetch(`${URL_ATTACKS}/attacks/${id}`, { method: "POST" });
      const j = await r.json();
      setResults((p) => ({ ...p, [id]: r.ok ? j : { error: j.error } }));
    } catch (e: any) {
      setResults((p) => ({ ...p, [id]: { error: `attack server unreachable (npm run attacks:server): ${e.message}` } }));
    } finally {
      setRunning(null);
    }
  };
  return (
    <section>
      <h2>{tr("Attacks (regtest demo)")}</h2>
      <p className="note">{tr("Each button runs a real scenario against a Bitcoin node, on a demo account.")}</p>
      {BUTTONS.map((b) => {
        const r = results[b.id];
        return (
          <div key={b.id} className="step attack">
            <button disabled={running !== null} onClick={() => run(b.id)}>{running === b.id ? tr("Running…") : tr(b.label)}</button>{" "}
            <span className="note">{tr(b.hint)}</span>
            {r && "error" in r && <p className="error">{r.error}</p>}
            {r && "outcome" in r && (
              <div className={r.ok ? "success" : "error"}>
                <p className="verdict">
                  {r.outcome === "rejected" ? `⛔ ${tr("Rejected")}` : `✅ ${tr("Succeeded")}`} — {tr("expected:")} {r.expected}
                  {r.ok ? ` ${tr("(as expected)")}` : ` ${tr("(NOT as expected)")}`}
                </p>
                <p>{tr("Actual message from the chain:")} <span className="mono">{r.chainMessage}</span></p>
                <ul>{r.steps.map((s, i) => <li key={i}>{s}</li>)}</ul>
              </div>
            )}
          </div>
        );
      })}
    </section>
  );
}
