// ================================================================================================
//  SIGNATAIRE EXTERNE DE DÉMO : représente le wallet du client (Sparrow, Liana, Ledger, Bitcoin Core…).
//  Il ne fait PAS partie de l'appli Swissquote. Il importe la phrase à l'exécution, affiche ce qu'il
//  signe, signe le PSBT et ne stocke rien.
// ================================================================================================
//  npm run client-signer -- --psbt <base64 | fichier> [--mnemonic-file f] [--network signet] [--out f] [--yes]
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import { btc } from "@bitcoinerlab/descriptors-scure";
import { base64 } from "@scure/base";
import { type NetworkName, btcNetwork } from "@sq/bitcoin";
import { signPsbtWithMnemonic } from "@sq/bitcoin/sign";

const arg = (name: string) => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] : undefined; };
// npm run -w exécute depuis tools/client-signer : les chemins sont relatifs au répertoire d'appel.
const path = (p: string) => resolve(process.env.INIT_CWD ?? process.cwd(), p);
const network = (arg("network") ?? "signet") as NetworkName;
const psbtArg = arg("psbt");
if (!psbtArg) throw new Error("--psbt requis (base64 ou chemin de fichier)");
const psbt = existsSync(path(psbtArg)) ? readFileSync(path(psbtArg), "utf8").trim() : psbtArg;

// Ce qu'un vrai wallet affiche avant de signer : entrées, sorties, frais, nSequence.
const tx = btc.Transaction.fromPSBT(base64.decode(psbt));
let totalIn = 0n, totalOut = 0n;
console.error("[client-signer : wallet externe simulé] transaction à signer :");
for (let i = 0; i < tx.inputsLength; i++) {
  const inp = tx.getInput(i);
  totalIn += inp.witnessUtxo!.amount;
  console.error(`  entrée ${i} : ${inp.witnessUtxo!.amount} sats, nSequence=${inp.sequence}`);
}
for (let i = 0; i < tx.outputsLength; i++) {
  const o = tx.getOutput(i);
  totalOut += o.amount!;
  console.error(`  sortie ${i} : ${o.amount} sats -> ${btc.Address(btcNetwork(network)).encode(btc.OutScript.decode(o.script!))}`);
}
console.error(`  frais : ${totalIn - totalOut} sats`);

const rl = createInterface({ input: process.stdin, output: process.stderr });
if (!process.argv.includes("--yes")) {
  const ok = await rl.question("Signer ? (oui/non) ");
  if (ok.trim().toLowerCase() !== "oui") { console.error("annulé"); process.exit(1); }
}
const mf = arg("mnemonic-file");
let mnemonic: string;
if (mf) {
  const raw = readFileSync(path(mf), "utf8");
  mnemonic = raw.trim().startsWith("{") ? JSON.parse(raw).mnemonic : raw;
} else {
  mnemonic = await rl.question("Phrase BIP39 (non stockée) : ");
}
rl.close();

const { psbt: signed, added } = signPsbtWithMnemonic(psbt, mnemonic, network);
mnemonic = "";
if (added === 0) { console.error("aucune entrée ne correspond à cette graine : rien signé"); process.exit(2); }
console.error(`${added} signature(s) ajoutée(s)`);
const out = arg("out");
if (out) writeFileSync(path(out), signed + "\n");
else console.log(signed);
