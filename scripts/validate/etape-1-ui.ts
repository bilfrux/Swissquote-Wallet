// Validation de l'interface (étape 1) dans un vrai navigateur (Chrome headless), en regtest.
// Prérequis : npm run regtest:up ; VITE_BTC_NETWORK=regtest npm run dev ; graines de test dans .local/regtest-ui/.
// Parcours : création du compte avec 3 clés publiques -> adresse -> réception -> PSBT -> signature EXTERNE
// (tools/client-signer) -> collage du PSBT signé -> finalisation et diffusion par l'appli.
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { chromium } from "playwright-core";
import { BitcoindBackend } from "@sq/bitcoin";

const URL_APP = process.env.APP_URL ?? "http://localhost:5173";
const CHROME = process.env.CHROME_PATH ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const rpc = new BitcoindBackend(process.env.BTC_RPC_URL ?? "http://regtest:regtest@127.0.0.1:18443");
const KEYS = ".local/regtest-ui";
const SHOTS = "docs/validation/captures";
mkdirSync(SHOTS, { recursive: true });
// Graines de TEST neuves à chaque passage (compte vierge), comme des wallets externes fraîchement créés.
for (const n of ["client", "swissquote", "tiers"])
  execFileSync("npm", ["run", "-s", "keygen", "--", "--network", "regtest", "--out", `${KEYS}/${n}.json`], { stdio: "ignore" });
const key = (n: string) => JSON.parse(readFileSync(`${KEYS}/${n}.json`, "utf8")).accountKey as string;

const results: [string, boolean, string][] = [];
const report = (label: string, ok: boolean, detail: string) => {
  results.push([label, ok, detail]);
  console.log(`[${ok ? "OK " : "KO "}] ${label}\n       ${detail}`);
};

const browser = await chromium.launch({ executablePath: CHROME, headless: true });
const page = await browser.newPage({ viewport: { width: 1100, height: 1400 } });
const consoleErrors: string[] = [];
page.on("console", (m) => m.type() === "error" && consoleErrors.push(m.text()));
page.on("pageerror", (e) => consoleErrors.push(e.message));

try {
  await page.goto(URL_APP);
  await page.evaluate(() => localStorage.clear());
  await page.reload();

  // 1. Création du compte à partir des clés publiques
  const areas = page.locator("section textarea");
  await areas.nth(0).fill(key("client"));
  await areas.nth(1).fill(key("swissquote"));
  await areas.nth(2).fill(key("tiers"));
  await page.screenshot({ path: `${SHOTS}/etape-1-1-creation.png`, fullPage: true });
  await page.getByRole("button", { name: "Créer le compte" }).click();
  const address = (await page.locator(".address").textContent({ timeout: 15000 }))!.trim();
  report("Compte créé à partir des 3 clés publiques, adresse affichée", address.startsWith("bcrt1q"), `adresse affichée : ${address}`);

  // 2. Réception
  const minerWallets: string[] = await rpc.call("listwallets");
  if (!minerWallets.includes("miner")) await rpc.call("loadwallet", ["miner"]).catch(() => rpc.call("createwallet", ["miner"]));
  const miner: string = await rpc.call("getnewaddress", [], "miner");
  await rpc.call("sendtoaddress", [address, 0.4], "miner");
  await rpc.call("generatetoaddress", [1, miner]);
  await page.getByRole("button", { name: "Actualiser" }).click();
  await page.getByText("Solde : 0.40000000 BTC").waitFor({ timeout: 15000 });
  const balance = await page.locator("section").first().textContent();
  report("Réception visible : solde et coin avec délai de recovery", !!balance?.includes("0.40000000 BTC"),
    `${balance?.match(/Solde : [^A]*BTC/)?.[0]} ; ligne : ${(await page.locator("table tbody tr").first().textContent())?.trim()}`);
  await page.screenshot({ path: `${SHOTS}/etape-1-2-compte.png`, fullPage: true });

  // 3. Préparation du PSBT et simulation
  const dest: string = await rpc.call("getnewaddress", [], "miner");
  await page.getByPlaceholder("tb1…").fill(dest);
  await page.getByPlaceholder("0.0001").fill("0.1");
  await page.getByRole("button", { name: "Préparer la transaction" }).click();
  const psbtBox = page.locator(".step textarea[readonly]");
  await psbtBox.waitFor({ timeout: 15000 });
  const psbt = await psbtBox.inputValue();
  const summary = (await page.locator(".summary").first().textContent()) ?? "";
  report("PSBT préparé et simulé en clair avant signature", psbt.startsWith("cHNidP8") && summary.includes("clé du client seule") && summary.includes(dest),
    summary.replace(/\s+/g, " ").slice(0, 300));
  await page.screenshot({ path: `${SHOTS}/etape-1-3-psbt.png`, fullPage: true });

  // 4. Signature externe (hors de l'appli), puis collage
  writeFileSync(`${KEYS}/ui-unsigned.psbt`, psbt);
  execFileSync("npm", ["run", "-s", "client-signer", "--", "--psbt", `${KEYS}/ui-unsigned.psbt`, "--mnemonic-file", `${KEYS}/client.json`, "--network", "regtest", "--yes", "--out", `${KEYS}/ui-signed.psbt`], { stdio: "ignore" });
  await page.getByPlaceholder("cHNidP8…").fill(readFileSync(`${KEYS}/ui-signed.psbt`, "utf8").trim());
  await page.getByRole("button", { name: "Vérifier" }).click();
  await page.getByRole("button", { name: "Diffuser" }).click();
  const ok = await page.locator(".success, .error").last().textContent({ timeout: 15000 });
  const txid = ok?.match(/[0-9a-f]{64}/)?.[0];
  await rpc.call("generatetoaddress", [1, miner]);
  const tx = txid ? await rpc.call("getrawtransaction", [txid, true]) : null;
  report("PSBT signé à l'extérieur, finalisé et diffusé par l'appli, confirmé", !!tx && tx.confirmations === 1, `${ok?.trim()} ; confirmations=${tx?.confirmations}`);
  await page.screenshot({ path: `${SHOTS}/etape-1-4-diffusion.png`, fullPage: true });

  // 5. Le stockage du navigateur ne contient que des clés publiques
  const storage = await page.evaluate(() => JSON.stringify(localStorage));
  report("localStorage : uniquement des clés publiques (aucun tprv, aucune phrase)", !/[tx]prv/.test(storage) && !storage.includes("mnemonic"), `clés stockées : ${Object.keys(JSON.parse(storage)).join(", ")}`);
} finally {
  await browser.close();
}
report("Aucune erreur dans la console du navigateur", consoleErrors.length === 0, consoleErrors.join(" | ") || "aucune");
if (results.some(([, ok]) => !ok)) process.exit(1);
