// Simulation avant signature : décodage en clair du PSBT, côté client, sans appel à Swissquote.
import type { PsbtSummary as Summary } from "@sq/bitcoin";
import { btcFmt } from "../lib/format";
import { useT } from "../i18n";

// labels : étiquettes connues pour des adresses hors de ce compte (ex. le nouveau compte d'une recovery).
export function PsbtSummary({ summary, delay, labels = {} }: { summary: Summary; delay: number; labels?: Record<string, string> }) {
  const { tr } = useT();
  const total = summary.inputs.reduce((s, i) => s + i.value, 0n);
  const external = summary.outputs.filter((o) => !o.own);
  return (
    <div className="summary">
      <p>
        <strong>{tr("Spending path:")}</strong>{" "}
        {summary.path === "client"
          ? tr("client key alone (no delay)")
          : tr("recovery Swissquote + trusted contact (nSequence = {d}: valid only if the coins have not moved for {d} blocks)", { d: delay })}
      </p>
      <p>
        <strong>{tr("Spending:")}</strong> {tr("{n} coin(s)", { n: summary.inputs.length })}, {btcFmt(total)}
      </p>
      <table>
        <thead>
          <tr><th>{tr("Output")}</th><th>{tr("Amount")}</th><th>{tr("Destination")}</th></tr>
        </thead>
        <tbody>
          {summary.outputs.map((o, i) => (
            <tr key={i} className={o.own ? "own" : "external"}>
              <td>{o.own ? (o.own.change ? tr("change (this account)") : tr("this account")) : labels[o.address] ?? tr("external")}</td>
              <td>{btcFmt(o.value)}</td>
              <td className="mono">{o.address}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p>
        <strong>{tr("Fee:")}</strong> {btcFmt(summary.fee)}
        {summary.vsize ? ` (${summary.vsize} vB)` : ""}
      </p>
      {external.length === 0 && <p className="note">{tr("Self-transfer: resets the recovery delay of the spent coins.")}</p>}
      <p>
        <strong>{tr("Signatures present:")}</strong> {summary.inputs.map((i) => i.signatures).join(", ")}
      </p>
    </div>
  );
}
