// Étape 38 : la partie crypto du site exige la biométrie du client (passkey WebAuthn vérifiée par bank-mock).
// Pile isolée : bank-mock :4380, appli :4381 (stockages neufs). Chrome headless avec authentificateur WebAuthn virtuel.
// Aucun Client Wallet ni regtest nécessaire : on contrôle l'accès, pas les signatures.
// Limite : la biométrie est simulée par l'authentificateur virtuel de Chrome (comme aux étapes 6 et 10).
import { type ChildProcess, spawn } from "node:child_process";
import { mkdirSync, rmSync } from "node:fs";
import { chromium } from "playwright-core";
import { makeReport } from "./lib.ts";

const APP = "http://localhost:4381", BANK = "http://localhost:4380";
const DATA = `${process.cwd()}/.local/e2e-38`;
const SHOTS = "docs/validation/captures";
const IDLE_MS = 8000; // délai d'inactivité raccourci pour observer l'expiration
rmSync(DATA, { recursive: true, force: true });
mkdirSync(SHOTS, { recursive: true });
const procs: ChildProcess[] = [];
const start = (cmd: string[], env: Record<string, string>, cwd = ".") => procs.push(spawn(cmd[0], cmd.slice(1), { cwd, env: { ...process.env, ...env }, stdio: "ignore", detached: true }));
start(["npm", "run", "-s", "dev", "-w", "bank-mock"], { BANK_MOCK_PORT: "4380", BANK_MOCK_DATA: `${DATA}/bank`, BANK_MOCK_ORIGINS: APP, BANK_MOCK_CRYPTO_IDLE_MS: String(IDLE_MS), ALERT_INTERVAL_MS: "0", ALERT_SIGNET_INTERVAL_MS: "0" });
start(["npx", "vite", "--port", "4381", "--strictPort"], { VITE_BTC_NETWORK: "regtest", VITE_BANK_MOCK_URL: BANK }, "client");
const stopAll = () => procs.forEach((p) => { try { process.kill(-p.pid!, "SIGTERM"); } catch {} });
for (const u of [`${BANK}/health`, APP]) for (let i = 0; i < 150; i++) { try { if ((await fetch(u)).ok) break; } catch {} await new Promise((r) => setTimeout(r, 200)); }

const call = async (method: "GET" | "POST", path: string, token?: string, body?: unknown) => {
  const r = await fetch(BANK + path, { method, headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: method === "POST" ? JSON.stringify(body ?? {}) : undefined });
  return { status: r.status, body: (await r.json().catch(() => ({}))) as any };
};
const apiLogin = async () => (await call("POST", "/auth/login", undefined, { customerId: "CH-0003", password: "demo0003" })).body.token as string;
const { report, summary } = makeReport();
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: true });
const errors: string[] = [];

try {
  // 38-1 Session par mot de passe seule : aucune route crypto, ni identifiant seul sans session.
  const t0 = await apiLogin();
  const probes: [string, "GET" | "POST", string, unknown?][] = [
    ["GET /custody", "GET", "/custody?network=regtest"],
    ["POST /custody/withdraw", "POST", "/custody/withdraw", { network: "regtest", address: "bcrt1qxx", amountSats: 1000 }],
    ["GET /wallet/accounts", "GET", "/wallet/accounts?network=regtest"],
    ["POST /accounts/register", "POST", "/accounts/register", { network: "regtest", delay: 6, client: "x", tiers: "y" }],
    ["POST /ownership/challenge", "POST", "/ownership/challenge", { network: "regtest", client: "x", index: 0 }],
    ["POST /relay", "POST", "/relay", { psbt: "x" }],
    ["GET /evm/accounts", "GET", "/evm/accounts"],
    ["POST /evm/accounts/register", "POST", "/evm/accounts/register", { owner: "0x0", tiers: "0x1" }],
  ];
  const res = await Promise.all(probes.map(async ([n, m, p, b]) => [n, (await call(m, p, t0, b)).status] as const));
  const noSession = await call("POST", "/accounts/register", undefined, { customerId: "CH-0003", network: "regtest", delay: 6, client: "x", tiers: "y" });
  const me = await call("GET", "/me", t0);
  report("38-1", "Session mot de passe seule : 8 routes crypto refusées (403), enregistrement par simple identifiant sans session refusé (401), /me reste accessible",
    res.every(([, s]) => s === 403) && noSession.status === 401 && me.status === 200, `${res.map(([n, s]) => `${n} ${s}`).join(" ; ")} ; sans session ${noSession.status} ; /me ${me.status}`);

  // 38-2 Interface : onglet Crypto verrouillé, biométrie (passkey virtuelle) activée, accès ouvert.
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 1000 } });
  const p = await ctx.newPage();
  p.on("pageerror", (e) => errors.push(e.message));
  const cdp = await ctx.newCDPSession(p);
  await cdp.send("WebAuthn.enable");
  await cdp.send("WebAuthn.addVirtualAuthenticator", { options: { protocol: "ctap2", transport: "internal", hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true } });
  const login = async () => {
    await p.goto(APP);
    await p.evaluate(() => { localStorage.clear(); sessionStorage.clear(); });
    await p.reload();
    await p.getByRole("button", { name: "Login", exact: true }).click();
    await p.getByLabel("Username").fill("CH-0003");
    await p.getByLabel("Password", { exact: true }).fill("demo0003");
    await p.getByRole("button", { name: "Log in", exact: true }).click();
    await p.getByRole("button", { name: "Log out" }).first().waitFor({ timeout: 20000 });
  };
  const openCrypto = () => p.locator(".d-topnav").getByRole("button", { name: "Crypto", exact: true }).click();
  const token = () => p.evaluate(() => JSON.parse(sessionStorage.getItem("sq-bank:session") ?? "null")?.token as string);
  await login();
  await openCrypto();
  await p.getByTestId("crypto-locked").waitFor({ timeout: 20000 });
  const createVisible = await p.getByRole("heading", { name: "Create my Bitcoin wallet" }).count();
  await p.screenshot({ path: `${SHOTS}/etape-38-1-crypto-verrouille.png` });
  await p.getByRole("button", { name: "Enable biometrics" }).click();
  await p.getByRole("heading", { name: "Create my Bitcoin wallet" }).waitFor({ timeout: 20000 });
  const tokA = await token();
  const open = await call("GET", "/wallet/accounts?network=regtest", tokA);
  await p.screenshot({ path: `${SHOTS}/etape-38-2-crypto-deverrouille.png` });
  report("38-2", "Interface : écran verrouillé sans contenu crypto ; activation de la biométrie (passkey) puis accès au wallet ; la même session est acceptée par le serveur",
    createVisible === 0 && open.status === 200, `contenu crypto avant : ${createVisible} ; /wallet/accounts après : ${open.status}`);

  // 38-3 Une autre session par mot de passe (même client) reste refusée et ne peut pas ajouter sa propre passkey.
  const t1 = await apiLogin();
  const other = await call("GET", "/wallet/accounts?network=regtest", t1);
  const addKey = await call("POST", "/auth/passkey/register/options", t1);
  report("38-3", "Autre session par mot de passe seul (client déjà doté d'une passkey) : routes crypto refusées et ajout d'une passkey refusé",
    other.status === 403 && addKey.status === 403, `/wallet/accounts ${other.status} ; passkey/register/options ${addKey.status} (${addKey.body.error})`);

  // 38-4 Expiration par inactivité côté serveur, indépendamment de l'interface.
  const before = (await call("GET", "/wallet/accounts?network=regtest", tokA)).status;
  await new Promise((r) => setTimeout(r, IDLE_MS + 1500));
  const after = await call("GET", "/wallet/accounts?network=regtest", tokA);
  report("38-4", `Le serveur reverrouille la session après ${IDLE_MS / 1000} s d'inactivité (durée raccourcie pour le test ; 10 min par défaut)`,
    before === 200 && after.status === 403, `avant ${before} ; après ${after.status} (${after.body.error})`);

  // 38-5 Nouvelle connexion : verrouillé, puis déverrouillage par la passkey existante.
  await p.getByRole("button", { name: "Log out" }).first().click();
  await login();
  await openCrypto();
  await p.getByTestId("crypto-locked").waitFor({ timeout: 20000 });
  await p.getByRole("button", { name: "Unlock with biometrics" }).click();
  await p.getByRole("heading", { name: "Create my Bitcoin wallet" }).waitFor({ timeout: 20000 });
  const tokB = await token();
  const reopened = await call("GET", "/wallet/accounts?network=regtest", tokB);
  const withdraw = await call("POST", "/custody/withdraw", tokB, { network: "regtest", address: "bcrt1qxx", amountSats: 1000 });
  report("38-5", "Nouvelle connexion : verrouillée, déverrouillée par la passkey existante (assertion vérifiée par le serveur)",
    reopened.status === 200 && withdraw.status !== 403, `/wallet/accounts ${reopened.status} ; /custody/withdraw ${withdraw.status} (refus métier, plus de verrou : ${withdraw.body.error})`);

  // 38-6 Appareil perdu : re-KYC → niveau « recovery » seulement (pas de retrait du compte crypto).
  await p.getByRole("button", { name: "Log out" }).first().click();
  await login();
  await openCrypto();
  await p.getByTestId("crypto-locked").waitFor({ timeout: 20000 });
  await p.getByRole("button", { name: "I lost my device or my biometrics: recover my wallet" }).click();
  await p.getByLabel("Last name").fill("Martin");
  await p.getByLabel("Date of birth").fill("1992-03-21");
  await p.getByLabel("Code received by SMS (mock)").fill("246810");
  await p.getByRole("button", { name: "Verify my identity" }).click();
  await p.getByText("Identity verified.").waitFor({ timeout: 20000 });
  const tokC = await token();
  const rec = await call("GET", "/wallet/accounts?network=regtest", tokC);
  const recCustody = await call("GET", "/custody?network=regtest", tokC);
  const recWithdraw = await call("POST", "/custody/withdraw", tokC, { network: "regtest", address: "bcrt1qxx", amountSats: 1000 });
  const recOwnership = await call("POST", "/ownership/challenge", tokC, { network: "regtest", client: "x", index: 0 });
  await p.screenshot({ path: `${SHOTS}/etape-38-3-recovery-sans-biometrie.png` });
  report("38-6", "Appareil perdu : le re-KYC ouvre la recovery (comptes, enregistrement) mais ni le compte crypto Swissquote ni la preuve de propriété",
    rec.status === 200 && recCustody.status === 403 && recWithdraw.status === 403 && recOwnership.status === 403,
    `/wallet/accounts ${rec.status} ; /custody ${recCustody.status} ; /custody/withdraw ${recWithdraw.status} ; /ownership/challenge ${recOwnership.status}`);

  report("38-7", "Aucune erreur JavaScript dans l'interface", errors.length === 0, errors.join(" | ") || "aucune");
} catch (e: any) {
  report("38-x", "Exécution", false, e.stack ?? e.message);
} finally {
  await browser.close();
  stopAll();
}
process.exit(summary() ? 0 : 1);
