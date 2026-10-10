// Validation des interfaces de l'étape 2 dans Chrome headless (regtest) :
// - console guardian (tiers) : clé publique, signature d'une recovery, refus d'une dépense courante, phrase jamais conservée ;
// - appli cliente : « Obtenir la clé de Swissquote » et enregistrement auprès de bank-mock.
// Prérequis : regtest:up ; bank-mock sur 4000 ; client (5173) et console (5174) lancés avec VITE_BTC_NETWORK=regtest.
import { mkdirSync, readFileSync } from "node:fs";
import { chromium } from "playwright-core";
import { BitcoindBackend, buildSpend, createWalletConfig, outputAt, pubkeyAt, scan } from "@sq/bitcoin";
import { accountKey, masterFromMnemonic, newMnemonic } from "@sq/bitcoin/keys";
import { btc } from "@bitcoinerlab/descriptors-scure";
import { base64, hex } from "@scure/base";

const CHROME = process.env.CHROME_PATH ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const rpc = new BitcoindBackend(process.env.BTC_RPC_URL ?? "http://regtest:regtest@127.0.0.1:18443");
const SHOTS = "docs/validation/captures";
mkdirSync(SHOTS, { recursive: true });
const results: [string, boolean][] = [];
const report = (label: string, ok: boolean, detail: string) => {
  results.push([label, ok]);
  console.log(`[${ok ? "OK " : "KO "}] ${label}\n       ${detail}`);
};

// Compte de test : clé Swissquote réelle de bank-mock, tiers et client de test
const sqKey = (await (await fetch("http://localhost:4000/guardian/key?network=regtest")).json()).accountKey as string;
const tiersPhrase = newMnemonic();
const tiersKey = accountKey(masterFromMnemonic(tiersPhrase, "regtest"));
const cfg = await createWalletConfig({ network: "regtest", delay: 6, client: accountKey(masterFromMnemonic(newMnemonic(), "regtest")), swissquote: sqKey, tiers: tiersKey });
const miner: string = await rpc.call("getnewaddress", [], "miner");
await rpc.call("sendtoaddress", [outputAt(cfg, 0, 0).getAddress(), 0.05], "miner");
await rpc.call("generatetoaddress", [1, miner]);
const utxos = await scan(cfg, rpc);
const recovery = (await buildSpend({ cfg, backend: rpc, utxos, path: "recovery", feeRate: 2, to: outputAt(cfg, 0, 7).getAddress() })).psbt;
const clientSpend = (await buildSpend({ cfg, backend: rpc, utxos, path: "client", feeRate: 2, to: miner })).psbt;

const browser = await chromium.launch({ executablePath: CHROME, headless: true });
const page = await browser.newPage({ viewport: { width: 1100, height: 1300 } });
const errors: string[] = [];
page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
page.on("pageerror", (e) => errors.push(e.message));
try {
  // --- Console guardian ---
  await page.goto(process.env.CONSOLE_URL ?? "http://localhost:5174");
  const phrase = page.getByPlaceholder("mot1 mot2 … mot24");
  await phrase.fill(tiersPhrase);
  await page.getByRole("button", { name: /Afficher ma clé publique/ }).click();
  const shown = (await page.locator(".address").textContent())?.trim();
  report("Console : la clé publique affichée correspond à la phrase du tiers ; champ phrase vidé", shown === tiersKey && (await phrase.inputValue()) === "",
    `affichée = ${shown?.slice(0, 40)}… ; champ après usage = "${await phrase.inputValue()}"`);

  await page.getByPlaceholder(/PSBT reçu du client/).fill(clientSpend);
  const refusal = await page.locator(".summary").textContent();
  const disabled = await page.getByRole("button", { name: "Signer en tant que tiers" }).isDisabled();
  report("Console : une dépense courante du client est signalée et ne peut pas être signée", !!refusal?.includes("PAS une recovery") && disabled,
    `${refusal?.match(/Type :[^.]*\./)?.[0]} ; bouton désactivé = ${disabled}`);

  await page.getByPlaceholder(/PSBT reçu du client/).fill(recovery);
  const summary = await page.locator(".summary").textContent();
  await phrase.fill(tiersPhrase);
  await page.getByRole("button", { name: "Signer en tant que tiers" }).click();
  const signed = await page.locator(".step textarea[readonly]").inputValue();
  const keys = (btc.Transaction.fromPSBT(base64.decode(signed)).getInput(0).partialSig ?? []).map(([k]: any) => hex.encode(k));
  report("Console : recovery décodée (délai, destination) puis signée avec la clé du tiers",
    !!summary?.includes("recovery (valable seulement si les coins n'ont pas bougé depuis 6 blocs)") && keys.length === 1 && keys[0] === hex.encode(pubkeyAt(cfg.tiers, "regtest", 0, 0)),
    `${summary?.match(/Type :[^)]*\)/)?.[0]} ; signature de la clé du tiers : ${keys[0] === hex.encode(pubkeyAt(cfg.tiers, "regtest", 0, 0))}`);
  await page.screenshot({ path: `${SHOTS}/etape-2-console-guardian.png`, fullPage: true });

  const words = tiersPhrase.split(" ");
  const leak = await page.evaluate((w) => {
    const html = document.documentElement.outerHTML;
    const fields = [...document.querySelectorAll("textarea, input")].map((e) => (e as HTMLTextAreaElement).value).join(" ");
    return { storage: localStorage.length + sessionStorage.length, inHtml: html.includes(w.join(" ")), inFields: fields.includes(w.slice(0, 3).join(" ")) };
  }, words);
  report("Console : phrase du tiers absente de localStorage, sessionStorage, du DOM et des champs après signature",
    leak.storage === 0 && !leak.inHtml && !leak.inFields, JSON.stringify(leak));

  // --- Appli cliente : clé Swissquote obtenue de bank-mock, enregistrement ---
  await page.goto(process.env.APP_URL ?? "http://localhost:5173");
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.getByRole("button", { name: "Obtenir la clé de Swissquote" }).click();
  await page.waitForFunction((k) => [...document.querySelectorAll("textarea")].some((t) => (t as HTMLTextAreaElement).value === k), sqKey);
  const areas = page.locator("section textarea");
  await areas.nth(0).fill(accountKey(masterFromMnemonic(newMnemonic(), "regtest")));
  await areas.nth(2).fill(tiersKey);
  await page.getByRole("button", { name: "Créer le compte" }).click();
  const notice = await page.getByText(/Compte (créé|enregistré)/).textContent({ timeout: 10000 });
  report("Appli : clé Swissquote obtenue de bank-mock, compte créé puis enregistré auprès du guardian", !!notice?.includes("Compte enregistré auprès du guardian Swissquote"), notice ?? "");
  await page.screenshot({ path: `${SHOTS}/etape-2-appli-enregistree.png`, fullPage: true });
} finally {
  await browser.close();
}
report("Aucune erreur dans la console des navigateurs", errors.length === 0, errors.join(" | ") || "aucune");
process.exit(results.some(([, ok]) => !ok) ? 1 : 0);
