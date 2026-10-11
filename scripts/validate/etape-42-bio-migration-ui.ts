// Étape 42 : ancien wallet protégé par PIN seulement. Pendant une demande de signature, le Client Wallet doit offrir un moyen
// d'activer la biométrie (avant : un message renvoyait vers des réglages « ci-dessous » qui n'étaient pas affichés).
// Pile : le Client Wallet seul (:5199, stockage neuf avec un wallet PIN seul). Chrome headless.
// Limite : la création de la passkey (Touch ID) n'est pas exercée ; on vérifie le chemin d'écran jusqu'au bouton d'activation.
import { type ChildProcess, spawn } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { chromium } from "playwright-core";
import { accountKey, masterFromMnemonic, newMnemonic } from "@sq/bitcoin/keys";
import { seal } from "../../client-wallet/src/vault.ts";
import { makeReport } from "./lib.ts";

const WALLET = "http://localhost:5199";
const DATA = `${process.cwd()}/.local/e2e-42`;
const SHOTS = "docs/validation/captures";
rmSync(DATA, { recursive: true, force: true });
mkdirSync(DATA, { recursive: true });
mkdirSync(SHOTS, { recursive: true });
// Ancien wallet : phrase chiffrée par un PIN, aucune biométrie (le cas des wallets créés avant l'étape 36).
const m = newMnemonic();
const master = masterFromMnemonic(m, "regtest");
const w = { id: master.fingerprint.toString(16).padStart(8, "0"), label: "Ancien wallet (PIN)", sealed: seal(m, "482916"), accountKey: accountKey(master), createdAt: new Date().toISOString() };
writeFileSync(`${DATA}/wallets.json`, JSON.stringify([w]));
const proc: ChildProcess = spawn("npm", ["run", "-s", "dev", "-w", "client-wallet"], { env: { ...process.env, CLIENT_WALLET_PORT: "5199", CLIENT_WALLET_DATA: DATA, VITE_WALLET_ALLOWED_ORIGINS: WALLET }, stdio: "ignore", detached: true });
for (let i = 0; i < 150; i++) { try { if ((await fetch(`${WALLET}/api/wallets`)).ok) break; } catch {} await new Promise((r) => setTimeout(r, 200)); }
const { report, summary } = makeReport();
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: true });
const errors: string[] = [];

try {
  const p = await (await browser.newContext({ viewport: { width: 900, height: 1000 } })).newPage();
  p.on("pageerror", (e) => errors.push(e.message));
  await p.goto(WALLET);
  // Demande de preuve de propriété, comme celle que le site enverrait (même origine autorisée pour le test).
  await p.evaluate((accountKey) => window.postMessage({ type: "wallet-request", id: "t1", action: "prove", network: "regtest", payload: { accountKey, change: 0, index: 0, message: "test" } }, "*"), w.accountKey);
  await p.getByText("Biometrics must be enabled before this wallet can be used.").waitFor({ timeout: 20000 });
  const listBefore = await p.getByRole("heading", { name: "My wallets" }).count();
  const hint = (await p.locator("main").textContent()) ?? "";
  await p.screenshot({ path: `${SHOTS}/etape-42-1-biometrie-requise.png` });
  report("42-1", "Wallet à PIN seul : la demande affiche « biométrie requise » et un bouton « Open wallet settings » (plus de renvoi vers « ci-dessous » invisible)",
    listBefore === 0 && hint.includes("Open wallet settings") && !hint.includes("below"), `réglages visibles avant clic : ${listBefore} ; bouton : ${hint.includes("Open wallet settings")}`);

  await p.getByRole("button", { name: "Open wallet settings" }).click();
  await p.getByRole("heading", { name: "My wallets" }).waitFor({ timeout: 10000 });
  const enable = p.getByTestId(`unlock-${w.id}`).getByRole("button", { name: "Enable biometrics" });
  await enable.waitFor({ timeout: 10000 });
  await p.screenshot({ path: `${SHOTS}/etape-42-2-reglages-activer-biometrie.png` });
  await enable.click();
  const pinField = await p.getByLabel("Wallet PIN").count();
  report("42-2", "Le bouton ouvre les réglages ; « Enable biometrics » apparaît pour ce wallet et demande l'ancien PIN pour migrer", pinField === 1 && errors.length === 0, `champ PIN : ${pinField} ; erreurs JS : ${errors.length}`);
} catch (e: any) {
  report("42-x", "Exécution", false, e.stack ?? e.message);
} finally {
  await browser.close();
  try { process.kill(-proc.pid!, "SIGTERM"); } catch {}
}
process.exit(summary() ? 0 : 1);
