// Étape 40 : les wallets appartiennent à l'appareil, pas au compte Swissquote.
// Pile isolée : bank-mock :4400, appli :4401 (stockages neufs), verrou crypto désactivé (on teste autre chose ici).
// Prérequis : npm run regtest:up. Aucun Client Wallet nécessaire : on contrôle d'où vient la liste des wallets.
import { type ChildProcess, spawn } from "node:child_process";
import { mkdirSync, rmSync } from "node:fs";
import { chromium } from "playwright-core";
import { createWalletConfig } from "@sq/bitcoin";
import { accountKey, masterFromMnemonic, newMnemonic } from "@sq/bitcoin/keys";
import { makeReport } from "./lib.ts";

const APP = "http://localhost:4401", BANK = "http://localhost:4400";
const DATA = `${process.cwd()}/.local/e2e-40`;
const SHOTS = "docs/validation/captures";
rmSync(DATA, { recursive: true, force: true });
mkdirSync(SHOTS, { recursive: true });
const procs: ChildProcess[] = [];
const start = (cmd: string[], env: Record<string, string>, cwd = ".") => procs.push(spawn(cmd[0], cmd.slice(1), { cwd, env: { ...process.env, ...env }, stdio: "ignore", detached: true }));
start(["npm", "run", "-s", "dev", "-w", "bank-mock"], { BANK_MOCK_PORT: "4400", BANK_MOCK_DATA: `${DATA}/bank`, BANK_MOCK_ORIGINS: APP, BANK_MOCK_CRYPTO_LOCK: "off", ALERT_INTERVAL_MS: "0", ALERT_SIGNET_INTERVAL_MS: "0" });
start(["npx", "vite", "--port", "4401", "--strictPort"], { VITE_BTC_NETWORK: "regtest", VITE_BANK_MOCK_URL: BANK }, "client");
const stopAll = () => procs.forEach((p) => { try { process.kill(-p.pid!, "SIGTERM"); } catch {} });
for (const u of [`${BANK}/health`, APP]) for (let i = 0; i < 150; i++) { try { if ((await fetch(u)).ok) break; } catch {} await new Promise((r) => setTimeout(r, 200)); }
const { report, summary } = makeReport();
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: true });

try {
  // Un compte Bitcoin est enregistré chez Swissquote pour CH-0003 (comme après une création de wallet sur un autre appareil).
  const key = () => accountKey(masterFromMnemonic(newMnemonic(), "regtest"));
  const [client, sq, tiers] = [key(), key(), key()];
  const login = await (await fetch(`${BANK}/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ customerId: "CH-0003", password: "demo0003" }) })).json() as any;
  const reg = await fetch(`${BANK}/accounts/register`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${login.token}` }, body: JSON.stringify({ network: "regtest", delay: 6, client, tiers, tiersName: "Marie Dupont" }) });
  const listed = await (await fetch(`${BANK}/wallet/accounts?network=regtest`, { headers: { authorization: `Bearer ${login.token}` } })).json() as any;
  report("40-0", "Préparation : un compte est bien enregistré chez Swissquote pour ce client", reg.status === 200 && listed.accounts?.length === 1, `enregistrement ${reg.status} ; comptes côté Swissquote : ${listed.accounts?.length}`);

  const open = async (seed?: unknown) => {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 1000 } });
    const p = await ctx.newPage();
    const calls: string[] = [], errors: string[] = [];
    p.on("request", (r) => { if (r.url().startsWith(BANK)) calls.push(new URL(r.url()).pathname); });
    p.on("pageerror", (e) => errors.push(e.message));
    await p.goto(APP);
    await p.evaluate(([k, v]) => { localStorage.clear(); sessionStorage.clear(); if (v) localStorage.setItem(k as string, JSON.stringify(v)); }, ["sq-wallet:btc:regtest:CH-0003", seed] as const);
    await p.reload();
    await p.getByRole("button", { name: "Login", exact: true }).click();
    await p.getByLabel("Username").fill("CH-0003");
    await p.getByLabel("Password", { exact: true }).fill("demo0003");
    await p.getByRole("button", { name: "Log in", exact: true }).click();
    await p.getByRole("button", { name: "Log out" }).first().waitFor({ timeout: 20000 });
    await p.locator(".d-topnav").getByRole("button", { name: "Crypto", exact: true }).click();
    return { p, ctx, calls, errors };
  };

  // 40-1 Appareil vierge : le compte enregistré chez Swissquote n'est PAS repris ; on propose de créer ou de récupérer.
  const a = await open();
  await a.p.getByRole("heading", { name: "Create my Bitcoin wallet" }).waitFor({ timeout: 20000 });
  const recoverLink = await a.p.getByRole("button", { name: "I had a wallet and lost it: recover my bitcoin" }).count();
  const asked = a.calls.filter((c) => c === "/wallet/accounts");
  await a.p.screenshot({ path: `${SHOTS}/etape-40-1-appareil-vierge.png` });
  report("40-1", "Appareil sans wallet : le compte enregistré chez Swissquote n'est pas repris ; création ou recovery proposées ; aucune requête /wallet/accounts",
    recoverLink === 1 && asked.length === 0 && a.errors.length === 0, `lien recovery : ${recoverLink} ; requêtes /wallet/accounts : ${asked.length} ; erreurs JS : ${a.errors.length}`);
  await a.ctx.close();

  // 40-2 Appareil qui a le wallet en cache : il s'ouvre, sans demander à Swissquote quels wallets existent.
  const cfg = await createWalletConfig({ network: "regtest", delay: 6, client, swissquote: sq, tiers });
  const b = await open({ client: cfg.client.raw, swissquote: sq, tiers, tiersName: "Marie Dupont", delay: 6 });
  await b.p.getByTestId("wallet-page").waitFor({ timeout: 30000 });
  const askedB = b.calls.filter((c) => c === "/wallet/accounts");
  await b.p.screenshot({ path: `${SHOTS}/etape-40-2-appareil-avec-wallet.png` });
  report("40-2", "Appareil qui a le wallet : il s'ouvre depuis le stockage local, aucune requête /wallet/accounts",
    askedB.length === 0 && b.errors.length === 0, `requêtes /wallet/accounts : ${askedB.length} ; erreurs JS : ${b.errors.length}`);
  await b.ctx.close();
} catch (e: any) {
  report("40-x", "Exécution", false, e.stack ?? e.message);
} finally {
  await browser.close();
  stopAll();
}
process.exit(summary() ? 0 : 1);
