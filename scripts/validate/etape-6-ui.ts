// Étape 6 : interface bancaire + « Wallet du client » (appli séparée), de bout en bout dans Chrome headless (regtest).
// Prérequis : npm run regtest:up ; console guardian lancée (CONSOLE_URL, défaut 5174).
// Le test lance SA PROPRE pile isolée (stockages neufs) : bank-mock :4110, Wallet du client :5190, appli :5191.
// Client de test : CH-0003 (client de démo vierge).
import { type ChildProcess, spawn } from "node:child_process";
import { mkdirSync, readFileSync, rmSync } from "node:fs";
import { type BrowserContext, type Page, chromium } from "playwright-core";
import { buildSpend, createWalletConfig, outputAt, scan } from "@sq/bitcoin";
import { makeReport, miner, rpc } from "./lib.ts";

const APP = "http://localhost:5191";
const BANK = "http://localhost:4110";
const WALLET = "http://localhost:5190";
const CONSOLE = process.env.CONSOLE_URL ?? "http://localhost:5174";
const DATA = `${process.cwd()}/.local/e2e-6`;
const WALLET_FILE = `${DATA}/wallet/wallets.json`;
const BANK_DB = `${DATA}/bank/bank-mock.sqlite`;

// --- Pile isolée ---
rmSync(DATA, { recursive: true, force: true });
const procs: ChildProcess[] = [];
const start = (cmd: string[], env: Record<string, string>, cwd = ".") => procs.push(spawn(cmd[0], cmd.slice(1), { cwd, env: { ...process.env, ...env }, stdio: "ignore", detached: true }));
start(["npm", "run", "-s", "dev", "-w", "bank-mock"], { BANK_MOCK_PORT: "4110", BANK_MOCK_DATA: `${DATA}/bank`, BANK_MOCK_ORIGINS: APP });
start(["npm", "run", "-s", "dev", "-w", "client-wallet"], { CLIENT_WALLET_PORT: "5190", CLIENT_WALLET_DATA: `${DATA}/wallet`, VITE_WALLET_ALLOWED_ORIGINS: APP });
start(["npx", "vite", "--port", "5191", "--strictPort"], { VITE_BTC_NETWORK: "regtest", VITE_BANK_MOCK_URL: BANK, VITE_CLIENT_WALLET_URL: WALLET, VITE_GUARDIAN_CONSOLE_URL: CONSOLE }, "client");
const stopAll = () => procs.forEach((p) => { try { process.kill(-p.pid!, "SIGTERM"); } catch {} });
for (const u of [`${BANK}/health`, `${WALLET}/api/wallets`, APP]) {
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
};
// MOBILE=1 : mise en page téléphone (390×844, tactile) ; sinon ordinateur.
const MOBILE = process.env.MOBILE === "1";
const device = async () => {
  const ctx = await browser.newContext(MOBILE ? { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 } : { viewport: { width: 1280, height: 1000 } });
  ctx.on("page", watch);
  return ctx;
};
const shot = (p: Page, n: string) => p.screenshot({ path: `${SHOTS}/etape-6-${MOBILE ? "mobile" : "desktop"}-${n}.png`, fullPage: true });
const popupOf = async (ctx: BrowserContext, click: () => Promise<void>) => { const [p] = await Promise.all([ctx.waitForEvent("page"), click()]); await p.waitForLoadState(); return p; };
const login = async (p: Page) => {
  await p.goto(APP);
  await p.evaluate(() => { localStorage.clear(); sessionStorage.clear(); });
  await p.reload();
  await p.getByLabel("Identifiant client").fill("CH-0003");
  await p.getByLabel("Mot de passe").fill("demo0003");
  await p.getByRole("button", { name: "Se connecter" }).click();
};

try {
  // --- Tiers : crée son identité dans la console (phrase affichée une fois) ---
  const tiersCtx = await device();
  const tiers = await tiersCtx.newPage();
  await tiers.goto(CONSOLE);
  await tiers.getByRole("button", { name: "Créer mon identité de tiers" }).click();
  const tiersWords = (await tiers.locator(".identity-words li").allTextContents()).map((w) => w.trim());
  const tiersKey = (await tiers.locator(".identity-key").textContent())!.trim();
  await tiers.getByRole("button", { name: /J'ai noté ma phrase/ }).click();
  const stillShown = await tiers.locator(".identity-words li").count();
  report("6-1", "Console : identité de tiers créée, phrase affichée une fois puis masquée, clé publique fournie", tiersWords.length === 24 && stillShown === 0 && tiersKey.includes("tpub"),
    `${tiersWords.length} mots, puis ${stillShown} affiché(s) ; clé ${tiersKey.slice(0, 30)}…`);

  // --- Banque : connexion ---
  const ctxA = await device();
  const app = await ctxA.newPage();
  await app.goto(APP);
  await app.evaluate(() => { localStorage.clear(); sessionStorage.clear(); });
  await app.reload();
  await app.getByLabel("Identifiant client").fill("CH-0003");
  await app.getByLabel("Mot de passe").fill("faux");
  const errorsBeforeLogin = errors.length;
  await app.getByRole("button", { name: "Se connecter" }).click();
  const badLogin = await app.locator(".error").textContent();
  errors.splice(errorsBeforeLogin); // le 403 du mauvais mot de passe, volontaire, est attendu
  await shot(app, "1-connexion");
  await app.getByLabel("Mot de passe").fill("demo0003");
  await app.getByRole("button", { name: "Se connecter" }).click();
  await app.getByText(MOBILE ? "Épargne" : "Compte privé").first().waitFor();
  await app.getByText(/8[’']420\.15/).first().waitFor(); // comptes CHF chargés
  const overview = await app.locator("main").textContent();
  report("6-2", "Connexion e-banking simulée (mauvais mot de passe refusé), aperçu avec comptes CHF et tuile « Créer mon wallet »",
    !!badLogin?.includes("incorrect") && (MOBILE ? !!overview?.includes("Valeur totale") && !!overview?.includes("Cash") && !!overview?.includes("Créer") : !!overview?.includes("Compte privé") && !!overview?.includes("Créer mon wallet")), `${badLogin} ; aperçu affiché`);
  await shot(app, "2-apercu");

  // --- Wallet crypto : création via le Wallet du client ---
  await app.getByRole("button", { name: "Crypto", exact: true }).click();
  await app.getByPlaceholder("Marie Dupont").fill("Marie Dupont");
  await app.getByLabel("Clé publique du tiers").fill(tiersKey);
  const wallet = await popupOf(ctxA, () => app.getByRole("button", { name: "Créer mon wallet avec le Wallet du client" }).click());
  await wallet.getByRole("button", { name: "Générer ma phrase secrète" }).click();
  await wallet.locator(".words li").nth(23).waitFor();
  const clientWords = (await wallet.locator(".words li").allTextContents()).map((w) => w.trim());
  await shot(wallet, "3-wallet-phrase");
  await wallet.getByLabel("J'ai noté ma phrase en lieu sûr").check();
  await wallet.getByRole("button", { name: "Transmettre ma clé publique à Swissquote" }).click();
  await app.getByTestId("btc-balance").waitFor({ timeout: 20000 });
  const stored = JSON.parse(readFileSync(WALLET_FILE, "utf8")) as any[];
  const mine_ = stored[stored.length - 1];
  report("6-3", "Wallet du client : 24 mots générés et affichés une fois ; la banque reçoit la clé publique, la politique est enregistrée dans le wallet",
    clientWords.length === 24 && mine_.mnemonic === clientWords.join(" ") && !!mine_.policy && mine_.policy.tiersName === "Marie Dupont",
    `wallet ${mine_.id}, politique : délai ${mine_.policy?.delay}, tiers ${mine_.policy?.tiersName} ; mots=${clientWords.length}, phrase stockée = phrase affichée : ${mine_.mnemonic === clientWords.join(" ")}, wallets stockés=${stored.length}`);

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
  await app.getByRole("button", { name: "Actualiser" }).click();
  await app.getByText("0.50000000 BTC").first().waitFor({ timeout: 15000 });
  await shot(app, "4-wallet");
  report("6-5", "Réception : 0,5 BTC visibles dans l'onglet Crypto", true, address);

  // --- Preuve de propriété : défi Swissquote, signature dans le Wallet du client, vérification ---
  await app.getByRole("button", { name: "Prouver à Swissquote que je contrôle cette adresse" }).click();
  await wallet.getByRole("heading", { name: "Prouver la propriété d'une adresse" }).waitFor({ timeout: 15000 });
  const challengeShown = (await wallet.locator(".message").textContent()) ?? "";
  await shot(wallet, "4b-wallet-preuve");
  await wallet.getByRole("button", { name: "Signer la preuve" }).click();
  const proofText = (await app.getByTestId("ownership-result").textContent({ timeout: 15000 })) ?? "";
  report("6-13", "Preuve de propriété depuis l'interface : défi affiché en entier dans le wallet, signé après confirmation, vérifié par Swissquote",
    challengeShown.includes("Swissquote · preuve de propriété") && challengeShown.includes(address) && proofText.startsWith("Propriété vérifiée") && proofText.includes(address),
    proofText.slice(0, 220));

  if (MOBILE) {
    const width = await app.evaluate(() => ({ inner: innerWidth, doc: document.documentElement.scrollWidth }));
    report("6-14", "Téléphone : aucune page plus large que l'écran (390 px), même avec les adresses longues affichées", width.inner === 390 && width.doc <= 390, JSON.stringify(width));
  }

  // --- Envoi : refus, puis confirmation dans le Wallet du client ---
  await app.getByPlaceholder("tb1… / bcrt1…").fill(minerAddr);
  await app.getByPlaceholder("0.0001").fill("0.1");
  await app.getByRole("button", { name: "Préparer l'envoi" }).click();
  await app.getByRole("button", { name: "Signer avec mon Wallet du client" }).click();
  await wallet.getByRole("heading", { name: "Confirmer l'envoi" }).waitFor({ timeout: 15000 });
  await wallet.getByRole("button", { name: "Refuser" }).click();
  const refused = await app.locator(".error").last().textContent({ timeout: 10000 });
  await app.getByRole("button", { name: "Signer avec mon Wallet du client" }).click();
  await wallet.getByRole("heading", { name: "Confirmer l'envoi" }).waitFor({ timeout: 15000 });
  const confirm = (await wallet.locator("section").first().textContent()) ?? "";
  await shot(wallet, "5-wallet-confirmation");
  await wallet.getByRole("button", { name: "Confirmer et signer" }).click();
  await app.getByRole("button", { name: "Diffuser sur le réseau Bitcoin" }).click();
  const sent = await app.locator(".success", { hasText: "Transaction diffusée" }).textContent({ timeout: 15000 });
  const txid = sent?.match(/[0-9a-f]{64}/)?.[0];
  await mine(1);
  const tx = txid ? await rpc.call("getrawtransaction", [txid, true]) : null;
  report("6-6", "Envoi : refus dans le wallet remonté à l'appli ; écran de confirmation (chemin, sorties, montants, frais) ; signé, diffusé, confirmé",
    !!refused?.includes("refusé par le client") && confirm.includes("votre clé seule") && confirm.includes(minerAddr) && confirm.includes("0.10000000 BTC") && confirm.includes("change (votre compte)") && confirm.includes("Frais") && tx?.confirmations === 1,
    `refus : « ${refused?.trim()} » ; écran : ${confirm.replace(/\s+/g, " ").slice(0, 200)}… ; confirmations=${tx?.confirmations}`);
  await shot(app, "6-envoi");

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
  await app.getByRole("button", { name: "Actualiser" }).click();
  await app.getByText(/0\.399/).first().waitFor({ timeout: 15000 });
  await app.getByRole("button", { name: "Accueil", exact: true }).click();
  const tile = await app.getByTestId("home-crypto").textContent();
  report("6-8", "Accueil : la ligne / tuile Crypto affiche le solde du wallet (contre-valeur CHF)", MOBILE ? /33[’']99\d\.\d\d/.test(tile ?? "") : !!tile?.includes("0.39") && !!tile?.includes("CHF"), tile?.replace(/\s+/g, " ") ?? "");

  // --- Perte du wallet, puis recovery depuis un NOUVEL appareil ---
  const lost = await ctxA.newPage();
  await lost.goto(WALLET);
  const card = lost.locator(".card", { hasText: mine_.id });
  await card.getByRole("button", { name: "Simuler la perte de cet appareil" }).click();
  await card.getByRole("button", { name: "Effacer définitivement" }).click();
  await lost.getByText("Aucun wallet sur cet appareil.").waitFor({ timeout: 10000 });
  const afterLoss = (JSON.parse(readFileSync(WALLET_FILE, "utf8")) as any[]).some((w) => w.id === mine_.id);

  const ctxB = await device();
  const nd = await ctxB.newPage();
  await login(nd);
  await nd.getByRole("button", { name: "Crypto", exact: true }).click();
  await nd.getByTestId("btc-balance").waitFor({ timeout: 20000 });
  await nd.getByRole("button", { name: /J'ai perdu mon wallet/ }).click();
  const kyc = nd.locator(".step").first().locator("input");
  await kyc.nth(0).fill("Martin");
  await kyc.nth(1).fill("1992-03-21");
  await kyc.nth(2).fill("246810");
  await nd.getByRole("button", { name: "Vérifier mon identité" }).click();
  await nd.locator("p", { hasText: mine_.accountKey.slice(0, 22) }).getByRole("button", { name: "Choisir" }).click();
  const newWallet = await popupOf(ctxB, () => nd.getByRole("button", { name: "Créer un nouveau wallet avec le Wallet du client" }).click());
  await newWallet.getByRole("button", { name: "Générer ma phrase secrète" }).click();
  await newWallet.getByLabel("J'ai noté ma phrase en lieu sûr").check();
  await newWallet.getByRole("button", { name: "Transmettre ma clé publique à Swissquote" }).click();
  await nd.getByRole("button", { name: "Préparer la demande" }).click({ timeout: 20000 });
  await nd.getByRole("button", { name: "Demander la signature de Swissquote" }).click();
  const sqPsbt = await nd.locator(".step textarea[readonly]").inputValue({ timeout: 15000 });
  await tiers.getByPlaceholder(/PSBT reçu du client/).fill(sqPsbt);
  await tiers.getByPlaceholder("mot1 mot2 … mot24").fill(tiersWords.join(" "));
  await tiers.getByRole("button", { name: "Signer en tant que tiers" }).click();
  const tiersPsbt = await tiers.locator(".step textarea[readonly]").inputValue();
  await nd.getByPlaceholder("PSBT signé par le tiers (cHNidP8…)").fill(tiersPsbt);
  await nd.getByRole("button", { name: "Ajouter la signature du tiers" }).click();
  await nd.getByRole("button", { name: "Diffuser la recovery" }).click();
  const early = await nd.locator(".step .error").last().textContent({ timeout: 15000 });
  await shot(nd, "7-recovery-refus");
  await mine(D);
  await nd.getByRole("button", { name: "Diffuser la recovery" }).click();
  await nd.locator(".success", { hasText: "Recovery diffusée" }).waitFor({ timeout: 15000 });
  await mine(1);
  await nd.getByRole("button", { name: "Ouvrir mon nouveau compte" }).click();
  await nd.getByText("Recovery terminée").waitFor({ timeout: 20000 });
  try { await nd.getByText(/0\.399/).first().waitFor({ timeout: 20000 }); }
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
  report("6-12", "Le Wallet du client refuse de signer un PSBT de recovery, même appelé directement", rs.status === 400 && /chemin de recovery/.test(rj.error), `${rs.status} ${rj.error}`);

  // --- Onglet Démo ---
  await nd.getByRole("button", { name: "Démo", exact: true }).click();
  const attacks = await nd.locator(".attack button").count();
  report("6-10", "Onglet « Démo » (regtest) avec les trois scénarios d\x27attaque", attacks === 3, `${attacks} boutons`);
} finally {
  await browser.close();
  stopAll();
}
report("6-11", "Aucune erreur dans les consoles des navigateurs (hors refus volontaires : mauvais mot de passe en 6-2, appel interdit en 6-7)", errors.length === 0, errors.join(" | ") || "aucune");
process.exit(summary() ? 0 : 1);
