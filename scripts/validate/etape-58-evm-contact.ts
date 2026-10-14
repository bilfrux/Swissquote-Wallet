// Étape 58 : changement du contact de confiance Ethereum depuis l'interface, sur le VRAI Sepolia, sans ETH (Chrome headless).
// Compte activé comme à l'étape 54, puis : nouveau contact créé dans sa console, changement préparé dans l'onglet Sécurité,
// décodé par le Client Wallet (ancienne et nouvelle adresse), signé par biométrie ; registre de Swissquote mis à jour d'après
// la chaîne ; le relais n'accepte plus que la signature du NOUVEAU contact.
// Pile : bank-mock :4470 (verrou actif), Client Wallet :5240, appli :5241 (Bitcoin regtest), console du contact :5242.
// Prérequis : npm run regtest:up ; accès réseau à Sepolia (nœud public, bundler et paymaster publics de Candide).
import { type ChildProcess, spawn } from "node:child_process";
import { rmSync } from "node:fs";
import { type BrowserContext, type Page, chromium } from "playwright-core";
import { getAddress, type Address } from "viem";
import { privateKeyToAddress, generatePrivateKey } from "viem/accounts";
import { publicClient, readState as readLatest, recoveryNonce, recoveryTypedData } from "@sq/evm";
import { evmAccountFromMnemonic } from "@sq/evm/keys";
import { makeReport } from "./lib.ts";

const BANK = "http://localhost:4470", WALLET = "http://localhost:5240", APP = "http://localhost:5241", CONSOLE = "http://localhost:5242";
const DATA = `${process.cwd()}/.local/e2e-58`;
rmSync(DATA, { recursive: true, force: true });
const procs: ChildProcess[] = [];
const start = (cmd: string[], env: Record<string, string>, cwd = ".") => procs.push(spawn(cmd[0], cmd.slice(1), { cwd, env: { ...process.env, ...env }, stdio: "ignore", detached: true }));
start(["npm", "run", "-s", "dev", "-w", "bank-mock"], { BANK_MOCK_PORT: "4470", BANK_MOCK_DATA: `${DATA}/bank`, BANK_MOCK_ORIGINS: `${APP},${CONSOLE}`, ALERT_INTERVAL_MS: "0", ALERT_SIGNET_INTERVAL_MS: "0" });
start(["npm", "run", "-s", "dev", "-w", "client-wallet"], { CLIENT_WALLET_PORT: "5240", CLIENT_WALLET_DATA: `${DATA}/wallet`, VITE_WALLET_ALLOWED_ORIGINS: APP });
start(["npx", "vite", "--port", "5241", "--strictPort"], { VITE_BTC_NETWORK: "regtest", VITE_BANK_MOCK_URL: BANK, VITE_CLIENT_WALLET_URL: WALLET, VITE_GUARDIAN_CONSOLE_URL: CONSOLE }, "client");
start(["npx", "vite", "--port", "5242", "--strictPort"], { VITE_BTC_NETWORK: "regtest", VITE_BANK_MOCK_URL: BANK }, "guardian-console");
const stopAll = () => procs.forEach((p) => { try { process.kill(-p.pid!, "SIGTERM"); } catch {} });
for (const u of [`${BANK}/health`, `${WALLET}/api/wallets`, APP, CONSOLE]) for (let i = 0; i < 150; i++) { try { if ((await fetch(u)).ok) break; } catch {} await new Promise((r) => setTimeout(r, 200)); }

const SHOTS = "docs/validation/captures";
const { report, summary } = makeReport();
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: true });
const errors: string[] = [], failed: string[] = [];
const device = async () => {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 1300 } });
  ctx.on("page", (p) => {
    p.on("pageerror", (e) => errors.push(e.message));
    p.on("console", (m) => m.type() === "error" && !/Failed to load resource/.test(m.text()) && errors.push(m.text()));
    p.on("response", (r) => { if (r.status() >= 500) failed.push(`${r.status()} ${r.url()}`); });
  });
  return ctx;
};
const addAuthenticator = async (ctx: BrowserContext, p: Page) => {
  const cdp = await ctx.newCDPSession(p);
  await cdp.send("WebAuthn.enable");
  await cdp.send("WebAuthn.addVirtualAuthenticator", { options: { protocol: "ctap2", transport: "internal", hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true, hasPrf: true } } as any);
};
// Fenêtre du Client Wallet : ouverte une fois (avec son authentificateur), puis réutilisée par l'appli (window.open nommé).
let w: Page | null = null;
const inWallet = async (ctx: BrowserContext, click: () => Promise<void>) => {
  if (w && !w.isClosed()) { await click(); await w.waitForLoadState(); return w; }
  const [p] = await Promise.all([ctx.waitForEvent("page", { timeout: 150000 }), click()]);
  await p.waitForLoadState();
  await addAuthenticator(ctx, p);
  return (w = p);
};
const toEthereum = async (p: Page) => { await p.getByTestId("network-switcher").click(); await p.getByTestId("network-evm").click(); };
const openCrypto = async (p: Page) => {
  await p.getByRole("button", { name: "Crypto", exact: true }).click();
  const locked = p.getByTestId("crypto-locked");
  await locked.or(p.getByTestId("btc-balance")).or(p.getByPlaceholder("Marie Dupont")).first().waitFor({ timeout: 20000 });
  if (!(await locked.isVisible())) return;
  const enable = p.getByRole("button", { name: "Enable biometrics" });
  await ((await enable.isVisible()) ? enable : p.getByRole("button", { name: "Unlock with biometrics" })).click();
  await locked.waitFor({ state: "detached", timeout: 20000 });
};
const shot = (p: Page, n: string) => p.screenshot({ path: `${SHOTS}/etape-58-${n}.png` });
let atBlock: bigint | undefined;
const seen = async (text: string) => { const h = text.match(/0x[0-9a-f]{64}/)?.[0] as `0x${string}` | undefined; if (h) atBlock = (await publicClient.waitForTransactionReceipt({ hash: h })).blockNumber; return h; };
async function readState(safe: Address) { for (let i = 0; ; i++) { try { return await readLatest(safe, atBlock); } catch (e) { if (i > 15) throw e; await new Promise((r) => setTimeout(r, 2000)); } } }
const bank = async (path: string, body: unknown) => { const r = await fetch(BANK + path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }); return { status: r.status, json: (await r.json()) as any }; };

try {
  // --- Contact de confiance : identité créée dans sa console ---
  const tctx = await device();
  const tiers = await tctx.newPage();
  await tiers.goto(CONSOLE);
  await tiers.getByRole("button", { name: "Create my trusted-contact identity" }).click();
  const tiersWords = (await tiers.locator(".identity-words li").allTextContents()).map((x) => x.trim());
  const tiersKey = (await tiers.locator(".identity-key").textContent())!.trim();
  const tiersEvm = getAddress((await tiers.locator(".identity-evm").textContent())!.trim());
  await tiers.getByRole("button", { name: /I have written down my phrase/ }).click();

  // --- Client : connexion, biométrie bancaire, wallet Bitcoin (politique confirmée), puis compte Ethereum ---
  const ctx = await device();
  const app = await ctx.newPage();
  await addAuthenticator(ctx, app);
  await app.goto(APP);
  await app.getByRole("button", { name: "Login", exact: true }).click();
  await app.getByLabel("Username").fill("CH-0003");
  await app.getByLabel("Password", { exact: true }).fill("demo0003");
  await app.getByRole("button", { name: "Log in", exact: true }).click();
  await openCrypto(app);
  await app.getByPlaceholder("Marie Dupont").fill("Marie Dupont");
  await app.getByLabel("Trusted contact's public key").fill(tiersKey);
  await inWallet(ctx, () => app.getByRole("button", { name: "Create my wallet with the Client Wallet" }).click());
  await w!.getByRole("button", { name: "Generate my secret phrase" }).click();
  await w!.getByLabel("I have written my phrase down in a safe place").check();
  await w!.getByRole("button", { name: "Send my public key to Swissquote" }).click();
  await w!.getByRole("button", { name: "Confirm and save" }).click({ timeout: 30000 });
  await app.getByTestId("btc-balance").waitFor({ timeout: 30000 });

  await toEthereum(app);
  const card = app.getByTestId("evm-card");
  await card.getByRole("button", { name: "Add my Ethereum account" }).waitFor({ timeout: 30000 });
  await card.locator("input").fill(tiersEvm);
  await inWallet(ctx, () => card.getByRole("button", { name: "Add my Ethereum account" }).click());
  await w!.getByRole("button", { name: "Send my Ethereum address" }).click({ timeout: 30000 });
  const safe = getAddress((await app.getByTestId("evm-safe").textContent({ timeout: 30000 }))!.trim());
  const owner = getAddress((await (await fetch(`${WALLET}/api/wallets`)).json())[0].evmAddress);
  report("58-1", "Compte Ethereum ajouté depuis l'interface : adresse dérivée dans le Client Wallet, Safe recalculé par Swissquote",
    !!safe && !!owner, `Safe ${safe} ; propriétaire ${owner} ; contact ${tiersEvm}`);

  // --- Activation : décodée et signée dans le Client Wallet (biométrie), sans ETH ---
  await card.getByRole("button", { name: "Activate my Ethereum account" }).click();
  await inWallet(ctx, () => card.getByRole("button", { name: "Sign with my Client Wallet" }).click({ timeout: 120000 }));
  await w!.getByRole("heading", { name: "Confirm the Ethereum operation" }).waitFor({ timeout: 90000 });
  const actScreen = (await w!.locator("section").first().textContent()) ?? "";
  await shot(w!, "1-activation-wallet");
  await w!.getByRole("button", { name: "Confirm and sign" }).click();
  const act = (await card.getByText(/^Activation: 0x/).textContent({ timeout: 240000 })) ?? "";
  await seen(act);
  let st = await readState(safe);
  const sq = getAddress((await (await fetch(`${BANK}/guardian/evm-address?owner=${owner}`)).json()).address); // adresse propre au compte (étape 56)
  const c2 = { deployed: st.deployed, module: st.moduleEnabled, threshold: st.threshold === 2n, guardians: st.guardians.map((a) => getAddress(a)).sort().join() === [sq, tiersEvm].sort().join(),
    owner: !!st.owners[0] && getAddress(st.owners[0]) === owner, screenModule: actScreen.includes("Enable the recovery module"), screenSponsor: actScreen.includes("paid by a sponsor") };
  report("58-2", "Activation sur Sepolia : écran du wallet en clair (module, 2 gardiens, frais parrainés), signée par biométrie ; Safe déployé, gardiens Swissquote + contact, seuil 2, 0 ETH",
    Object.values(c2).every(Boolean), `${act.trim()} ; gardiens ${st.guardians.join(", ")} (Swissquote ${sq}) ; seuil ${st.threshold} ; propriétaire ${st.owners[0]} ; contrôles ${JSON.stringify(c2)}`);

  // --- Nouveau contact : identité créée dans sa console ---
  const t2ctx = await device();
  const tiers2 = await t2ctx.newPage();
  await tiers2.goto(CONSOLE);
  await tiers2.getByRole("button", { name: "Create my trusted-contact identity" }).click();
  const tiers2Words = (await tiers2.locator(".identity-words li").allTextContents()).map((x) => x.trim());
  const tiers2Evm = getAddress((await tiers2.locator(".identity-evm").textContent())!.trim());

  // --- Changement dans l'onglet Sécurité du compte Ethereum ---
  await card.locator(".evm-tabs").getByRole("button", { name: "Security" }).click();
  await card.getByTestId("evm-contact").getByRole("button", { name: "Change my trusted contact" }).click();
  const form = card.getByTestId("evm-contact-form");
  await form.getByPlaceholder("Marie Dupont").fill("Bob Martin");
  await form.getByPlaceholder("0x…").fill(tiers2Evm);
  await form.getByRole("button", { name: "Prepare the change" }).click();
  await inWallet(ctx, () => card.getByRole("button", { name: "Sign with my Client Wallet" }).click({ timeout: 120000 }));
  await w!.getByRole("heading", { name: "Confirm the Ethereum operation" }).waitFor({ timeout: 90000 });
  const changeScreen = (await w!.getByTestId("evm-contact-change").textContent({ timeout: 30000 })) ?? "";
  await shot(w!, "1-changement-contact-wallet");
  await w!.getByRole("button", { name: "Confirm and sign" }).click();
  const changed = (await card.getByText(/^Trusted contact changed: 0x/).textContent({ timeout: 240000 })) ?? "";
  await seen(changed);
  st = await readState(safe);
  report("58-3", "Changement de contact signé par biométrie après un écran qui montre l'ancienne et la nouvelle adresse ; on-chain : gardiens Swissquote + nouveau contact, seuil 2",
    changeScreen.includes(tiersEvm) && changeScreen.includes(tiers2Evm) && st.threshold === 2n && st.guardians.map((a) => getAddress(a)).sort().join() === [sq, tiers2Evm].sort().join(),
    `${changed.trim()} ; gardiens ${st.guardians.join(", ")} ; seuil ${st.threshold} ; écran : ${changeScreen.replace(/\s+/g, " ").slice(0, 160)}`);

  // --- Registre Swissquote mis à jour (d'après la chaîne) ---
  await card.getByTestId("evm-contact").waitFor({ timeout: 120000 });
  const token = JSON.parse((await app.evaluate(() => sessionStorage.getItem("sq-bank:session"))) ?? "null").token;
  const reg = (await (await fetch(`${BANK}/evm/accounts`, { headers: { authorization: `Bearer ${token}` } })).json()).accounts.find((a: any) => getAddress(a.safe) === safe);
  const shown = (await card.getByTestId("evm-contact").textContent()) ?? "";
  report("58-4", "Registre de Swissquote et interface : nouveau contact (nom et adresse)", getAddress(reg.tiers) === tiers2Evm && reg.tiersName === "Bob Martin" && shown.includes("Bob Martin") && shown.includes(tiers2Evm),
    `registre : ${reg.tiersName} ${reg.tiers} ; affiché : ${shown.replace(/\s+/g, " ").slice(0, 120)}`);

  // --- Relais : seule la signature du NOUVEAU contact est acceptée pour une demande de recovery ---
  const newKey = privateKeyToAddress(generatePrivateKey());
  const nonce = await recoveryNonce(safe, atBlock);
  const relayId = (await (await fetch(`${BANK}/relay`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${token}` }, body: JSON.stringify({ psbt: JSON.stringify({ kind: "evm-recovery", safe, newOwner: newKey, nonce: nonce.toString() }) }) })).json()).id;
  const td = (await recoveryTypedData(safe, newKey, nonce)) as any;
  const sigOld = await evmAccountFromMnemonic(tiersWords.join(" ")).account.signTypedData(td);
  const sigNew = await evmAccountFromMnemonic(tiers2Words.join(" ")).account.signTypedData(td);
  const rOld = await bank("/relay/signed", { id: relayId, signature: sigOld });
  const rNew = await bank("/relay/signed", { id: relayId, signature: sigNew });
  report("58-5", "Relais Swissquote : la signature de l'ANCIEN contact est refusée, celle du nouveau acceptée", rOld.status === 400 && rNew.status === 200, `ancien : ${rOld.status} « ${rOld.json.error} » ; nouveau : ${rNew.status}`);

  // --- Le wallet refuse un « changement » qui retirerait Swissquote... sans qu'il puisse savoir lequel est Swissquote ---
  // (limite documentée : il affiche l'ancienne adresse, que le client doit reconnaître comme celle de son contact.)
} catch (e: any) {
  for (const c of browser.contexts()) for (const p of c.pages()) console.log(`PAGE ${p.url()} :`, ((await p.locator("body").textContent().catch(() => "")) ?? "").replace(/\s+/g, " ").slice(0, 900));
  report("58-x", "Exécution", false, e.message.split("\n")[0]);
} finally {
  await browser.close();
  stopAll();
}
report("58-6", "Aucune erreur dans les consoles des navigateurs ni réponse 5xx", errors.length === 0 && failed.length === 0, `${errors.join(" | ") || "aucune"} ; 5xx : ${[...new Set(failed)].join(", ") || "aucune"}`);
process.exit(summary() ? 0 : 1);
