// Invariant 5 : aucune clé privée du client dans l'appli, aucune clé de guardian dans client/ ni dans son bundle.
// Recherche (1) toutes les graines EN CLAIR présentes sur la machine (Swissquote, contacts et clients de test, anciens
// wallets non protégés) et leurs clés privées dérivées, Bitcoin (tprv de compte) ET Ethereum (clé hexadécimale) ;
// (2) des motifs génériques de clés privées ; (3) les imports qui permettraient à l'appli de manipuler une clé privée.
// Les graines du Client Wallet protégées (biométrie, ancien PIN) sont chiffrées sur le disque : elles ne peuvent pas être
// cherchées en clair, et ne peuvent pas atteindre l'appli en clair sans passer par le processus du wallet. Elles sont
// comptées, pas cherchées. Les secrets recherchés ne sont jamais affichés : ils passent par un fichier temporaire hors du dépôt.
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { accountPrivateKey, masterFromMnemonic } from "@sq/bitcoin/keys";
import { evmAccountFromMnemonic } from "@sq/evm/keys";

const TARGETS = ["client/src", "client/dist", "client/index.html", "client/vite.config.ts"];
const results: [string, boolean, string][] = [];
const report = (label: string, ok: boolean, detail: string) => { results.push([label, ok, detail]); console.log(`[${ok ? "OK " : "KO "}] ${label}\n       ${detail}`); };
const grep = (args: string[]) => { try { return execFileSync("grep", args, { encoding: "utf8" }).trim(); } catch { return ""; } };

execFileSync("npm", ["run", "-s", "build", "-w", "client"], { stdio: "ignore" });

// (1) Graines en clair présentes sur la machine (fichiers ignorés par git)
const files: string[] = [];
const walk = (d: string) => { if (!existsSync(d)) return; for (const f of readdirSync(d)) { const p = join(d, f); statSync(p).isDirectory() ? walk(p) : p.endsWith(".json") && files.push(p); } };
// INV5_SEED_DIRS (facultatif, séparés par « : ») : autres dossiers de données à inclure, par exemple ceux d'une autre copie
// du dépôt où tournent les démos.
const extra = (process.env.INV5_SEED_DIRS ?? "").split(":").filter(Boolean);
for (const d of [".local", "bank-mock/data", "client-wallet/data", ...extra]) walk(d);
const secrets: string[] = [];
let seeds = 0, encrypted = 0;
for (const f of files) {
  let j: any;
  try { j = JSON.parse(readFileSync(f, "utf8")); } catch { continue; }
  const items: any[] = Array.isArray(j) ? j : [j];
  for (const w of items) {
    if (w && typeof w === "object" && (w.bio || w.sealed) && !w.mnemonic) encrypted++;
    if (typeof w?.mnemonic !== "string") continue;
    let evm: string;
    try { evm = evmAccountFromMnemonic(w.mnemonic).privateKey; } catch { continue; } // pas une phrase BIP39
    seeds++;
    secrets.push(w.mnemonic, accountPrivateKey(masterFromMnemonic(w.mnemonic, "regtest")).split("]")[1], evm, evm.slice(2));
  }
}
const dir = mkdtempSync(join(tmpdir(), "inv5-"));
const list = join(dir, "secrets.txt");
writeFileSync(list, secrets.join("\n") + "\n", { mode: 0o600 });
const found = secrets.length ? grep(["-rlF", "-f", list, ...TARGETS]) : "";
// Témoins positifs : (a) la même recherche retrouve les graines là où elles sont stockées ; (b) une clé privée Ethereum
// (sans phrase autour) et un tprv glissés dans un fichier de test sont bien trouvés.
const control = secrets.length ? grep(["-rlF", "-f", list, ...[".local", "bank-mock/data", "client-wallet/data", ...extra].filter((d) => existsSync(d))]).split("\n").filter(Boolean) : [];
const withSeeds = files.filter((f) => /"mnemonic"/.test(readFileSync(f, "utf8"))).length;
const planted = join(dir, "planted");
let plantedFound = "";
if (secrets.length >= 4) {
  writeFileSync(planted + "-evm.ts", `export const k = "${secrets[2]}";\n`);
  writeFileSync(planted + "-tprv.js", `var x="${secrets[1]}";\n`);
  plantedFound = grep(["-lF", "-f", list, planted + "-evm.ts", planted + "-tprv.js"]);
}
rmSync(dir, { recursive: true });
report("Témoins : la recherche retrouve les graines là où elles sont stockées, et une clé Ethereum ou un tprv isolés glissés dans un fichier",
  seeds > 0 && control.length >= withSeeds && plantedFound.split("\n").filter(Boolean).length === 2,
  `${control.length} fichier(s) trouvé(s) sur ${withSeeds} contenant des graines ; fichiers témoins détectés : ${plantedFound.split("\n").filter(Boolean).length}/2`);
report(`Aucune des ${seeds} graines en clair de la machine, ni leurs clés privées Bitcoin (tprv) et Ethereum (hex), dans client/`, seeds > 0 && !found,
  `grep -rlF -f <${secrets.length} secrets de ${files.length} fichiers de .local/, bank-mock/data/, client-wallet/data/> ${TARGETS.join(" ")} -> ${found || "rien"} ; graines du Client Wallet chiffrées (non cherchables en clair) : ${encrypted}`);

// (2) Motifs génériques
const ext = grep(["-rlE", "[tx]prv[1-9A-HJ-NP-Za-km-z]{100,}", ...TARGETS]);
const wif = grep(["-rlE", "\\b[c9KL5][1-9A-HJ-NP-Za-km-z]{50,51}\\b", "client/src"]);
const hex = grep(["-rlE", "0x[0-9a-fA-F]{64}\\b", "client/src"]);
const words = grep(["-rl", "\"abandon\",\"ability\"", "client/dist"]);
report("Aucune clé privée étendue (xprv/tprv), aucune clé WIF ni valeur hexadécimale de 32 octets dans les sources, pas de liste BIP39 dans le bundle",
  !ext && !wif && !hex && !words,
  `grep '[tx]prv…' -> ${ext || "rien"} ; '<WIF>' client/src -> ${wif || "rien"} ; '0x<64 hex>' client/src -> ${hex || "rien"} ; '"abandon","ability"' client/dist -> ${words || "rien"}`);

// (3) L'appli n'importe rien qui manipule une clé privée (Bitcoin ou Ethereum)
const imp = grep(["-rnE", "@sq/bitcoin/(sign|keys)|@sq/evm/keys|viem/accounts|mnemonicToSeed|mnemonicToAccount|privateKeyToAccount|fromMasterSeed|privateExtendedKey|signBIP32|signers\\.|\\bsignOp\\(|localStorage\\.setItem\\([^)]*(mnemonic|prv|seed|privateKey)", "client/src"]);
report("client/src n'importe ni signature, ni graine, ni dérivation de clé privée (Bitcoin et Ethereum)", !imp,
  `grep -rnE '@sq/bitcoin/(sign|keys)|@sq/evm/keys|viem/accounts|mnemonicToAccount|privateKeyToAccount|signOp(…' client/src -> ${imp || "rien"}`);

// Information (non bloquante) : code de signature de bibliothèque embarqué mais jamais appelé
const libSign = grep(["-rohE", "signBIP32|signECPair", "client/dist/assets"]).split("\n").filter(Boolean);
console.log(`\ninfo : noms de fonctions de signature de bibliothèque présents dans le bundle (code non appelé, aucune clé) : ${[...new Set(libSign)].join(", ") || "aucun"}`);
process.exit(results.every(([, ok]) => ok) ? 0 : 1);
