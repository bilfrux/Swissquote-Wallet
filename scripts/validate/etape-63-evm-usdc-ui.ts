// Étape 63 : envoi d'USDC depuis l'interface avec la biométrie, sur le VRAI Sepolia, sans ETH (Chrome headless).
// `validate:54` couvre création, activation, refus et recovery sur un Safe neuf, donc sans USDC. Ici : le Safe de démo
// de CH-0003, qui détient des USDC, est récupéré vers une nouvelle clé (biométrie), puis cette clé envoie 1 USDC par
// « Send USDC », qui prépare l'opération puis ouvre lui-même le Client Wallet (étape 35).
// Pile isolée : bank-mock :4630 sur une COPIE de bank-mock/data (vraie clé Swissquote, compte et Safe de démo ; la passkey
// bancaire de CH-0003 est retirée de la copie seulement, pour que le test active la sienne), Client Wallet :5230 neuf,
// appli :5231 (signet), console du contact :5232. Les données de démo d'origine ne sont pas modifiées.
// Prérequis : .local/signet-ui/state.json (phrase du contact de démo) ; accès à Sepolia et aux points publics de Candide.
// Effet on-chain : le Safe de démo change de propriétaire ; la nouvelle clé n'existe que dans l'authentificateur virtuel.
import { type ChildProcess, spawn } from "node:child_process";
import { cpSync, readFileSync, rmSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { type BrowserContext, type Page, chromium } from "playwright-core";
import { getAddress, parseUnits, type Address } from "viem";
import { USDC_DECIMALS, publicClient, readState as readLatest, recoveryNonce } from "@sq/evm";
import { evmAddressFromMnemonic } from "@sq/evm/keys";
import { makeReport } from "./lib.ts";

const BANK = "http://localhost:4630", WALLET = "http://localhost:5230", APP = "http://localhost:5231", CONSOLE = "http://localhost:5232";
const DATA = `${process.cwd()}/.local/e2e-63`;
const state = JSON.parse(readFileSync(".local/signet-ui/state.json", "utf8"));
rmSync(DATA, { recursive: true, force: true });
cpSync("bank-mock/data", `${DATA}/bank`, { recursive: true });
{ const db = new DatabaseSync(`${DATA}/bank/bank-mock.sqlite`); db.prepare("delete from passkeys where customer_id = ?").run("CH-0003"); db.close(); }
const procs: ChildProcess[] = [];
const start = (cmd: string[], env: Record<string, string>, cwd = ".") => procs.push(spawn(cmd[0], cmd.slice(1), { cwd, env: { ...process.env, ...env }, stdio: "ignore", detached: true }));
process.on("exit", () => procs.forEach((p) => { try { process.kill(-p.pid!, "SIGTERM"); } catch {} }));
start(["npm", "run", "-s", "dev", "-w", "bank-mock"], { BANK_MOCK_PORT: "4630", BANK_MOCK_DATA: `${DATA}/bank`, BANK_MOCK_ORIGINS: `${APP},${CONSOLE}`, ALERT_INTERVAL_MS: "0", ALERT_SIGNET_INTERVAL_MS: "0" });
start(["npm", "run", "-s", "dev", "-w", "client-wallet"], { CLIENT_WALLET_PORT: "5230", CLIENT_WALLET_DATA: `${DATA}/wallet`, VITE_WALLET_ALLOWED_ORIGINS: APP });
start(["npx", "vite", "--port", "5231", "--strictPort"], { VITE_BTC_NETWORK: "signet", VITE_BANK_MOCK_URL: BANK, VITE_CLIENT_WALLET_URL: WALLET, VITE_GUARDIAN_CONSOLE_URL: CONSOLE }, "client");
start(["npx", "vite", "--port", "5232", "--strictPort"], { VITE_BTC_NETWORK: "signet", VITE_BANK_MOCK_URL: BANK }, "guardian-console");
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
// Authentificateur WebAuthn virtuel avec PRF (même réglage que validate:54).
const addAuthenticator = async (ctx: BrowserContext, p: Page) => {
  const cdp = await ctx.newCDPSession(p);
  await cdp.send("WebAuthn.enable");
  await cdp.send("WebAuthn.addVirtualAuthenticator", { options: { protocol: "ctap2", transport: "internal", hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true, hasPrf: true } } as any);
};
// Fenêtre du Client Wallet : ouverte une fois (avec son authentificateur), puis réutilisée par l'appli (window.open nommé).
// Une passkey ne quitte pas l'onglet qui l'a créée avec son secret PRF : la fenêtre doit rester la même.
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
const shot = (p: Page, n: string) => p.screenshot({ path: `${SHOTS}/etape-63-${n}.png`, fullPage: true });
let atBlock: bigint | undefined;
const seen = async (text: string) => { const h = text.match(/0x[0-9a-f]{64}/)?.[0] as `0x${string}` | undefined; if (h) atBlock = (await publicClient.waitForTransactionReceipt({ hash: h })).blockNumber; return h; };
async function readState(safe: Address) { for (let i = 0; ; i++) { try { return await readLatest(safe, atBlock); } catch (e) { if (i > 15) throw e; await new Promise((r) => setTimeout(r, 2000)); } } }
const screenOf = async (p: Page) => { await p.getByRole("heading", { name: "Confirm the Ethereum operation" }).waitFor({ timeout: 90000 }); return (await p.locator("section").first().textContent()) ?? ""; };

try {
  // --- Appareil du client : biométrie bancaire activée, wallet Bitcoin de démo connu de l'appareil (clés publiques) ---
  const ctx = await device();
  const app = await ctx.newPage();
  await addAuthenticator(ctx, app);
  await app.goto(APP);
  await app.getByRole("button", { name: "Login", exact: true }).click();
  await app.getByLabel("Username").fill("CH-0003");
  await app.getByLabel("Password", { exact: true }).fill("demo0003");
  await app.getByRole("button", { name: "Log in", exact: true }).click();
  await openCrypto(app);
  const token = JSON.parse(await app.evaluate(() => sessionStorage.getItem("sq-bank:session") ?? "null"))?.token;
  const listed = (await (await fetch(`${BANK}/wallet/accounts?network=signet`, { headers: { authorization: `Bearer ${token}` } })).json()) as any;
  const btc = listed.accounts.at(-1);
  if (!btc) throw new Error(`no signet Bitcoin account for CH-0003 in the demo data: ${JSON.stringify(listed)}`);
  // Comme validate:40 : un appareil qui a déjà le wallet le connaît par son stockage local (clés publiques seulement).
  await app.evaluate(([k, v]) => localStorage.setItem(k, v), ["sq-wallet:btc:signet:CH-0003", JSON.stringify(btc)] as const);
  await app.reload();
  await openCrypto(app);
  await app.getByTestId("btc-balance").waitFor({ timeout: 30000 });
  await toEthereum(app);
  const card = app.getByTestId("evm-card");
  await card.getByTestId("evm-guardians").waitFor({ timeout: 60000 });
  const safe = getAddress((await card.getByTestId("evm-safe").textContent())!.trim());
  const before = await readState(safe);
  const tiersEvm = getAddress(evmAddressFromMnemonic(state.tiersWords.join(" ")));
  report("63-1", "Safe de démo de CH-0003 ouvert depuis l'interface (partie crypto déverrouillée par biométrie) : USDC présents, gardiens dont le contact de démo, seuil 2, aucune recovery en cours",
    before.usdc >= parseUnits("1", USDC_DECIMALS) && before.threshold === 2n && before.guardians.map((a) => getAddress(a)).includes(tiersEvm) && !before.pending,
    `Safe ${safe} ; ${before.usdc} (10^-6 USDC) ; gardiens ${before.guardians.join(", ")} ; propriétaire ${before.owners[0]} ; en cours : ${!!before.pending}`);
  if (before.pending) throw new Error("a recovery is already pending on the demo Safe: wait for it or cancel it first");
  const nonceBefore = await recoveryNonce(safe);

  // --- Recovery vers une nouvelle clé (biométrie), comme validate:54, mais sur un Safe qui détient des fonds ---
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
  const tctx = await device();
  const tiers = await tctx.newPage();
  await tiers.goto(link);
  await tiers.getByTestId("evm-new-owner").waitFor({ timeout: 30000 });
  await tiers.getByPlaceholder("word1 word2 … word24").fill(state.tiersWords.join(" "));
  await tiers.getByRole("button", { name: /Sign as trusted contact/ }).click();
  await tiers.getByTestId("relay-sent").waitFor({ timeout: 90000 });
  await rec.getByRole("button", { name: "Fetch the trusted contact's signature" }).click();
  await rec.getByRole("button", { name: "Start the recovery" }).click();
  await inWallet(ctx, () => card.getByRole("button", { name: "Sign with my Client Wallet" }).click({ timeout: 120000 }));
  await screenOf(w!);
  await w!.getByRole("button", { name: "Confirm and sign" }).click();
  await seen((await card.getByText(/^Recovery started: 0x/).textContent({ timeout: 240000 })) ?? "");
  const fin = rec.getByRole("button", { name: "Complete the recovery" });
  await fin.waitFor({ timeout: 420000 });
  await fin.click();
  await inWallet(ctx, () => card.getByRole("button", { name: "Sign with my Client Wallet" }).click({ timeout: 120000 }));
  await screenOf(w!);
  await w!.getByRole("button", { name: "Confirm and sign" }).click();
  const finalized = (await card.getByText(/^Recovery completed: 0x/).textContent({ timeout: 240000 })) ?? "";
  await seen(finalized);
  const after = await readState(safe);
  report("63-2", "Recovery du Safe de démo (Swissquote avec sa vraie clé + contact) vers une nouvelle clé biométrique ; les USDC restent sur le Safe",
    after.owners.length === 1 && getAddress(after.owners[0]) === newOwner && !after.pending && after.usdc === before.usdc,
    `${finalized.trim()} ; propriétaire ${after.owners[0]} ; solde ${after.usdc}`);
  await inWallet(ctx, () => card.getByRole("button", { name: "Sign with my Client Wallet" }).click({ timeout: 120000 }));
  await screenOf(w!);
  await w!.getByRole("button", { name: "Confirm and sign" }).click();
  await card.getByText(/^Leftover guardian signatures invalidated: 0x/).waitFor({ timeout: 240000 });
  await seen((await card.getByTestId("evm-last-tx").textContent()) ?? "");
  const nonceAfter = await recoveryNonce(safe, atBlock);
  report("63-3", "La nouvelle clé invalide les signatures de gardiens restantes", nonceAfter >= nonceBefore + 2n, `nonce ${nonceBefore} -> ${nonceAfter}`);

  // --- Envoi d'1 USDC : « Send USDC » prépare l'opération puis ouvre lui-même le Client Wallet (étape 35). S'il était
  // bloqué, le bandeau « Sign with my Client Wallet » resterait comme repli : on note ce qui s'est passé.
  const usdcBefore = (await readState(safe)).usdc;
  await card.getByRole("button", { name: "Send", exact: true }).click();
  await card.getByPlaceholder("0x…").fill(tiersEvm);
  await card.getByPlaceholder("1").fill("1");
  const reloaded = w!.waitForEvent("load", { timeout: 90000 }).then(() => true, () => false);
  await card.getByRole("button", { name: "Send USDC" }).click();
  const direct = await reloaded;
  if (!direct) await inWallet(ctx, () => card.getByRole("button", { name: "Sign with my Client Wallet" }).click());
  const sendScreen = await screenOf(w!);
  await shot(w!, "1-envoi-usdc-wallet");
  await w!.getByRole("button", { name: "Confirm and sign" }).click();
  const sent = (await card.getByText(/^USDC sent: 0x/).textContent({ timeout: 240000 })) ?? "";
  await seen(sent);
  const usdcAfter = (await readState(safe)).usdc;
  const eth = await publicClient.getBalance({ address: safe, blockNumber: atBlock });
  await shot(app, "2-envoi-usdc");
  report("63-4", "Envoi d'1 USDC depuis l'interface : écran du Client Wallet en clair, signé par biométrie, frais parrainés (0 ETH sur le Safe)",
    usdcBefore - usdcAfter === parseUnits("1", USDC_DECIMALS) && sendScreen.includes("Send 1 USDC") && sendScreen.includes("paid by a sponsor") && eth === 0n,
    `${sent.trim()} ; solde ${usdcBefore} -> ${usdcAfter} (10^-6 USDC) ; ETH ${eth} ; fenêtre ouverte directement par « Send USDC » : ${direct ? "oui" : "non (repli par le bandeau)"} ; écran : ${sendScreen.replace(/\s+/g, " ").slice(0, 200)}`);
} finally {
  await browser.close();
}
report("63-x", "Aucune erreur dans les consoles des navigateurs, aucune réponse 5xx", errors.length === 0 && failed.length === 0, `${errors.join(" | ") || "aucune"} ; 5xx : ${failed.join(", ") || "aucune"}`);
process.exit(summary() ? 0 : 1);
