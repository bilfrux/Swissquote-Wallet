// OUTIL DE DÉMO : crée une graine BIP39 comme le ferait un wallet externe (Sparrow, Liana, wallet matériel)
// et affiche la clé publique de compte à donner à l'appli. N'écrit rien sur disque, sauf si --out est fourni
// (graines de TEST uniquement, dans un dossier ignoré par git).
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { accountKey, masterFromMnemonic, newMnemonic } from "@sq/bitcoin/keys";
import type { NetworkName } from "@sq/bitcoin";

const arg = (name: string) => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] : undefined; };
const network = (arg("network") ?? "signet") as NetworkName;
const mnemonic = newMnemonic();
const key = accountKey(masterFromMnemonic(mnemonic, network));
const out = arg("out");
if (out) {
  writeFileSync(resolve(process.env.INIT_CWD ?? process.cwd(), out), JSON.stringify({ network, mnemonic, accountKey: key }, null, 2) + "\n", { mode: 0o600 });
  console.log(`graine de TEST écrite dans ${out}`);
} else {
  console.log(`phrase (à noter hors ligne, ne sera plus affichée) :\n  ${mnemonic}`);
}
console.log(`clé publique de compte (${network}) :\n  ${key}`);
