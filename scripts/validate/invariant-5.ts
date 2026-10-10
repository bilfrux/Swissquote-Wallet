// Invariant 5 : aucune clé privée du client dans l'appli, aucune clé de guardian dans client/ ni dans son bundle.
// Recherche (1) toutes les graines de test présentes sur la machine et leurs clés privées de compte dérivées,
// (2) des motifs génériques de clés privées, (3) les imports qui permettraient à l'appli de manipuler une clé privée.
// Les secrets recherchés ne sont jamais affichés : ils passent par un fichier temporaire hors du dépôt.
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { accountPrivateKey, masterFromMnemonic } from "@sq/bitcoin/keys";

const TARGETS = ["client/src", "client/dist", "client/index.html", "client/vite.config.ts"];
const results: [string, boolean, string][] = [];
const report = (label: string, ok: boolean, detail: string) => { results.push([label, ok, detail]); console.log(`[${ok ? "OK " : "KO "}] ${label}\n       ${detail}`); };
const grep = (args: string[]) => { try { return execFileSync("grep", args, { encoding: "utf8" }).trim(); } catch { return ""; } };

execFileSync("npm", ["run", "-s", "build", "-w", "client"], { stdio: "ignore" });

// (1) Graines présentes sur la machine (fichiers ignorés par git)
const seedFiles: string[] = [];
const walk = (d: string) => { if (!existsSync(d)) return; for (const f of readdirSync(d)) { const p = join(d, f); statSync(p).isDirectory() ? walk(p) : p.endsWith(".json") && seedFiles.push(p); } };
walk(".local"); walk("bank-mock/data");
const secrets: string[] = [];
for (const f of seedFiles) {
  const m = JSON.parse(readFileSync(f, "utf8")).mnemonic as string | undefined;
  if (!m) continue;
  secrets.push(m, accountPrivateKey(masterFromMnemonic(m, "regtest")).split("]")[1]);
}
const dir = mkdtempSync(join(tmpdir(), "inv5-"));
writeFileSync(join(dir, "secrets.txt"), secrets.join("\n") + "\n", { mode: 0o600 });
const found = grep(["-rlF", "-f", join(dir, "secrets.txt"), ...TARGETS]);
// Témoin positif : la même recherche sur les dossiers qui CONTIENNENT les graines doit les trouver.
const control = grep(["-rlF", "-f", join(dir, "secrets.txt"), ".local", "bank-mock/data"]).split("\n").filter(Boolean);
rmSync(dir, { recursive: true });
report("Témoin : la même recherche retrouve bien les graines là où elles sont stockées", control.length >= seedFiles.length,
  `grep -rlF -f <…> .local bank-mock/data -> ${control.length} fichier(s) trouvé(s) sur ${seedFiles.length}`);
report(`Aucune des ${secrets.length / 2} graines de test de la machine (ni sa clé privée de compte) dans client/`, !found,
  `grep -rlF -f <graines et tprv de ${seedFiles.length} fichiers de .local/ et bank-mock/data/> ${TARGETS.join(" ")} -> ${found || "rien"}`);

// (2) Motifs génériques
const ext = grep(["-rlE", "[tx]prv[1-9A-HJ-NP-Za-km-z]{100,}", ...TARGETS]);
const wif = grep(["-rlE", "\\b[c9KL5][1-9A-HJ-NP-Za-km-z]{50,51}\\b", "client/src"]);
const words = grep(["-rl", "\"abandon\",\"ability\"", "client/dist"]);
report("Aucune clé privée étendue (xprv/tprv), aucune clé WIF dans les sources, pas de liste BIP39 dans le bundle", !ext && !wif && !words,
  `grep -rlE '[tx]prv…' -> ${ext || "rien"} ; grep -rlE '<WIF>' client/src -> ${wif || "rien"} ; grep -rl '"abandon","ability"' client/dist -> ${words || "rien"}`);

// (3) L'appli n'importe rien qui manipule une clé privée
const imp = grep(["-rnE", "@sq/bitcoin/(sign|keys)|mnemonicToSeed|fromMasterSeed|privateExtendedKey|signBIP32|signers\\.|localStorage\\.setItem\\([^)]*(mnemonic|prv|seed)", "client/src"]);
report("client/src n'importe ni signature, ni graine, ni dérivation de clé privée", !imp, `grep -rnE '@sq/bitcoin/(sign|keys)|mnemonicToSeed|fromMasterSeed|privateExtendedKey|signBIP32|signers\\.' client/src -> ${imp || "rien"}`);

// Information (non bloquante) : code de signature de bibliothèque embarqué mais jamais appelé
const libSign = grep(["-rohE", "signBIP32|signECPair", "client/dist/assets"]).split("\n").filter(Boolean);
console.log(`\ninfo : noms de fonctions de signature de bibliothèque présents dans le bundle (code non appelé, aucune clé) : ${[...new Set(libSign)].join(", ") || "aucun"}`);
process.exit(results.every(([, ok]) => ok) ? 0 : 1);
