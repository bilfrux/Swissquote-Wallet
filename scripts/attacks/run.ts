// npm run test:attacks : exécute les attaques et l'invariant 1 contre bitcoind regtest, écrit les preuves.
import { writeFileSync } from "node:fs";
import { ATTACKS, type AttackResult } from "./attacks.ts";

const results: AttackResult[] = [];
for (const [id, run] of Object.entries(ATTACKS)) {
  const r = await run();
  results.push(r);
  console.log(`\n[${r.ok ? "OK " : "KO "}] ${id} — ${r.title}\n      attendu : ${r.expected} ; observé : ${r.outcome}\n      message de la chaîne : ${r.chainMessage}`);
  for (const s of r.steps) console.log(`      · ${s}`);
}
writeFileSync("docs/validation/etape-4-attaques.json", JSON.stringify({ date: new Date().toISOString(), results }, null, 2) + "\n");
console.log(`\n${results.filter((r) => r.ok).length}/${results.length} conformes ; preuves : docs/validation/etape-4-attaques.json`);
process.exit(results.every((r) => r.ok) ? 0 : 1);
