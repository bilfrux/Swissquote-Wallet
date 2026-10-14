// Étape 61 : la fenêtre du Client Wallet passe devant la page de la banque (vrai navigateur : la page peut devenir
// « hidden »). Le verrou crypto (étape 39 : reverrouillage quand la page est cachée) ne doit pas se remettre pendant une
// demande au wallet, sinon l'enregistrement du compte, juste après la création du wallet, est refusé (403 « crypto locked »).
// En headless, la page ne se cache jamais : on simule l'événement `visibilitychange` (état « hidden ») pendant la demande.
// Pile isolée : bank-mock :4480 (verrou ACTIF), Client Wallet :5260, appli :5261, console :5262. Prérequis : npm run regtest:up
import { type ChildProcess, spawn } from "node:child_process";
import { rmSync } from "node:fs";
import { type BrowserContext, type Page, chromium } from "playwright-core";
import { makeReport } from "./lib.ts";

const BANK = "http://localhost:4480", WALLET = "http://localhost:5260", APP = "http://localhost:5261", CONSOLE = "http://localhost:5262";
const DATA = `${process.cwd()}/.local/e2e-61`;
rmSync(DATA, { recursive: true, force: true });
const procs: ChildProcess[] = [];
const start = (cmd: string[], env: Record<string, string>, cwd = ".") => procs.push(spawn(cmd[0], cmd.slice(1), { cwd, env: { ...process.env, ...env }, stdio: "ignore", detached: true }));
start(["npm", "run", "-s", "dev", "-w", "bank-mock"], { BANK_MOCK_PORT: "4480", BANK_MOCK_DATA: `${DATA}/bank`, BANK_MOCK_ORIGINS: `${APP},${CONSOLE}`, ALERT_INTERVAL_MS: "0", ALERT_SIGNET_INTERVAL_MS: "0" });
start(["npm", "run", "-s", "dev", "-w", "client-wallet"], { CLIENT_WALLET_PORT: "5260", CLIENT_WALLET_DATA: `${DATA}/wallet`, VITE_WALLET_ALLOWED_ORIGINS: APP });
start(["npx", "vite", "--port", "5261", "--strictPort"], { VITE_BTC_NETWORK: "regtest", VITE_BANK_MOCK_URL: BANK, VITE_CLIENT_WALLET_URL: WALLET, VITE_GUARDIAN_CONSOLE_URL: CONSOLE }, "client");
start(["npx", "vite", "--port", "5262", "--strictPort"], { VITE_BTC_NETWORK: "regtest", VITE_BANK_MOCK_URL: BANK }, "guardian-console");
for (const u of [`${BANK}/health`, `${WALLET}/api/wallets`, APP, CONSOLE]) for (let i = 0; i < 150; i++) { try { if ((await fetch(u)).ok) break; } catch {} await new Promise((r) => setTimeout(r, 200)); }
const { report, summary } = makeReport();
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: true });
const addAuthenticator = async (ctx: BrowserContext, p: Page) => {
  const cdp = await ctx.newCDPSession(p);
  await cdp.send("WebAuthn.enable");
  await cdp.send("WebAuthn.addVirtualAuthenticator", { options: { protocol: "ctap2", transport: "internal", hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true, hasPrf: true } } as any);
};
// La page de la banque passe en arrière-plan, puis revient (comme quand la fenêtre du wallet passe devant).
// (code passé en texte : esbuild ajouterait sinon un assistant `__name` absent de la page)
const hideAndShow = (p: Page) => p.evaluate(`for (const v of ["hidden", "visible"]) { Object.defineProperty(document, "visibilityState", { get: () => v, configurable: true }); document.dispatchEvent(new Event("visibilitychange")); }`);

try {
  const tctx = await browser.newContext();
  const tiers = await tctx.newPage();
  await tiers.goto(CONSOLE);
  await tiers.getByRole("button", { name: "Create my trusted-contact identity" }).click();
  const tiersKey = (await tiers.locator(".identity-key").textContent())!.trim();

  const ctx = await browser.newContext({ viewport: { width: 1280, height: 1100 } });
  const app = await ctx.newPage();
  const responses: string[] = [];
  app.on("response", (r) => { if (r.url().startsWith(BANK) && r.status() === 403) responses.push(`${r.status()} ${new URL(r.url()).pathname}`); });
  await addAuthenticator(ctx, app);
  await app.goto(APP);
  await app.getByRole("button", { name: "Login", exact: true }).click();
  await app.getByLabel("Username").fill("CH-0003");
  await app.getByLabel("Password", { exact: true }).fill("demo0003");
  await app.getByRole("button", { name: "Log in", exact: true }).click();
  await app.getByRole("button", { name: "Crypto", exact: true }).click();
  await app.getByRole("button", { name: "Enable biometrics" }).click();
  await app.getByTestId("crypto-locked").waitFor({ state: "detached", timeout: 20000 });
  await app.getByPlaceholder("Marie Dupont").fill("Marie Dupont");
  await app.getByLabel("Trusted contact's public key").fill(tiersKey);
  const [w] = await Promise.all([ctx.waitForEvent("page"), app.getByRole("button", { name: "Create my wallet with the Client Wallet" }).click()]);
  await w.waitForLoadState();
  await addAuthenticator(ctx, w);
  await hideAndShow(app); // la fenêtre du wallet passe devant
  await w.getByRole("button", { name: "Generate my secret phrase" }).click();
  await w.getByLabel("I have written my phrase down in a safe place").check();
  await w.getByRole("button", { name: "Send my public key to Swissquote" }).click();
  await w.getByRole("button", { name: "Confirm and save" }).waitFor({ timeout: 30000 }).catch(() => undefined);
  await hideAndShow(app); // de nouveau pendant la demande « policy »
  await w.getByRole("button", { name: "Confirm and save" }).click({ timeout: 5000 }).catch(() => undefined);
  const created = await app.getByTestId("btc-balance").waitFor({ timeout: 30000 }).then(() => true, () => false);
  const shown = created ? "" : ((await app.locator(".error").first().textContent().catch(() => "")) ?? "");
  report("61-1", "Page de la banque cachée puis réaffichée pendant les demandes au Client Wallet : le verrou crypto ne se remet pas, le compte est enregistré",
    created && responses.length === 0, `compte créé : ${created} ; erreur affichée : « ${shown.trim()} » ; réponses 403 de bank-mock : ${responses.join(", ") || "aucune"}`);

  // Hors demande au wallet, cacher la page reverrouille toujours (comportement de l'étape 39 conservé).
  await hideAndShow(app);
  const relocked = await app.getByTestId("crypto-locked").waitFor({ timeout: 15000 }).then(() => true, () => false);
  report("61-2", "Sans demande en cours au Client Wallet, une page cachée reverrouille toujours la partie crypto (étape 39)", relocked, `écran verrouillé : ${relocked}`);
  // Clients de démo vierges ajoutés pour la présentation (CH-0004 pitch, CH-0005 vidéo, CH-0006 second passage).
  const demo = [["CH-0004", "pitch0004", "Keller", "1994-07-12", "135790"], ["CH-0005", "video0005", "Berger", "1991-11-02", "975310"], ["CH-0006", "second0006", "Rossi", "1993-04-18", "864209"]];
  const checks = [];
  for (const [id, pw, lastName, birthDate, otp] of demo) {
    const post = (path: string, body: unknown) => fetch(BANK + path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }).then((r) => r.status);
    checks.push(`${id} : connexion ${await post("/auth/login", { customerId: id, password: pw })}, re-KYC ${await post("/identity/verify", { customerId: id, lastName, birthDate, otp })}`);
  }
  report("61-3", "Clients de démo vierges CH-0004, CH-0005, CH-0006 : connexion et re-KYC", checks.every((c) => /connexion 200, re-KYC 200/.test(c)), checks.join(" ; "));
} finally {
  await browser.close();
  procs.forEach((p) => { try { process.kill(-p.pid!, "SIGTERM"); } catch {} });
}
process.exit(summary() ? 0 : 1);
