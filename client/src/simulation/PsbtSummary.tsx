// Simulation avant signature : décodage en clair du PSBT, côté client, sans appel à Swissquote.
import type { PsbtSummary as Summary } from "@sq/bitcoin";
import { btcFmt } from "../lib/format";

// labels : étiquettes connues pour des adresses hors de ce compte (ex. le nouveau compte d'une recovery).
export function PsbtSummary({ summary, delay, labels = {} }: { summary: Summary; delay: number; labels?: Record<string, string> }) {
  const total = summary.inputs.reduce((s, i) => s + i.value, 0n);
  const external = summary.outputs.filter((o) => !o.own);
  return (
    <div className="summary">
      <p>
        <strong>Chemin utilisé :</strong>{" "}
        {summary.path === "client"
          ? "clé du client seule (aucun délai)"
          : `recovery Swissquote + tiers (nSequence = ${delay} : valide seulement si les coins n'ont pas bougé depuis ${delay} blocs)`}
      </p>
      <p>
        <strong>Dépense :</strong> {summary.inputs.length} coin(s), {btcFmt(total)}
      </p>
      <table>
        <thead>
          <tr><th>Sortie</th><th>Montant</th><th>Destination</th></tr>
        </thead>
        <tbody>
          {summary.outputs.map((o, i) => (
            <tr key={i} className={o.own ? "own" : "external"}>
              <td>{o.own ? (o.own.change ? "change (ce compte)" : "ce compte") : labels[o.address] ?? "externe"}</td>
              <td>{btcFmt(o.value)}</td>
              <td className="mono">{o.address}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p>
        <strong>Frais :</strong> {btcFmt(summary.fee)}
        {summary.vsize ? ` (${summary.vsize} vB)` : ""}
      </p>
      {external.length === 0 && <p className="note">Envoi à soi-même : remet à zéro le délai de recovery des coins dépensés.</p>}
      <p>
        <strong>Signatures présentes :</strong> {summary.inputs.map((i) => i.signatures).join(", ")}
      </p>
    </div>
  );
}
