// Étape 6 : interface bancaire + « Wallet du client » (appli séparée), de bout en bout dans Chrome headless (regtest).
// Prérequis : npm run regtest:up ; console guardian lancée (CONSOLE_URL, défaut 5174).
// Le test lance SA PROPRE pile isolée (stockages neufs) : bank-mock :4110, Wallet du client :5190, appli :5191.
// Client de test : CH-0003 (client de démo vierge).
import { type ChildProcess, spawn } from "node:child_process";
import { mkdirSync, readFileSync, rmSync } from "node:fs";
import { type BrowserContext, type Page, chromium } from "playwright-core";
import { buildSpend, createWalletConfig, outputAt, scan } from "@sq/bitcoin";
import { makeReport, miner, rpc } from "./lib.ts";

// Depuis l'étape 36, le Wallet du client se déverrouille par biométrie (WebAuthn PRF) : chaque fenêtre du wallet reçoit
// un authentificateur virtuel avec PRF (étape 39), qui garde sa passkey tant que la fenêtre reste ouverte.

const APP = "http://localhost:5191";
const BANK = "http://localhost:4110";
const WALLET = "http://localhost:5190";
// Console du tiers : instance propre au test (elle doit joindre le bank-mock du test pour le relais).
const CONSOLE = "http://localhost:5192";
const DATA = `${process.cwd()}/.local/e2e-6`;
const WALLET_FILE = `${DATA}/wallet/wallets.json`;
const BANK_DB = `${DATA}/bank/bank-mock.sqlite`;

// --- Pile isolée ---
rmSync(DATA, { recursive: true, force: true });
const procs: ChildProcess[] = [];
const start = (cmd: string[], env: Record<string, string>, cwd = ".") => procs.push(spawn(cmd[0], cmd.slice(1), { cwd, env: { ...process.env, ...env }, stdio: "ignore", detached: true }));
start(["npm", "run", "-s", "dev", "-w", "bank-mock"], { BANK_MOCK_PORT: "4110", BANK_MOCK_DATA: `${DATA}/bank`, BANK_MOCK_ORIGINS: `${APP},${CONSOLE}` });
start(["npm", "run", "-s", "dev", "-w", "client-wallet"], { CLIENT_WALLET_PORT: "5190", CLIENT_WALLET_DATA: `${DATA}/wallet`, VITE_WALLET_ALLOWED_ORIGINS: APP });
start(["npx", "vite", "--port", "5191", "--strictPort"], { VITE_BTC_NETWORK: "regtest", VITE_BANK_MOCK_URL: BANK, VITE_CLIENT_WALLET_URL: WALLET, VITE_GUARDIAN_CONSOLE_URL: CONSOLE }, "client");
start(["npx", "vite", "--port", "5192", "--strictPort"], { VITE_BTC_NETWORK: "regtest", VITE_BANK_MOCK_URL: BANK }, "guardian-console");
const stopAll = () => procs.forEach((p) => { try { process.kill(-p.pid!, "SIGTERM"); } catch {} });
for (const u of [`${BANK}/health`, `${WALLET}/api/wallets`, APP, CONSOLE]) {
  for (let i = 0; i < 100; i++) { try { if ((await fetch(u)).ok) break; } catch {} await new Promise((r) => setTimeout(r, 200)); }
}
const CHROME = process.env.CHROME_PATH ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const SHOTS = "docs/validation/captures";
const D = 6;
mkdirSync(SHOTS, { recursive: true });
const { report, summary } = makeReport();
const { addr: minerAddr, mine, pay } = await miner();
const browser = await chromium.launch({ executablePath: CHROME, headless: true });
const errors: string[] = [];
const watch = (p: Page) => {
  p.on("pageerror", (e) => errors.push(`${p.url()} : ${e.message}`));
  p.on("console", (m) => m.type() === "error" && !/CORS|Failed to fetch|ERR_FAILED/.test(m.text()) && errors.push(`${p.url()} : ${m.text()}`));
  // Erreurs serveur : on note la requête et la réponse pour le diagnostic.
  p.on("response", async (r) => { if (r.status() >= 500) errors.push(`${r.request().method()} ${r.url()} -> ${r.status()} ${(await r.text().catch(() => "")).slice(0, 200)}`); });
};
// MOBILE=1 : mise en page téléphone (390×844, tactile) ; sinon ordinateur.
const MOBILE = process.env.MOBILE === "1";
const device = async () => {
  const ctx = await browser.newContext(MOBILE ? { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 } : { viewport: { width: 1280, height: 1000 } });
  ctx.on("page", watch);
  return ctx;
};
// Authentificateur WebAuthn virtuel de Chrome (CDP) : simule une passkey avec vérification de l'utilisateur réussie,
// et l'extension PRF (biométrie du Wallet du client).
const addAuthenticator = async (ctx: BrowserContext, p: Page) => {
  const cdp = await ctx.newCDPSession(p);
  await cdp.send("WebAuthn.enable");
  await cdp.send("WebAuthn.addVirtualAuthenticator", { options: { protocol: "ctap2", transport: "internal", hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true, hasPrf: true } } as any);
};
const shot = (p: Page, n: string) => p.screenshot({ path: `${SHOTS}/etape-6-${MOBILE ? "mobile" : "desktop"}-${n}.png`, fullPage: true });
const popupOf = async (ctx: BrowserContext, click: () => Promise<void>) => { const [p] = await Promise.all([ctx.waitForEvent("page"), click()]); await p.waitForLoadState(); await addAuthenticator(ctx, p); return p; };
// Onglet Crypto : depuis l'étape 38, il est verrouillé tant que la biométrie (passkey vérifiée par bank-mock) n'a pas
// été donnée ; il se reverrouille quand on le quitte (étape 39). Renvoie ce qui a été fait.
const openCrypto = async (p: Page): Promise<"enabled" | "unlocked" | "open"> => {
  await p.getByRole("button", { name: "Crypto", exact: true }).click();
  const locked = p.getByTestId("crypto-locked");
  await locked.or(p.getByTestId("btc-balance")).or(p.getByPlaceholder("Marie Dupont")).first().waitFor({ timeout: 20000 });
  if (!(await locked.isVisible())) return "open";
  const enable = p.getByRole("button", { name: "Enable biometrics" });
  const how = (await enable.isVisible()) ? "enabled" : "unlocked";
  await (how === "enabled" ? enable : p.getByRole("button", { name: "Unlock with biometrics" })).click();
  await locked.waitFor({ state: "detached", timeout: 20000 });
  return how;
};
const login = async (p: Page) => {
  await p.goto(APP);
  await p.evaluate(() => { localStorage.clear(); sessionStorage.clear(); });
  await p.reload();
  await p.getByRole("button", { name: "Login", exact: true }).click(); // site public (étape 22)
  await p.getByLabel("Username").fill("CH-0003");
  await p.getByLabel("Password", { exact: true }).fill("demo0003");
  await p.getByRole("button", { name: "Log in", exact: true }).click();
};

try {
  // --- Tiers : crée son identité dans la console (phrase affichée une fois) ---
  const tiersCtx = await device();
  const tiers = await tiersCtx.newPage();
  await tiers.goto(CONSOLE);
  await tiers.getByRole("button", { name: "Create my trusted-contact identity" }).click();
  const tiersWords = (await tiers.locator(".identity-words li").allTextContents()).map((w) => w.trim());
  const tiersKey = (await tiers.locator(".identity-key").textContent())!.trim();
  await tiers.getByRole("button", { name: /I have written down my phrase/ }).click();
  const stillShown = await tiers.locator(".identity-words li").count();
  report("6-1", "Console : identité de tiers créée, phrase affichée une fois puis masquée, clé publique fournie", tiersWords.length === 24 && stillShown === 0 && tiersKey.includes("tpub"),
    `${tiersWords.length} mots, puis ${stillShown} affiché(s) ; clé ${tiersKey.slice(0, 30)}…`);

  // --- Banque : connexion ---
  const ctxA = await device();
  const app = await ctxA.newPage();
  await addAuthenticator(ctxA, app);
  await app.goto(APP);
  await app.evaluate(() => { localStorage.clear(); sessionStorage.clear(); });
  await app.reload();
  await app.getByRole("button", { name: "Login", exact: true }).click(); // site public (étape 22)
  await app.getByLabel("Username").fill("CH-0003");
  await app.getByLabel("Password", { exact: true }).fill("faux");
  const errorsBeforeLogin = errors.length;
  await app.getByRole("button", { name: "Log in", exact: true }).click();
  const badLogin = await app.locator(".error").textContent();
  errors.splice(errorsBeforeLogin); // le 403 du mauvais mot de passe, volontaire, est attendu
  await shot(app, "1-connexion");
  await app.getByLabel("Password", { exact: true }).fill("demo0003");
  await app.getByRole("button", { name: "Log in", exact: true }).click();
  await app.getByText(MOBILE ? "Savings" : "Private account").first().waitFor();
  await app.getByText(/8[’']420\.15/).first().waitFor(); // comptes CHF chargés
  // Partie crypto verrouillée (étape 38) : l'aperçu ne montre pas encore l'état du wallet, seulement la tuile crypto.
  await app.getByText(MOBILE ? "Cash" : /self-custody/i).filter({ visible: true }).first().waitFor();
  const overview = (await app.locator("main").textContent()) ?? "";
  report("6-2", "Connexion e-banking simulée (mauvais mot de passe refusé), aperçu avec comptes CHF et ligne / tuile crypto",
    /incorrect/i.test(badLogin ?? "") && (MOBILE ? overview.includes("Total value") && overview.includes("Cash") && overview.includes("Crypto") : overview.includes("Private account") && /self-custody/i.test(overview)), `${badLogin} ; aperçu affiché`);
  await shot(app, "2-apercu");

  // --- Partie crypto verrouillée (étape 38) : la session bancaire seule ne suffit pas ---
  const session = await app.evaluate(() => JSON.parse(sessionStorage.getItem("sq-bank:session") ?? "null"));
  const auth = { authorization: `Bearer ${session?.token}` };
  const lockedRoute = await fetch(`${BANK}/wallet/accounts?network=regtest`, { headers: auth });
  await app.getByRole("button", { name: "Crypto", exact: true }).click();
  await app.getByTestId("crypto-locked").waitFor({ timeout: 20000 });
  await shot(app, "2b-crypto-verrouille");
  const gate = await openCrypto(app);
  const pk = await fetch(`${BANK}/auth/passkey`, { headers: auth }).then((r) => r.json());
  const unlocked = await fetch(`${BANK}/wallet/accounts?network=regtest`, { headers: auth });
  report("6-17", "Partie crypto verrouillée : route crypto refusée avec la seule session ; biométrie (passkey) activée depuis l'écran verrouillé, puis accès",
    lockedRoute.status === 403 && gate === "enabled" && pk.count === 1 && unlocked.status === 200,
    `session seule : ${lockedRoute.status} ; écran verrouillé puis « ${gate} » ; passkeys : ${pk.count} ; après : ${unlocked.status}`);

  // --- Wallet crypto : création via le Wallet du client ---
  await app.getByPlaceholder("Marie Dupont").fill("Marie Dupont");
  await app.getByLabel("Trusted contact's public key").fill(tiersKey);
  const wallet = await popupOf(ctxA, () => app.getByRole("button", { name: "Create my wallet with the Client Wallet" }).click());
  await wallet.getByRole("button", { name: "Generate my secret phrase" }).click();
  await wallet.locator(".words li").nth(23).waitFor();
  const clientWords = (await wallet.locator(".words li").allTextContents()).map((w) => w.trim());
  await shot(wallet, "3-wallet-phrase");
  await wallet.getByLabel("I have written my phrase down in a safe place").check();
  await wallet.getByRole("button", { name: "Send my public key to Swissquote" }).click();
  // Étape 47 : la politique s'affiche dans le wallet ; le client compare l'empreinte avec celle de la console du contact.
  await wallet.getByRole("button", { name: "Confirm and save" }).waitFor({ timeout: 20000 });
  const policyScreen = (await wallet.getByTestId("policy-contact").textContent()) ?? "";
  const consoleFp = (await tiers.getByTestId("identity-fingerprint").textContent())?.trim() ?? "?";
  await shot(wallet, "3b-wallet-politique");
  await wallet.getByRole("button", { name: "Confirm and save" }).click();
  await app.getByTestId("btc-balance").waitFor({ timeout: 20000 });
  const stored = JSON.parse(readFileSync(WALLET_FILE, "utf8")) as any[];
  const mine_ = stored[stored.length - 1];
  const walletFile = readFileSync(WALLET_FILE, "utf8");
  report("6-3", "Wallet du client : 24 mots générés et affichés une fois, phrase chiffrée par la biométrie (PRF) ; la banque reçoit la clé publique, la politique est enregistrée dans le wallet",
    clientWords.length === 24 && !mine_.mnemonic && !mine_.sealed && mine_.bio?.kdf === "hkdf-sha256-prf" && !walletFile.includes(clientWords.join(" ")) && !!mine_.policy && mine_.policy.tiersName === "Marie Dupont" && policyScreen.includes(consoleFp) && policyScreen.includes("Marie Dupont"),
    `wallet ${mine_.id}, politique confirmée dans le wallet (« ${policyScreen.trim()} », empreinte de la console : ${consoleFp}) : délai ${mine_.policy?.delay}, tiers ${mine_.policy?.tiersName} ; mots=${clientWords.length}, champs stockés : ${Object.keys(mine_).join(", ")}, phrase en clair sur le disque : ${walletFile.includes(clientWords.join(" "))}, wallets stockés=${stored.length}`);

  // Ni la graine, ni la clé privée dans l'appli de la banque ou chez Swissquote
  const appStorage = await app.evaluate(() => JSON.stringify({ ...localStorage }) + JSON.stringify({ ...sessionStorage }) + document.documentElement.outerHTML);
  const bankDb = readFileSync(BANK_DB).toString("latin1");
  const phrase = clientWords.join(" ");
  report("6-4", "La phrase du client n'est ni dans l'appli (stockage, page), ni dans la base de Swissquote ; seule la clé publique y est",
    !appStorage.includes(phrase) && !appStorage.includes(clientWords.slice(0, 4).join(" ")) && !bankDb.includes(phrase) && bankDb.includes(mine_.accountKey.split("]")[1]),
    `phrase dans l'appli : ${appStorage.includes(phrase)} ; 4 premiers mots dans l'appli : ${appStorage.includes(clientWords.slice(0, 4).join(" "))} ; phrase chez Swissquote : ${bankDb.includes(phrase)} ; clé publique chez Swissquote : ${bankDb.includes(mine_.accountKey.split("]")[1])}`);

  // --- Réception ---
  const address = (await app.locator(".address").textContent())!.trim();
  await pay(address, 0.5);
  await mine(1);
  await app.getByRole("button", { name: "Reload" }).click();
  await app.getByText("0.50000000 BTC").first().waitFor({ timeout: 15000 });
  await shot(app, "4-wallet");
  report("6-5", "Réception : 0,5 BTC visibles dans l'onglet Crypto", true, address);

  // --- Preuve de propriété : défi Swissquote, signature dans le Wallet du client, vérification ---
  await app.getByRole("button", { name: "Prove to Swissquote that I control this address" }).click();
  await wallet.getByRole("heading", { name: "Prove ownership of an address" }).waitFor({ timeout: 15000 });
  const challengeShown = (await wallet.locator(".message").textContent()) ?? "";
  await shot(wallet, "4b-wallet-preuve");
  await wallet.getByRole("button", { name: "Sign the proof" }).click();
  const proofText = (await app.getByTestId("ownership-result").textContent({ timeout: 15000 })) ?? "";
  report("6-13", "Preuve de propriété depuis l'interface : défi affiché en entier dans le wallet, signé après confirmation, vérifié par Swissquote",
    challengeShown.includes("Swissquote · proof of ownership") && challengeShown.includes(address) && proofText.startsWith("Ownership verified") && proofText.includes(address),
    proofText.slice(0, 220));

  if (MOBILE) {
    const width = await app.evaluate(() => ({ inner: innerWidth, doc: document.documentElement.scrollWidth }));
    report("6-14", "Téléphone : aucune page plus large que l'écran (390 px), même avec les adresses longues affichées", width.inner === 390 && width.doc <= 390, JSON.stringify(width));
  }

  // --- Envoi : refus, puis confirmation dans le Wallet du client ---
  await app.getByRole("button", { name: "Send", exact: true }).click();
  await app.getByPlaceholder("tb1… / bcrt1…").fill(minerAddr);
  await app.getByPlaceholder("0.0001").fill("0.1");
  const presets = (await app.getByTestId("fee-presets").textContent({ timeout: 15000 })) ?? "";
  await app.getByRole("button", { name: "Prepare the transfer" }).click();
  await app.getByRole("button", { name: "Sign with my Client Wallet" }).click();
  await wallet.getByRole("heading", { name: "Confirm the transfer" }).waitFor({ timeout: 15000 });
  await wallet.getByRole("button", { name: "Refuse" }).click();
  const refused = await app.locator(".error").last().textContent({ timeout: 10000 });
  await app.getByRole("button", { name: "Sign with my Client Wallet" }).click();
  await wallet.getByRole("heading", { name: "Confirm the transfer" }).waitFor({ timeout: 15000 });
  const confirm = (await wallet.locator("section").first().textContent()) ?? "";
  await shot(wallet, "5-wallet-confirmation");
  await wallet.getByRole("button", { name: "Confirm and sign" }).click();
  await app.getByRole("button", { name: "Broadcast on the Bitcoin network" }).click();
  const sent = await app.locator(".success", { hasText: "Transaction broadcast" }).textContent({ timeout: 15000 });
  const txid = sent?.match(/[0-9a-f]{64}/)?.[0];
  await mine(1);
  const tx = txid ? await rpc.call("getrawtransaction", [txid, true]) : null;
  report("6-6", "Envoi : refus dans le wallet remonté à l'appli ; écran de confirmation (chemin, sorties, montants, frais) ; signé, diffusé, confirmé",
    !!refused?.includes("refused by the client") && confirm.includes("your key alone") && confirm.includes(minerAddr) && confirm.includes("0.10000000 BTC") && confirm.includes("change (this account)") && confirm.includes("Fee") && tx?.confirmations === 1,
    `refus : « ${refused?.trim()} » ; écran : ${confirm.replace(/\s+/g, " ").slice(0, 200)}… ; confirmations=${tx?.confirmations}`);
  await shot(app, "6-envoi");

  // --- Historique et frais ---
  await app.getByRole("button", { name: "Reload" }).first().click();
  const hist = app.getByTestId("history");
  await hist.getByText("Sent").waitFor({ timeout: 20000 });
  const histText = (await hist.textContent()) ?? "";
  report("6-16", "Frais : préréglages Économique / Normal / Rapide affichés ; historique : « Reçu » +0,5 BTC et « Envoyé » −0,1 BTC",
    presets.includes("Economy") && presets.includes("Normal") && presets.includes("Fast") && histText.includes("Received") && histText.includes("+0.50000000 BTC") && histText.includes("Sent") && histText.includes("-0.10000000 BTC"),
    `frais : ${presets.replace(/\s+/g, " ").slice(0, 120)} ; historique : ${histText.replace(/\s+/g, " ").slice(0, 200)}`);

  // --- La banque ne peut pas appeler l'API du wallet (signature sans confirmation impossible) ---
  const errorsBefore = errors.length;
  const fromBank = await app.evaluate(async (w) => {
    try { await fetch(`${w}/api/wallets`); return "lecture possible (!)"; } catch { return "lecture bloquée"; }
  }, WALLET);
  await app.waitForTimeout(300);
  errors.splice(errorsBefore); // le 403 de cet appel volontairement interdit est attendu
  const direct = await fetch(`${WALLET}/api/sign`, { method: "POST", headers: { origin: APP, "content-type": "application/json" }, body: JSON.stringify({ psbt: "x", network: "regtest" }) });
  report("6-7", "Depuis l'origine de la banque, l'API du wallet est inaccessible : lecture bloquée (CORS) et POST refusé avant exécution (403)",
    fromBank === "lecture bloquée" && direct.status === 403, `navigateur : ${fromBank} ; POST avec Origin ${APP} : ${direct.status} ${(await direct.json()).error}`);

  // --- Aperçu : la tuile Bitcoin reflète le wallet (après confirmation de l'envoi) ---
  await app.getByRole("button", { name: "Reload" }).click();
  await app.getByText(/0\.399/).first().waitFor({ timeout: 15000 });
  await app.getByRole("button", { name: "Home", exact: true }).click();
  const tile = await app.getByTestId("home-crypto").textContent();
  // Contre-valeur au prix du marché fourni par Swissquote (étape 20), ou au cours simulé s'il est indisponible.
  const px = await fetch(`${BANK}/market/prices`).then((r) => r.json()).then((j) => j.data.bitcoin.chf as number, () => 85000);
  const shown = Number((tile ?? "").replace(/[’'\s]/g, "").match(/(\d+\.\d\d)/)?.[1] ?? NaN);
  report("6-8", "Accueil : la ligne / tuile Crypto affiche le solde du wallet (contre-valeur CHF)", MOBILE ? Math.abs(shown - 0.4 * px) < 0.01 * px : !!tile?.includes("0.39") && !!tile?.includes("CHF"), `${tile?.replace(/\s+/g, " ") ?? ""} ; prix BTC ${px} CHF`);

  // --- Montant élevé : ré-authentification par passkey (Swissquote) + confirmation renforcée dans le wallet ---
  await openCrypto(app);
  await app.getByRole("button", { name: "Send", exact: true }).click();
  await app.getByPlaceholder("tb1… / bcrt1…").fill(minerAddr);
  await app.getByPlaceholder("0.0001").fill("0.25");
  await app.getByRole("button", { name: "Prepare the transfer" }).click();
  const highWarn = (await app.locator(".warning", { hasText: "High-value amount" }).textContent({ timeout: 15000 })) ?? "";
  await app.getByRole("button", { name: "Sign with my Client Wallet" }).click();
  await wallet.getByText("High-value amount").first().waitFor({ timeout: 20000 });
  await shot(wallet, "5b-montant-eleve");
  const highNote = (await app.getByTestId("stepup-note").textContent({ timeout: 15000 })) ?? "";
  await wallet.getByLabel("Last 6 characters of the address").fill(minerAddr.slice(-6));
  await wallet.getByRole("button", { name: "Confirm and sign" }).click();
  await app.getByRole("button", { name: "Broadcast on the Bitcoin network" }).click();
  const bigSent = (await app.locator(".success", { hasText: "Transaction broadcast" }).last().textContent({ timeout: 20000 })) ?? "";
  await mine(1);
  report("6-18", "Montant élevé (0,25 BTC) : avertissement, ré-authentification par passkey auprès de Swissquote, puis 6 derniers caractères de l'adresse + biométrie dans le wallet ; diffusé",
    highWarn.includes("High-value amount") && highNote.includes("confirmed by passkey") && /[0-9a-f]{64}/.test(bigSent), `${highNote} ; ${bigSent.trim().slice(0, 90)}`);

  // --- Perte du wallet, puis recovery depuis un NOUVEL appareil ---
  // Depuis la fenêtre du wallet : c'est elle qui détient la passkey du wallet (l'effacement exige la biométrie, étape 46).
  const lost = wallet;
  await lost.goto(WALLET);
  const card = lost.locator(".card", { hasText: mine_.id });
  await card.getByRole("button", { name: "Simulate losing this device" }).click();
  await card.getByRole("button", { name: "Erase permanently" }).click();
  await lost.getByText("No wallet on this device.").waitFor({ timeout: 10000 });
  const afterLoss = (JSON.parse(readFileSync(WALLET_FILE, "utf8")) as any[]).some((w) => w.id === mine_.id);

  const ctxB = await device();
  const nd = await ctxB.newPage();
  await addAuthenticator(ctxB, nd); // nouvel appareil : sa propre biométrie, sans la passkey de l'ancien
  await login(nd);
  await nd.getByRole("button", { name: "Crypto", exact: true }).click();
  await nd.getByTestId("crypto-locked").waitFor({ timeout: 20000 });
  await nd.getByRole("button", { name: /I lost my device or my biometrics/ }).click();
  const kyc = nd.locator(".step").first().locator("input");
  await kyc.nth(0).fill("Martin");
  await kyc.nth(1).fill("1992-03-21");
  await kyc.nth(2).fill("246810");
  await nd.getByRole("button", { name: "Verify my identity" }).click();
  await nd.locator("p", { hasText: mine_.accountKey.slice(0, 22) }).getByRole("button", { name: "Select" }).click();
  const newWallet = await popupOf(ctxB, () => nd.getByRole("button", { name: "Create a new wallet with the Client Wallet" }).click());
  await newWallet.getByRole("button", { name: "Generate my secret phrase" }).click();
  await newWallet.getByLabel("I have written my phrase down in a safe place").check();
  await newWallet.getByRole("button", { name: "Send my public key to Swissquote" }).click();
  await nd.getByRole("button", { name: "Prepare the request" }).click({ timeout: 20000 });
  await nd.getByRole("button", { name: "Request Swissquote's signature" }).click();
  const sqPsbt = await nd.locator(".step textarea[readonly]").inputValue({ timeout: 15000 });

  // L'ANCIEN appareil du client est alerté : la cloche signale la signature de Swissquote.
  await app.reload();
  await app.getByTestId("bell-count").waitFor({ timeout: 20000 });
  const bellCount = await app.getByTestId("bell-count").textContent();
  await app.getByRole("button", { name: /^Alerts/ }).click();
  const bellText = (await app.getByTestId("bell-panel").textContent()) ?? "";
  await shot(app, "7b-alerte");
  report("6-15", "Alerte : dès que Swissquote signe la recovery, l'ancien appareil du client voit « Swissquote a signé une demande de recovery » dans la cloche",
    Number(bellCount) >= 1 && bellText.includes("Swissquote signed a recovery request"), `non lues : ${bellCount} ; ${bellText.replace(/\s+/g, " ").slice(0, 160)}`);
  // A3 : la demande part au tiers par le relais Swissquote (lien), sans copier-coller de PSBT.
  await nd.getByRole("button", { name: /^Send the request to/ }).click();
  const link = (await nd.getByTestId("relay-link").textContent({ timeout: 10000 }))!;
  await tiers.goto(link);
  await tiers.waitForFunction(() => !!(document.querySelector("textarea[placeholder^='PSBT received']") as HTMLTextAreaElement | null)?.value, null, { timeout: 10000 });
  const loaded = await tiers.getByPlaceholder(/PSBT received from the client/).inputValue();
  await tiers.getByPlaceholder("word1 word2 … word24").fill(tiersWords.join(" "));
  await tiers.getByRole("button", { name: "Sign as trusted contact" }).click();
  await tiers.getByRole("button", { name: "Send back to the client via Swissquote" }).click();
  await tiers.getByTestId("relay-sent").waitFor({ timeout: 10000 });
  await nd.getByRole("button", { name: "Fetch the trusted contact's signature" }).click();
  await nd.getByRole("button", { name: "Broadcast the recovery" }).waitFor({ timeout: 10000 });
  report("6-20", "Recovery sans copier-coller (A3) : demande envoyée au tiers par un lien relayé par Swissquote, PSBT chargé dans sa console, signature renvoyée et récupérée par le client",
    loaded === sqPsbt && link.startsWith(`${CONSOLE}/?req=`), `lien ${link} ; PSBT chargé chez le tiers identique à celui signé par Swissquote : ${loaded === sqPsbt}`);
  await nd.getByRole("button", { name: "Broadcast the recovery" }).click();
  const early = await nd.locator(".step .error").last().textContent({ timeout: 15000 });
  await shot(nd, "7-recovery-refus");
  await mine(D);
  await nd.getByRole("button", { name: "Broadcast the recovery" }).click();
  await nd.locator(".success", { hasText: "Recovery broadcast" }).waitFor({ timeout: 15000 });
  await mine(1);
  await nd.getByRole("button", { name: "Open my new account" }).click();
  await newWallet.getByRole("button", { name: "Confirm and save" }).click({ timeout: 20000 }); // politique du nouveau compte (étape 47)
  await nd.getByText("Recovery complete").waitFor({ timeout: 20000 });
  try { await nd.getByText(/0\.149/).first().waitFor({ timeout: 20000 }); }
  catch (e) { await shot(nd, "8-ECHEC"); console.log("TEXTE DE LA PAGE :", (await nd.locator("main").textContent())?.replace(/\s+/g, " ").slice(0, 1500)); throw e; }
  await shot(nd, "8-nouveau-wallet");
  report("6-9", "Recovery (nouvel appareil, wallet perdu) : re-KYC, nouveau Wallet du client, Swissquote + tiers ; refus réel avant D, succès à D, nouveau wallet actif",
    !afterLoss && !!early?.includes("non-BIP68-final"), `ancien wallet effacé du Wallet du client : ${!afterLoss} ; avant D : ${early?.trim().slice(0, 90)} ; nouveau solde visible`);

  // --- Le wallet refuse de signer un PSBT de recovery (ce chemin ne concerne pas la clé du client) ---
  const nw = (JSON.parse(readFileSync(WALLET_FILE, "utf8")) as any[]).at(-1);
  const ncfg = await createWalletConfig({ ...nw.policy, client: nw.accountKey });
  const recPsbt = (await buildSpend({ cfg: ncfg, backend: rpc, utxos: await scan(ncfg, rpc), path: "recovery", feeRate: 2, to: outputAt(ncfg, 0, 3).getAddress() })).psbt;
  const rs = await fetch(`${WALLET}/api/sign`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ psbt: recPsbt, network: "regtest" }) });
  const rj: any = await rs.json();
  report("6-12", "Le Wallet du client refuse de signer un PSBT de recovery, même appelé directement", rs.status === 400 && /recovery path/.test(rj.error), `${rs.status} ${rj.error}`);

  // --- Compte Swissquote -> wallet : retrait sous la Travel Rule, preuve de propriété automatique ---
  await nd.getByRole("button", { name: "Transfer", exact: true }).click();
  await nd.getByTestId("custody-balance").getByText("BTC").waitFor({ timeout: 15000 });
  const custodyBefore = (await nd.getByTestId("custody-balance").textContent()) ?? "";
  await nd.locator("#transferer").getByPlaceholder("0.1").fill("0.1");
  await nd.getByRole("button", { name: "Transfer to my wallet" }).click();
  await newWallet.getByRole("heading", { name: "Prove ownership of an address" }).waitFor({ timeout: 20000 });
  await newWallet.getByRole("button", { name: "Sign the proof" }).click();
  const tr = (await nd.getByTestId("transfer-result").textContent({ timeout: 30000 })) ?? "";
  const trTxid = tr.match(/[0-9a-f]{64}/)?.[0];
  await mine(1);
  const trList = (await nd.getByTestId("travel-rule").textContent({ timeout: 15000 })) ?? "";
  await shot(nd, "9-transfert-travel-rule");
  const onChain = trTxid ? await rpc.call("getrawtransaction", [trTxid, true]) : null;
  report("6-19", "Retrait compte Swissquote → wallet : preuve de propriété demandée automatiquement au Wallet du client (Travel Rule), envoi on-chain, enregistrement Travel Rule affiché",
    custodyBefore.includes("BTC") && !!trTxid && onChain?.confirmations === 1 && trList.includes("Withdrawal to wallet") && trList.includes("proof of ownership"),
    `compte Swissquote avant : ${custodyBefore} ; ${tr.trim().slice(0, 90)} ; ${trList.replace(/\s+/g, " ").slice(0, 160)}`);

  // --- Onglet Démo ---
  await nd.getByRole("button", { name: "Demo", exact: true }).click();
  const attacks = await nd.locator(".attack button").count();
  report("6-10", "Onglet « Démo » (regtest) avec les trois scénarios d\x27attaque", attacks === 3, `${attacks} boutons`);
} catch (e) {
  // Diagnostic : texte de chaque page ouverte au moment de l'échec.
  for (const c of browser.contexts()) for (const p of c.pages()) console.log(`PAGE ${p.url()} :`, ((await p.locator("body").textContent().catch(() => "")) ?? "").replace(/\s+/g, " ").slice(0, 800));
  console.log("ERREURS :", errors.join(" | "));
  throw e;
} finally {
  await browser.close();
  stopAll();
}
report("6-11", "Aucune erreur dans les consoles des navigateurs (hors refus volontaires : mauvais mot de passe en 6-2, appel interdit en 6-7)", errors.length === 0, errors.join(" | ") || "aucune");
process.exit(summary() ? 0 : 1);
