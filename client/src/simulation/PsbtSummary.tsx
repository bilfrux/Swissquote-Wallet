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
        <strong>Spending path:</strong>{" "}
        {summary.path === "client"
          ? "client key alone (no delay)"
          : `recovery Swissquote + trusted contact (nSequence = ${delay}: valid only if the coins have not moved for ${delay} blocks)`}
      </p>
      <p>
        <strong>Spending:</strong> {summary.inputs.length} coin(s), {btcFmt(total)}
      </p>
      <table>
        <thead>
          <tr><th>Output</th><th>Amount</th><th>Destination</th></tr>
        </thead>
        <tbody>
          {summary.outputs.map((o, i) => (
            <tr key={i} className={o.own ? "own" : "external"}>
              <td>{o.own ? (o.own.change ? "change (this account)" : "this account") : labels[o.address] ?? "external"}</td>
              <td>{btcFmt(o.value)}</td>
              <td className="mono">{o.address}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p>
        <strong>Fee:</strong> {btcFmt(summary.fee)}
        {summary.vsize ? ` (${summary.vsize} vB)` : ""}
      </p>
      {external.length === 0 && <p className="note">Self-transfer: resets the recovery delay of the spent coins.</p>}
      <p>
        <strong>Signatures present:</strong> {summary.inputs.map((i) => i.signatures).join(", ")}
      </p>
    </div>
  );
}
