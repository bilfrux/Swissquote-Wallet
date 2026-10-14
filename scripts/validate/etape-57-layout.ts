// Étape 57 : un changement de largeur de fenêtre (passage du seuil de 820 px, rotation d'une tablette) ne doit pas effacer
// un formulaire en cours. Observé à l'étape 47 : le changement de contact perdait sa saisie (composant remonté).
// Pile isolée : bank-mock :4460 (verrou désactivé), Client Wallet :5230, appli :5231. Prérequis : npm run regtest:up
import { type ChildProcess, spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { rmSync } from "node:fs";
import { chromium } from "playwright-core";
import { createWalletConfig, outputAt } from "@sq/bitcoin";
import { accountKey, masterFromMnemonic, newMnemonic } from "@sq/bitcoin/keys";
import { makeReport, miner } from "./lib.ts";

const BANK = "http://localhost:4460", WALLET = "http://localhost:5230", APP = "http://localhost:5231";
const DATA = `${process.cwd()}/.local/e2e-57`;
rmSync(DATA, { recursive: true, force: true });
const procs: ChildProcess[] = [];
const start = (cmd: string[], env: Record<string, string>, cwd = ".") => procs.push(spawn(cmd[0], cmd.slice(1), { cwd, env: { ...process.env, ...env }, stdio: "ignore", detached: true }));
start(["npm", "run", "-s", "dev", "-w", "bank-mock"], { BANK_MOCK_PORT: "4460", BANK_MOCK_DATA: `${DATA}/bank`, BANK_MOCK_ORIGINS: APP, BANK_MOCK_CRYPTO_LOCK: "off", ALERT_INTERVAL_MS: "0", ALERT_SIGNET_INTERVAL_MS: "0" });
start(["npm", "run", "-s", "dev", "-w", "client-wallet"], { CLIENT_WALLET_PORT: "5230", CLIENT_WALLET_DATA: `${DATA}/wallet`, VITE_WALLET_ALLOWED_ORIGINS: APP });
start(["npx", "vite", "--port", "5231", "--strictPort"], { VITE_BTC_NETWORK: "regtest", VITE_BANK_MOCK_URL: BANK, VITE_CLIENT_WALLET_URL: WALLET }, "client");
for (const u of [`${BANK}/health`, `${WALLET}/api/wallets`, APP]) for (let i = 0; i < 150; i++) { try { if ((await fetch(u)).ok) break; } catch {} await new Promise((r) => setTimeout(r, 200)); }
const json = async (url: string, body?: unknown, token?: string) => (await fetch(url, { method: body === undefined ? "GET" : "POST", headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) })).json() as Promise<any>;
const { report, summary } = makeReport();
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: true });

try {
  // Compte Bitcoin financé (wallet créé par l'API, secret biométrique simulé comme aux étapes 37 et 43).
  const bio = { credentialId: randomBytes(32).toString("base64url"), prfSalt: randomBytes(32).toString("base64url"), prf: randomBytes(32).toString("base64url") };
  const w = (await json(`${WALLET}/api/wallets`, { network: "regtest", label: "étape 57", bio })).wallet;
  const sq = (await json(`${BANK}/guardian/key?network=regtest&client=${encodeURIComponent(w.accountKey)}`)).accountKey;
  const t1 = accountKey(masterFromMnemonic(newMnemonic(), "regtest")), t2 = accountKey(masterFromMnemonic(newMnemonic(), "regtest"));
  await json(`${WALLET}/api/wallets/${w.id}/policy`, { policy: { network: "regtest", delay: 6, swissquote: sq, tiers: t1, tiersName: "Marie Dupont" }, prf: bio.prf });
  const reg = await json(`${BANK}/accounts/register`, { customerId: "CH-0003", network: "regtest", delay: 6, client: w.accountKey, tiers: t1, tiersName: "Marie Dupont" });
  const cfg = await createWalletConfig({ network: "regtest", delay: 6, client: w.accountKey, swissquote: sq, tiers: t1 });
  const m = await miner();
  await m.pay(outputAt(cfg, 0, 0).getAddress(), 0.01);
  await m.mine(1);

  const ctx = await browser.newContext({ viewport: { width: 1280, height: 1100 } });
  const p = await ctx.newPage();
  const errors: string[] = [];
  p.on("pageerror", (e) => errors.push(e.message));
  await p.goto(APP);
  await p.evaluate(([k, v]) => { localStorage.clear(); sessionStorage.clear(); localStorage.setItem(k as string, JSON.stringify(v)); },
    ["sq-wallet:btc:regtest:CH-0003", { id: reg.accountId, client: w.accountKey, swissquote: sq, tiers: t1, tiersName: "Marie Dupont", delay: 6, walletId: w.id }] as const);
  await p.reload();
  await p.getByRole("button", { name: "Login", exact: true }).click();
  await p.getByLabel("Username").fill("CH-0003");
  await p.getByLabel("Password", { exact: true }).fill("demo0003");
  await p.getByRole("button", { name: "Log in", exact: true }).click();
  await p.getByRole("button", { name: "Log out" }).first().waitFor({ timeout: 20000 });
  await p.locator(".d-topnav").getByRole("button", { name: "Crypto", exact: true }).click();
  await p.getByTestId("wallet-page").waitFor({ timeout: 30000 });
  await p.locator("#crypto-top button", { hasText: /^Security$/ }).click();
  await p.getByRole("button", { name: "Change my trusted contact" }).click();
  await p.getByLabel("New contact's name").fill("Bob");
  await p.getByLabel("New contact's public key").fill(t2);

  // Passage en largeur téléphone puis retour : la saisie doit rester.
  const kept = async () => ({
    form: await p.getByTestId("contact-change-form").count(),
    name: await p.getByLabel("New contact's name").inputValue().catch(() => ""),
    key: await p.getByLabel("New contact's public key").inputValue().catch(() => ""),
  });
  await p.setViewportSize({ width: 390, height: 900 });
  await p.waitForTimeout(600);
  const narrow = await kept();
  await p.setViewportSize({ width: 1280, height: 1100 });
  await p.waitForTimeout(600);
  const wide = await kept();
  report("57-1", "Changement de contact en cours : la saisie survit au passage en largeur téléphone (390 px) puis au retour (1280 px)",
    narrow.form === 1 && narrow.name === "Bob" && narrow.key === t2 && wide.form === 1 && wide.name === "Bob" && wide.key === t2,
    `390 px : formulaire ${narrow.form}, nom « ${narrow.name} », clé ${narrow.key ? "conservée" : "perdue"} ; 1280 px : formulaire ${wide.form}, nom « ${wide.name} », clé ${wide.key ? "conservée" : "perdue"}`);

  // Préparation (transaction calculée) puis passage en largeur téléphone : la préparation reste aussi.
  await p.getByRole("button", { name: "Prepare the change" }).click();
  await p.getByRole("button", { name: "Sign with my Client Wallet" }).waitFor({ timeout: 30000 });
  await p.setViewportSize({ width: 390, height: 900 });
  await p.waitForTimeout(600);
  const prepared = await p.getByRole("button", { name: "Sign with my Client Wallet" }).count();
  await p.screenshot({ path: "docs/validation/captures/etape-57-1-telephone-preparation.png", fullPage: true });
  report("57-2", "Changement préparé puis fenêtre réduite : la préparation est conservée, avec la mise en page téléphone (panneau sous l'en-tête)",
    prepared === 1 && errors.length === 0, `bouton de signature présent : ${prepared} ; erreurs JS : ${errors.join(" | ") || "aucune"}`);
} finally {
  await browser.close();
  procs.forEach((pr) => { try { process.kill(-pr.pid!, "SIGTERM"); } catch {} });
}
process.exit(summary() ? 0 : 1);
