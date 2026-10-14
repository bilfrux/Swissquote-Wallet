// Étape 54 : parcours Ethereum complet depuis l'interface, sur le VRAI Sepolia, sans ETH (Chrome headless), pile isolée.
// Reprend les étapes 17 et 18 avec ce qui a changé depuis : biométrie du Client Wallet (PRF, étape 36/44), verrou crypto
// (étape 38), politique confirmée dans le wallet (étape 47), refus des changements de gardiens (étape 48).
// Pile : bank-mock :4440 (verrou actif), Client Wallet :5220, appli :5221 (Bitcoin regtest), console du contact :5222.
// Prérequis : npm run regtest:up ; accès réseau à Sepolia (nœud public, bundler et paymaster publics de Candide).
import { type ChildProcess, spawn } from "node:child_process";
import { rmSync } from "node:fs";
import { type BrowserContext, type Page, chromium } from "playwright-core";
import { getAddress, type Address } from "viem";
import { privateKeyToAddress, generatePrivateKey } from "viem/accounts";
import { SocialRecoveryModule } from "abstractionkit";
import { RECOVERY_MODULE, buildSponsoredOp, publicClient, readState as readLatest, recoveryNonce } from "@sq/evm";
import { makeReport } from "./lib.ts";

const BANK = "http://localhost:4440", WALLET = "http://localhost:5220", APP = "http://localhost:5221", CONSOLE = "http://localhost:5222";
const DATA = `${process.cwd()}/.local/e2e-54`;
rmSync(DATA, { recursive: true, force: true });
const procs: ChildProcess[] = [];
const start = (cmd: string[], env: Record<string, string>, cwd = ".") => procs.push(spawn(cmd[0], cmd.slice(1), { cwd, env: { ...process.env, ...env }, stdio: "ignore", detached: true }));
start(["npm", "run", "-s", "dev", "-w", "bank-mock"], { BANK_MOCK_PORT: "4440", BANK_MOCK_DATA: `${DATA}/bank`, BANK_MOCK_ORIGINS: `${APP},${CONSOLE}`, ALERT_INTERVAL_MS: "0", ALERT_SIGNET_INTERVAL_MS: "0" });
start(["npm", "run", "-s", "dev", "-w", "client-wallet"], { CLIENT_WALLET_PORT: "5220", CLIENT_WALLET_DATA: `${DATA}/wallet`, VITE_WALLET_ALLOWED_ORIGINS: APP });
start(["npx", "vite", "--port", "5221", "--strictPort"], { VITE_BTC_NETWORK: "regtest", VITE_BANK_MOCK_URL: BANK, VITE_CLIENT_WALLET_URL: WALLET, VITE_GUARDIAN_CONSOLE_URL: CONSOLE }, "client");
start(["npx", "vite", "--port", "5222", "--strictPort"], { VITE_BTC_NETWORK: "regtest", VITE_BANK_MOCK_URL: BANK }, "guardian-console");
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
const shot = (p: Page, n: string) => p.screenshot({ path: `${SHOTS}/etape-54-${n}.png` });
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
  report("54-1", "Compte Ethereum ajouté depuis l'interface : adresse dérivée dans le Client Wallet, Safe recalculé par Swissquote",
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
  report("54-2", "Activation sur Sepolia : écran du wallet en clair (module, 2 gardiens, frais parrainés), signée par biométrie ; Safe déployé, gardiens Swissquote + contact, seuil 2, 0 ETH",
    Object.values(c2).every(Boolean), `${act.trim()} ; gardiens ${st.guardians.join(", ")} (Swissquote ${sq}) ; seuil ${st.threshold} ; propriétaire ${st.owners[0]} ; contrôles ${JSON.stringify(c2)}`);

  // --- Refus du Client Wallet sur le Safe réel (appel direct à son API, comme une appli compromise) ---
  const attacker = privateKeyToAddress(generatePrivateKey());
  const m = new SocialRecoveryModule(RECOVERY_MODULE);
  const unknownOp = await buildSponsoredOp({ safe, owner }, [{ to: "0x9a7af758aE5d7B6aAE84fe4C5Ba67c041dFE5336", value: 0n, data: "0x6a627842" + safe.slice(2).toLowerCase().padStart(64, "0") }]);
  const guardianOp = await buildSponsoredOp({ safe, owner }, [m.createAddGuardianWithThresholdMetaTransaction(attacker, 1n)]);
  const sign = async (op: unknown) => { const r = await fetch(`${WALLET}/api/evm/sign`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ op }) }); return { status: r.status, error: ((await r.json()) as any).error as string }; };
  const ru = await sign(unknownOp), rg = await sign(guardianOp);
  report("54-3", "Client Wallet : refuse un appel non reconnu, et l'ajout d'un gardien de l'attaquant avec seuil 1 (étape 48), sur le Safe déployé",
    ru.status === 400 && /refused/.test(ru.error) && rg.status === 400 && /single guardian/.test(rg.error), `inconnu : ${ru.status} « ${ru.error} » ; gardien : ${rg.status} « ${rg.error} »`);

  // --- Recovery : contrôles Swissquote, puis parcours dans l'interface (nouvelle clé) ---
  const nonceBefore = await recoveryNonce(safe);
  const noKyc = await bank("/guardian/evm/sign-recovery", { token: "x", safe, newOwner: "0x000000000000000000000000000000000000dEaD" });
  const tok = (await bank("/identity/verify", { customerId: "CH-0003", lastName: "Martin", birthDate: "1992-03-21", otp: "246810" })).json.token;
  const toOwner = await bank("/guardian/evm/sign-recovery", { token: tok, safe, newOwner: owner });
  // Chacun des deux gardiens, quelle que soit sa place dans la liste lue on-chain, est refusé comme nouveau propriétaire.
  const guardians = (await readState(safe)).guardians;
  const toGuardians = await Promise.all(guardians.map((g) => bank("/guardian/evm/sign-recovery", { token: tok, safe, newOwner: g })));
  report("54-4", "Swissquote refuse de signer une recovery sans re-KYC, vers le propriétaire actuel, et vers chacun des gardiens (contact compris)",
    noKyc.status === 403 && toOwner.status === 403 && guardians.length === 2 && toGuardians.every((r) => r.status === 403),
    `${noKyc.status} ${noKyc.json.error} ; propriétaire : ${toOwner.status} ; gardiens ${guardians.join(", ")} : ${toGuardians.map((r) => r.status).join(", ")}`);

  await card.getByRole("button", { name: "Recover", exact: true }).click();
  const rec = card.getByTestId("evm-recovery");
  await rec.getByPlaceholder("Last name").fill("Martin");
  await rec.getByPlaceholder("Date of birth (YYYY-MM-DD)").fill("1992-03-21");
  await rec.getByPlaceholder("Code received by SMS").fill("246810");
  await rec.getByRole("button", { name: "Verify my identity" }).click();
  await inWallet(ctx, () => rec.getByRole("button", { name: "Create a new Client Wallet" }).click());
  await w!.getByRole("button", { name: "Generate my secret phrase" }).click({ timeout: 30000 });
  await w!.getByLabel("I have written my phrase down in a safe place").check();
  await w!.getByRole("button", { name: "Send my public key to Swissquote" }).click();
  await inWallet(ctx, () => rec.getByRole("button", { name: "Get its Ethereum address" }).click({ timeout: 30000 }));
  await w!.getByRole("button", { name: "Send my Ethereum address" }).click({ timeout: 30000 });
  const newOwner = getAddress((await rec.getByTestId("evm-new-owner").textContent({ timeout: 30000 }))!.trim());
  await rec.getByRole("button", { name: "Request Swissquote's signature" }).click();
  await rec.getByRole("button", { name: /^Send the request to/ }).click();
  const link = (await rec.getByTestId("evm-relay-link").textContent({ timeout: 30000 }))!.trim();
  await tiers.goto(link);
  const shownOwner = (await tiers.getByTestId("evm-new-owner").textContent({ timeout: 30000 }))!.trim();
  await tiers.getByPlaceholder("word1 word2 … word24").fill(tiersWords.join(" "));
  await tiers.getByRole("button", { name: /Sign as trusted contact/ }).click();
  await tiers.getByTestId("relay-sent").waitFor({ timeout: 90000 });
  report("54-5", "Demande relayée au contact : sa console affiche la nouvelle clé et signe (EIP-712), Swissquote vérifie la signature du contact enregistré",
    getAddress(shownOwner) === newOwner, `nouvelle clé ${newOwner} ; lien ${link}`);

  await rec.getByRole("button", { name: "Fetch the trusted contact's signature" }).click();
  await rec.getByRole("button", { name: "Start the recovery" }).click();
  await inWallet(ctx, () => card.getByRole("button", { name: "Sign with my Client Wallet" }).click({ timeout: 120000 }));
  await w!.getByRole("heading", { name: "Confirm the Ethereum operation" }).waitFor({ timeout: 90000 });
  const startScreen = (await w!.locator("section").first().textContent()) ?? "";
  await w!.getByRole("button", { name: "Confirm and sign" }).click();
  const started = (await card.getByText(/^Recovery started: 0x/).textContent({ timeout: 240000 })) ?? "";
  await seen(started);
  st = await readState(safe);
  await rec.getByTestId("evm-countdown").waitFor({ timeout: 60000 });
  await shot(app, "2-recovery-demarree");
  report("54-6", "Recovery démarrée (Swissquote + contact), relayée par le Safe de la nouvelle clé, signée par biométrie ; délai affiché, propriétaire inchangé pendant le délai",
    !!st.pending && st.pending.newOwners.map((a) => getAddress(a)).includes(newOwner) && getAddress(st.owners[0]) === owner && startScreen.includes("Relay the guardians' signatures"),
    `${started.trim()} ; applicable après ${st.pending ? new Date(st.pending.executeAfter * 1000).toISOString() : "?"}`);

  const fin = rec.getByRole("button", { name: "Complete the recovery" });
  await fin.waitFor({ timeout: 420000 });
  await fin.click();
  await inWallet(ctx, () => card.getByRole("button", { name: "Sign with my Client Wallet" }).click({ timeout: 120000 }));
  await w!.getByRole("heading", { name: "Confirm the Ethereum operation" }).waitFor({ timeout: 90000 });
  await w!.getByRole("button", { name: "Confirm and sign" }).click();
  const finalized = (await card.getByText(/^Recovery completed: 0x/).textContent({ timeout: 240000 })) ?? "";
  await seen(finalized);
  st = await readState(safe);
  report("54-7", "Après le délai (3 min, contrat) : recovery finalisée depuis l'interface ; propriétaire = nouvelle clé",
    st.owners.length === 1 && getAddress(st.owners[0]) === newOwner && !st.pending, `${finalized.trim()} ; propriétaires ${st.owners.join(",")}`);

  // Règle du projet : la nouvelle clé invalide aussitôt les signatures de gardiens restantes.
  await inWallet(ctx, () => card.getByRole("button", { name: "Sign with my Client Wallet" }).click({ timeout: 240000 }));
  await w!.getByRole("heading", { name: "Confirm the Ethereum operation" }).waitFor({ timeout: 90000 });
  const invScreen = (await w!.locator("section").first().textContent()) ?? "";
  await w!.getByRole("button", { name: "Confirm and sign" }).click();
  await card.getByText(/^Leftover guardian signatures invalidated: 0x/).waitFor({ timeout: 240000 });
  await seen((await card.getByTestId("evm-last-tx").textContent()) ?? "");
  const nonceAfter = await recoveryNonce(safe, atBlock);
  await shot(app, "3-recovery-terminee");
  report("54-8", "La nouvelle clé signe depuis le Safe récupéré : signatures de gardiens restantes invalidées (nonce du module)",
    nonceAfter > nonceBefore + 1n && invScreen.includes("Invalidate any guardian signature"), `nonce ${nonceBefore} -> ${nonceAfter}`);
} catch (e: any) {
  for (const c of browser.contexts()) for (const p of c.pages()) console.log(`PAGE ${p.url()} :`, ((await p.locator("body").textContent().catch(() => "")) ?? "").replace(/\s+/g, " ").slice(0, 900));
  report("54-x", "Exécution", false, e.message.split("\n")[0]);
} finally {
  await browser.close();
  stopAll();
}
report("54-9", "Aucune erreur dans les consoles des navigateurs ni réponse 5xx", errors.length === 0 && failed.length === 0, `${errors.join(" | ") || "aucune"} ; 5xx : ${[...new Set(failed)].join(", ") || "aucune"}`);
process.exit(summary() ? 0 : 1);
