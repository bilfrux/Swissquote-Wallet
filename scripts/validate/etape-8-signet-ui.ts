// Étape 8 : le parcours de l'INTERFACE sur le vrai réseau signet (Chrome headless), en trois phases :
//   npm run validate:8:signet -- create    wallet CH-0003 créé via le Wallet du client + preuve de propriété (sans fonds)
//   npm run validate:8:signet -- spend     après financement (faucet) : envoi signé dans le Wallet du client, diffusé
//   npm run validate:8:signet -- recover   après D = 6 confirmations : perte du wallet, recovery Swissquote + tiers
// Prérequis : npm run demo:signet (appli :5173, bank-mock :4000, console CONSOLE_URL, wallet :5180).
// État de test (phrase du tiers incluse) : .local/signet-ui/state.json (ignoré par git).
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { type BrowserContext, type Page, chromium } from "playwright-core";
import { EsploraBackend, createWalletConfig, outputAt } from "@sq/bitcoin";
import { makeReport } from "./lib.ts";

const APP = "http://localhost:5173", WALLET = "http://localhost:5180";
const CONSOLE = process.env.CONSOLE_URL ?? "http://localhost:5174";
const EXPLORER = "https://blockstream.info/signet";
const chain = new EsploraBackend("https://blockstream.info/signet/api");
const DIR = ".local/signet-ui";
const STATE = `${DIR}/state.json`;
const SHOTS = "docs/validation/captures";
mkdirSync(DIR, { recursive: true });
mkdirSync(SHOTS, { recursive: true });
const state = existsSync(STATE) ? JSON.parse(readFileSync(STATE, "utf8")) : {};
const saveState = () => writeFileSync(STATE, JSON.stringify(state, null, 2), { mode: 0o600 });
const phase = process.argv[2] ?? "create";
const { report, summary } = makeReport();
const PIN = "482916";
// Saisit le PIN si le wallet est protégé (les wallets créés avant le PIN n'en ont pas).
const typePinIfAsked = async (w: Page) => { const box = w.getByLabel("Code PIN du wallet"); if (await box.count()) await box.fill(PIN); };
const choosePin = async (w: Page) => { await w.getByLabel("Nouveau code PIN (6 à 12 chiffres)").fill(PIN); await w.getByLabel("Confirmer le code PIN").fill(PIN); };

const browser = await chromium.launch({ executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: true });
const errors: string[] = [];
const device = async () => {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 1000 } });
  ctx.on("page", (p) => { p.on("pageerror", (e) => errors.push(e.message)); p.on("console", (m) => m.type() === "error" && errors.push(m.text())); });
  return ctx;
};
const shot = (p: Page, n: string) => p.screenshot({ path: `${SHOTS}/etape-8-${n}.png`, fullPage: true });
const popupOf = async (ctx: BrowserContext, click: () => Promise<void>) => { const [p] = await Promise.all([ctx.waitForEvent("page"), click()]); await p.waitForLoadState(); return p; };
async function login(ctx: BrowserContext) {
  const p = await ctx.newPage();
  await p.goto(APP);
  await p.evaluate(() => { localStorage.clear(); sessionStorage.clear(); });
  await p.reload();
  await p.getByLabel("Identifiant client").fill("CH-0003");
  await p.getByLabel("Mot de passe").fill("demo0003");
  await p.getByRole("button", { name: "Se connecter", exact: true }).click();
  await p.getByRole("button", { name: "Crypto", exact: true }).click();
  return p;
}

try {
  if (phase === "create") {
    const tiersCtx = await device();
    const tiers = await tiersCtx.newPage();
    await tiers.goto(CONSOLE);
    await tiers.getByRole("button", { name: "Créer mon identité de tiers" }).click();
    state.tiersWords = (await tiers.locator(".identity-words li").allTextContents()).map((w) => w.trim());
    state.tiersKey = (await tiers.locator(".identity-key").textContent())!.trim();
    await tiers.getByRole("button", { name: /J'ai noté ma phrase/ }).click();

    const ctx = await device();
    const app = await login(ctx);
    await app.getByPlaceholder("Marie Dupont").fill("Marie Dupont");
    await app.getByLabel("Clé publique du tiers").fill(state.tiersKey);
    const wallet = await popupOf(ctx, () => app.getByRole("button", { name: "Créer mon wallet avec le Wallet du client" }).click());
    await choosePin(wallet);
    await wallet.getByRole("button", { name: "Générer ma phrase secrète" }).click();
    await wallet.locator(".words li").nth(23).waitFor();
    await wallet.getByLabel("J'ai noté ma phrase en lieu sûr").check();
    await wallet.getByRole("button", { name: "Transmettre ma clé publique à Swissquote" }).click();
    await app.getByTestId("btc-balance").waitFor({ timeout: 30000 });
    await app.getByText("0.00000000 BTC").first().waitFor({ timeout: 30000 }); // solde lu sur signet via Esplora
    state.address = (await app.locator(".address").textContent())!.trim();
    await app.getByRole("button", { name: "Prouver à Swissquote que je contrôle cette adresse" }).click();
    await typePinIfAsked(wallet);
    await wallet.getByRole("button", { name: "Signer la preuve" }).click();
    const proof = (await app.getByTestId("ownership-result").textContent({ timeout: 20000 })) ?? "";
    await shot(app, "1-wallet-signet");
    saveState();
    report("8-1", "Signet, interface : wallet CH-0003 créé via le Wallet du client, solde lu sur le réseau signet (Esplora), adresse tb1q affichée",
      state.address.startsWith("tb1q"), `adresse ${state.address}`);
    report("8-2", "Signet, interface : preuve de propriété vérifiée par Swissquote", proof.startsWith("Propriété vérifiée"), proof.slice(0, 200));
  }

  if (phase === "spend") {
    const coins = await chain.utxos([state.address]);
    const ctx = await device();
    const app = await login(ctx);
    await app.getByTestId("btc-balance").waitFor({ timeout: 30000 });
    // Destination « externe » : le compte de démo n°8 (nouvelle clé de la recovery de l'étape 3)
    const read = (f: string) => JSON.parse(readFileSync(f, "utf8"));
    const sq = (await (await fetch("http://localhost:4000/guardian/key?network=signet")).json()).accountKey;
    const cfg8 = await createWalletConfig({ network: "signet", delay: 6, client: read(".local/signet/client-new.json").accountKey, swissquote: sq, tiers: read(".local/signet/tiers.json").accountKey });
    const dest = outputAt(cfg8, 0, 1).getAddress();
    await app.getByRole("button", { name: "Envoyer", exact: true }).click();
    await app.getByPlaceholder("tb1… / bcrt1…").fill(dest);
    await app.getByPlaceholder("0.0001").fill("0.000006");
    await app.getByLabel("Frais (sat/vB)").fill("1");
    await app.getByRole("button", { name: "Préparer l'envoi" }).click();
    const wallet = await popupOf(ctx, () => app.getByRole("button", { name: "Signer avec mon Wallet du client" }).click());
    await wallet.getByRole("heading", { name: "Confirmer l'envoi" }).waitFor({ timeout: 20000 });
    const screen = (await wallet.locator("section").first().textContent()) ?? "";
    await shot(wallet, "2-confirmation-signet");
    await typePinIfAsked(wallet);
    await wallet.getByRole("button", { name: "Confirmer et signer" }).click();
    await app.getByRole("button", { name: "Diffuser sur le réseau Bitcoin" }).click();
    const sent = (await app.locator(".success", { hasText: "Transaction diffusée" }).textContent({ timeout: 30000 })) ?? "";
    const txid = sent.match(/[0-9a-f]{64}/)?.[0];
    await shot(app, "3-envoi-signet");
    const onChain = txid ? await (await fetch(`https://blockstream.info/signet/api/tx/${txid}`)).json() : null;
    state.spendTxid = txid;
    saveState();
    report("8-3", "Signet, interface : envoi signé dans le Wallet du client après confirmation, diffusé, visible sur l'explorateur public",
      !!txid && onChain?.txid === txid && screen.includes(dest), `coins avant : ${coins.map((c) => `${c.value} sats`).join(", ")} ; ${EXPLORER}/tx/${txid}`);
  }

  if (phase === "recover") {
    // Perte du wallet : effacé du Wallet du client
    const ctxA = await device();
    const lost = await ctxA.newPage();
    await lost.goto(WALLET);
    const accountKey = JSON.parse(readFileSync("client-wallet/data/wallets.json", "utf8")).find((w: any) => w.policy?.network === "signet" && w.policy?.tiers === state.tiersKey)?.id;
    if (accountKey) {
      const card = lost.locator(".card", { hasText: accountKey });
      await card.getByRole("button", { name: "Simuler la perte de cet appareil" }).click();
      await card.getByRole("button", { name: "Effacer définitivement" }).click();
    }
    const ctx = await device();
    const nd = await login(ctx);
    await nd.getByTestId("btc-balance").waitFor({ timeout: 30000 });
    await nd.locator(".crypto-tabs").getByRole("button", { name: "Sécurité" }).click();
  await nd.getByRole("button", { name: /J'ai perdu mon wallet/ }).click();
    const kyc = nd.locator(".step").first().locator("input");
    await kyc.nth(0).fill("Martin");
    await kyc.nth(1).fill("1992-03-21");
    await kyc.nth(2).fill("246810");
    await nd.getByRole("button", { name: "Vérifier mon identité" }).click();
    await nd.getByRole("button", { name: "Choisir" }).last().click();
    const coins = (await nd.getByText(/coin\(s\),/).textContent({ timeout: 30000 })) ?? "";
    const w2 = await popupOf(ctx, () => nd.getByRole("button", { name: "Créer un nouveau wallet avec le Wallet du client" }).click());
    await choosePin(w2);
    await w2.getByRole("button", { name: "Générer ma phrase secrète" }).click();
    await w2.locator(".words li").nth(23).waitFor();
    await w2.getByLabel("J'ai noté ma phrase en lieu sûr").check();
    await w2.getByRole("button", { name: "Transmettre ma clé publique à Swissquote" }).click();
    await nd.getByRole("button", { name: "Préparer la demande" }).click({ timeout: 30000 });
    await nd.getByRole("button", { name: "Demander la signature de Swissquote" }).click();
    const sqPsbt = await nd.locator(".step textarea[readonly]").inputValue({ timeout: 20000 });
    const tiersCtx = await device();
    const tiers = await tiersCtx.newPage();
    await tiers.goto(CONSOLE);
    await tiers.getByPlaceholder(/PSBT reçu du client/).fill(sqPsbt);
    await tiers.getByPlaceholder("mot1 mot2 … mot24").fill(state.tiersWords.join(" "));
    await tiers.getByRole("button", { name: "Signer en tant que tiers" }).click();
    await nd.getByPlaceholder("PSBT signé par le tiers (cHNidP8…)").fill(await tiers.locator(".step textarea[readonly]").inputValue());
    await nd.getByRole("button", { name: "Ajouter la signature du tiers" }).click();
    await nd.getByRole("button", { name: "Diffuser la recovery" }).click();
    const out = (await nd.locator(".step .success, .step .error").last().textContent({ timeout: 30000 })) ?? "";
    await shot(nd, "4-recovery-signet");
    const txid = out.match(/[0-9a-f]{64}/)?.[0];
    state.recoveryTxid = txid ?? null;
    saveState();
    report("8-4", "Signet, interface : recovery Swissquote + tiers depuis un nouvel appareil, diffusée sur le réseau signet",
      !!txid, `${coins.trim()} ; ${txid ? `${EXPLORER}/tx/${txid}` : out.trim()}`);
  }
} finally {
  await browser.close();
}
report("8-x", "Aucune erreur dans les consoles des navigateurs", errors.length === 0, errors.join(" | ") || "aucune");
process.exit(summary() ? 0 : 1);
