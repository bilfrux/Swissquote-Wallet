// Validation de l'interface de recovery (étape 3) dans Chrome headless, en regtest, avec TROIS profils de navigateur :
// l'ancien appareil du client, son nouvel appareil (clé perdue) et le tiers (console guardian).
// Prérequis : regtest:up ; bank-mock (4000) ; appli (APP_URL, défaut :5173) et console (CONSOLE_URL, défaut :5174) en regtest.
import { mkdirSync } from "node:fs";
import { chromium, type Page } from "playwright-core";
import { accountKey, masterFromMnemonic, newMnemonic } from "@sq/bitcoin/keys";
import { makeReport, miner } from "./lib.ts";

const APP = process.env.APP_URL ?? "http://localhost:5173";
const CONSOLE = process.env.CONSOLE_URL ?? "http://localhost:5174";
const CHROME = process.env.CHROME_PATH ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const SHOTS = "docs/validation/captures";
mkdirSync(SHOTS, { recursive: true });
const D = 6;
const { report, summary } = makeReport();
const { mine, pay } = await miner();
const key = (m: string) => accountKey(masterFromMnemonic(m, "regtest"));
const tiersPhrase = newMnemonic();
const oldClient = key(newMnemonic());
const newClient = key(newMnemonic());

const browser = await chromium.launch({ executablePath: CHROME, headless: true });
const errors: string[] = [];
const profile = async () => {
  const ctx = await browser.newContext({ viewport: { width: 1100, height: 1500 } });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => m.type() === "error" && !m.text().includes("400 (Bad Request)") && errors.push(m.text()));
  return page;
};
const shot = (p: Page, name: string) => p.screenshot({ path: `${SHOTS}/etape-3-${name}.png`, fullPage: true });

try {
  // --- Ancien appareil : création du compte, réception ---
  const oldDevice = await profile();
  await oldDevice.goto(APP);
  await oldDevice.getByRole("button", { name: "Obtenir la clé de Swissquote" }).click();
  await oldDevice.waitForFunction(() => [...document.querySelectorAll("textarea")].some((t) => (t as HTMLTextAreaElement).value.includes("tpub")));
  const areas = oldDevice.locator("section textarea");
  await areas.nth(0).fill(oldClient);
  await areas.nth(2).fill(key(tiersPhrase));
  await oldDevice.getByRole("button", { name: "Créer le compte" }).click();
  await oldDevice.getByText("Compte enregistré auprès du guardian Swissquote.").waitFor();
  const address = (await oldDevice.locator(".address").textContent())!.trim();
  await pay(address, 0.3);
  await mine(1);
  await mine(3); // 4 confirmations : recovery possible dans 2 blocs
  await oldDevice.reload();
  const warning = await oldDevice.locator(".warning").textContent({ timeout: 15000 });
  report("UI-1", "Ancien appareil : avertissement « bientôt dépensable par Swissquote + tiers » quand le délai approche", !!warning?.includes("bientôt dépensable"), warning ?? "");
  await shot(oldDevice, "1-avertissement");

  // --- Nouvel appareil (clé perdue) : re-KYC, choix du compte, nouvelle clé, signature Swissquote ---
  const newDevice = await profile();
  await newDevice.goto(APP);
  await newDevice.getByRole("button", { name: /récupérer mon compte/ }).click();
  const kyc = newDevice.locator(".step").first().locator("input");
  await kyc.nth(0).fill("Muster");
  await kyc.nth(1).fill("1990-01-01");
  await kyc.nth(2).fill("123456");
  await newDevice.getByRole("button", { name: "Vérifier mon identité" }).click();
  await newDevice.locator("p", { hasText: oldClient.slice(0, 22) }).getByRole("button", { name: "Choisir" }).click();
  const coins = await newDevice.getByText(/coin\(s\),/).textContent({ timeout: 15000 });
  await newDevice.getByPlaceholder("[empreinte/48'/1'/0'/2']tpub…").fill(newClient);
  await newDevice.getByRole("button", { name: "Créer le nouveau compte" }).click();
  await newDevice.getByRole("button", { name: "Préparer la demande" }).click();
  await newDevice.getByRole("button", { name: "Demander la signature de Swissquote" }).click();
  const sqPsbt = await newDevice.locator(".step textarea[readonly]").inputValue({ timeout: 15000 });
  report("UI-2", "Nouvel appareil : re-KYC, ancien compte retrouvé, nouvelle clé enregistrée, demande signée par Swissquote",
    sqPsbt.startsWith("cHNidP8") && !!coins?.includes("0.30000000 BTC"), `${coins?.trim()} ; PSBT signé par Swissquote reçu (${sqPsbt.length} car.)`);
  await shot(newDevice, "2-demande-swissquote");

  // --- Tiers : console guardian, profil séparé ---
  const tiers = await profile();
  await tiers.goto(CONSOLE);
  await tiers.getByPlaceholder(/PSBT reçu du client/).fill(sqPsbt);
  await tiers.getByPlaceholder("mot1 mot2 … mot24").fill(tiersPhrase);
  await tiers.getByRole("button", { name: "Signer en tant que tiers" }).click();
  const tiersPsbt = await tiers.locator(".step textarea[readonly]").inputValue();
  report("UI-3", "Tiers : signe la demande dans sa console (profil séparé)", tiersPsbt.startsWith("cHNidP8"), `${(await tiers.locator(".success").textContent())?.trim()}`);

  // --- Nouvel appareil : signature du tiers, diffusion refusée avant D, acceptée à D ---
  await newDevice.getByPlaceholder("PSBT signé par le tiers (cHNidP8…)").fill(tiersPsbt);
  await newDevice.getByRole("button", { name: "Ajouter la signature du tiers" }).click();
  await newDevice.getByRole("button", { name: "Diffuser la recovery" }).click();
  const refused = await newDevice.locator(".step .error").last().textContent({ timeout: 15000 });
  await shot(newDevice, "3-refus-avant-D");
  report("UI-4", "Diffusion avant D : l'appli affiche le refus réel du réseau Bitcoin", !!refused?.includes("non-BIP68-final"), refused ?? "");

  await mine(D - 4); // le coin atteint D confirmations
  await newDevice.getByRole("button", { name: "Diffuser la recovery" }).click();
  const done = await newDevice.locator(".success", { hasText: "Recovery diffusée" }).textContent({ timeout: 15000 });
  await mine(1);
  await newDevice.getByRole("button", { name: "Ouvrir mon nouveau compte" }).click();
  await newDevice.getByText(/Solde : 0\.29/).waitFor({ timeout: 15000 });
  const balance = await newDevice.locator("p", { hasText: "Solde :" }).textContent();
  await shot(newDevice, "4-nouveau-compte");
  report("UI-5", "À D : recovery diffusée ; le nouvel appareil ouvre le nouveau compte avec les fonds", !!done && !!balance?.includes("0.29"), `${done?.trim()} ; ${balance?.match(/Solde : [\d.]+ BTC/)?.[0]}`);

  // --- Ancien appareil : le compte est vide ---
  await oldDevice.reload();
  await oldDevice.getByText("Aucun coin.").waitFor({ timeout: 15000 });
  report("UI-6", "Ancien appareil : l'ancien compte est vide", true, "« Aucun coin. »");
} finally {
  await browser.close();
}
report("UI-7", "Aucune erreur dans la console des navigateurs (hors refus attendu du nœud)", errors.length === 0, errors.join(" | ") || "aucune");
process.exit(summary() ? 0 : 1);
