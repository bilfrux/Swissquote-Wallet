// Panneau « Attaques » (démo regtest) : chaque bouton exécute un vrai scénario contre bitcoind, via le serveur
// d'attaques (processus séparé, graines de démo jetables). L'appli n'affiche que le verdict et le message de la chaîne.
import { useState } from "react";

const URL_ATTACKS = import.meta.env.VITE_ATTACKS_URL ?? "http://localhost:4200";
type Result = { id: string; title: string; expected: string; outcome: string; ok: boolean; chainMessage: string; steps: string[] };

const BUTTONS = [
  { id: "attaque-1", label: "Voler le téléphone et l'email", hint: "L'attaquant n'a ni votre clé ni celles des guardians." },
  { id: "attaque-2", label: "Collusion Swissquote + tiers avant le délai", hint: "Les deux guardians signent ensemble, trop tôt." },
  { id: "attaque-3", label: "Swissquote disparaît", hint: "Le serveur Swissquote est arrêté ; le client dépense seul." },
];

export function AttackPanel() {
  const [results, setResults] = useState<Record<string, Result | { error: string }>>({});
  const [running, setRunning] = useState<string | null>(null);
  const run = async (id: string) => {
    setRunning(id);
    try {
      const r = await fetch(`${URL_ATTACKS}/attacks/${id}`, { method: "POST" });
      const j = await r.json();
      setResults((p) => ({ ...p, [id]: r.ok ? j : { error: j.error } }));
    } catch (e: any) {
      setResults((p) => ({ ...p, [id]: { error: `serveur d'attaques injoignable (npm run attacks:server) : ${e.message}` } }));
    } finally {
      setRunning(null);
    }
  };
  return (
    <section>
      <h2>Attaques (démo regtest)</h2>
      <p className="note">Chaque bouton exécute un vrai scénario contre un nœud Bitcoin, sur un compte de démonstration.</p>
      {BUTTONS.map((b) => {
        const r = results[b.id];
        return (
          <div key={b.id} className="step attack">
            <button disabled={running !== null} onClick={() => run(b.id)}>{running === b.id ? "En cours…" : b.label}</button>{" "}
            <span className="note">{b.hint}</span>
            {r && "error" in r && <p className="error">{r.error}</p>}
            {r && "outcome" in r && (
              <div className={r.ok ? "success" : "error"}>
                <p className="verdict">
                  {r.outcome === "refus" ? "⛔ Refusé" : "✅ Réussi"} — attendu : {r.expected}
                  {r.ok ? " (conforme)" : " (NON conforme)"}
                </p>
                <p>Message réel de la chaîne : <span className="mono">{r.chainMessage}</span></p>
                <ul>{r.steps.map((s, i) => <li key={i}>{s}</li>)}</ul>
              </div>
            )}
          </div>
        );
      })}
    </section>
  );
}
