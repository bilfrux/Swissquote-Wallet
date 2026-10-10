// Étape 8 : le parcours de l'INTERFACE sur le vrai réseau signet (Chrome headless), en trois phases :
//   npm run validate:8:signet -- create    wallet CH-0003 créé via le Wallet du client + preuve de propriété (sans fonds)
//   npm run validate:8:signet -- spend     après financement (faucet) : envoi signé dans le Wallet du client, diffusé
//   npm run validate:8:signet -- recover   après D = 6 confirmations : perte du wallet, recovery Swissquote + tiers
// Prérequis : npm run demo:signet (appli APP_URL, bank-mock :4000, console CONSOLE_URL, wallet WALLET_URL).
// État de test (phrase du tiers incluse) : .local/signet-ui/state.json (ignoré par git).
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { type BrowserContext, type Page, chromium } from "playwright-core";
import { EsploraBackend, createWalletConfig, outputAt } from "@sq/bitcoin";
import { makeReport } from "./lib.ts";

const APP = process.env.APP_URL ?? "http://localhost:5173", WALLET = process.env.WALLET_URL ?? "http://localhost:5180";
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
const typePinIfAsked = async (w: Page) => { const box = w.getByLabel("Wallet PIN"); if (await box.count()) await box.fill(PIN); };
const choosePin = async (w: Page) => { await w.getByLabel("New PIN (6 to 12 digits)").fill(PIN); await w.getByLabel("Confirm the PIN").fill(PIN); };

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
  await p.getByLabel("Client ID").fill("CH-0003");
  await p.getByLabel("Password").fill("demo0003");
  await p.getByRole("button", { name: "Log in", exact: true }).click();
  await p.getByRole("button", { name: "Crypto", exact: true }).click();
  return p;
}

try {
  if (phase === "create") {
    const tiersCtx = await device();
    const tiers = await tiersCtx.newPage();
    await tiers.goto(CONSOLE);
    await tiers.getByRole("button", { name: "Create my trusted-contact identity" }).click();
    state.tiersWords = (await tiers.locator(".identity-words li").allTextContents()).map((w) => w.trim());
    state.tiersKey = (await tiers.locator(".identity-key").textContent())!.trim();
    await tiers.getByRole("button", { name: /I have written down my phrase/ }).click();

    const ctx = await device();
    const app = await login(ctx);
    await app.getByPlaceholder("Marie Dupont").fill("Marie Dupont");
    await app.getByLabel("Trusted contact's public key").fill(state.tiersKey);
    const wallet = await popupOf(ctx, () => app.getByRole("button", { name: "Create my wallet with the Client Wallet" }).click());
    await choosePin(wallet);
    await wallet.getByRole("button", { name: "Generate my secret phrase" }).click();
    await wallet.locator(".words li").nth(23).waitFor();
    await wallet.getByLabel("I have written my phrase down in a safe place").check();
    await wallet.getByRole("button", { name: "Send my public key to Swissquote" }).click();
    await app.getByTestId("btc-balance").waitFor({ timeout: 30000 });
    await app.getByText("0.00000000 BTC").first().waitFor({ timeout: 30000 }); // solde lu sur signet via Esplora
    state.address = (await app.locator(".address").textContent())!.trim();
    await app.getByRole("button", { name: "Prove to Swissquote that I control this address" }).click();
    await typePinIfAsked(wallet);
    await wallet.getByRole("button", { name: "Sign the proof" }).click();
    const proof = (await app.getByTestId("ownership-result").textContent({ timeout: 20000 })) ?? "";
    await shot(app, "1-wallet-signet");
    saveState();
    report("8-1", "Signet, interface : wallet CH-0003 créé via le Wallet du client, solde lu sur le réseau signet (Esplora), adresse tb1q affichée",
      state.address.startsWith("tb1q"), `adresse ${state.address}`);
    report("8-2", "Signet, interface : preuve de propriété vérifiée par Swissquote", proof.startsWith("Ownership verified"), proof.slice(0, 200));
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
    await app.getByRole("button", { name: "Send", exact: true }).click();
    await app.getByPlaceholder("tb1… / bcrt1…").fill(dest);
    await app.getByPlaceholder("0.0001").fill("0.000006");
    await app.getByLabel("Fee (sat/vB)").fill("1");
    await app.getByRole("button", { name: "Prepare the transfer" }).click();
    const wallet = await popupOf(ctx, () => app.getByRole("button", { name: "Sign with my Client Wallet" }).click());
    await wallet.getByRole("heading", { name: "Confirm the transfer" }).waitFor({ timeout: 20000 });
    const screen = (await wallet.locator("section").first().textContent()) ?? "";
    await shot(wallet, "2-confirmation-signet");
    await typePinIfAsked(wallet);
    await wallet.getByRole("button", { name: "Confirm and sign" }).click();
    await app.getByRole("button", { name: "Broadcast on the Bitcoin network" }).click();
    const sent = (await app.locator(".success", { hasText: "Transaction broadcast" }).textContent({ timeout: 30000 })) ?? "";
    const txid = sent.match(/[0-9a-f]{64}/)?.[0];
    await shot(app, "3-envoi-signet");
    const onChain = txid ? await (await fetch(`https://blockstream.info/signet/api/tx/${txid}`)).json() : null;
    state.spendTxid = txid;
    saveState();
    report("8-3", "Signet, interface : envoi signé dans le Wallet du client après confirmation, diffusé, visible sur l'explorateur public",
      !!txid && onChain?.txid === txid && screen.includes(dest), `coins avant : ${coins.map((c) => `${c.value} sats`).join(", ")} ; ${EXPLORER}/tx/${txid}`);
  }

  if (phase === "recover") {
    // Garde : rien n'est effacé tant que le coin à récupérer n'a pas D = 6 confirmations.
    const spent = await (await fetch(`https://blockstream.info/signet/api/tx/${state.spendTxid}`)).json();
    const confs = spent.status?.confirmed ? (await chain.tipHeight()) - spent.status.block_height + 1 : 0;
    if (confs < 6) { console.log(`Rendu de ${state.spendTxid} : ${confs} confirmation(s) sur 6. Relancer plus tard.`); process.exit(2); }
    // Perte du wallet : effacé du Wallet du client
    const ctxA = await device();
    const lost = await ctxA.newPage();
    await lost.goto(WALLET);
    const entry = JSON.parse(readFileSync("client-wallet/data/wallets.json", "utf8")).find((w: any) => w.policy?.network === "signet" && w.policy?.tiers === state.tiersKey);
    if (entry) {
      state.lostAccountKey = entry.accountKey;
      saveState();
      const card = lost.locator(".card", { hasText: entry.id });
      await card.getByRole("button", { name: "Simulate losing this device" }).click();
      await card.getByRole("button", { name: "Erase permanently" }).click();
      await card.waitFor({ state: "detached", timeout: 10000 });
    } else if (!state.lostAccountKey) throw new Error("wallet signet de CH-0003 introuvable dans le Wallet du client");
    // (sinon : déjà effacé lors d'un essai précédent ; sa clé publique est dans l'état du test)
    const lostKey: string = state.lostAccountKey;
    const gone = !JSON.parse(readFileSync("client-wallet/data/wallets.json", "utf8")).some((w: any) => w.accountKey === lostKey);
    // Nouvel appareil
    const ctx = await device();
    const nd = await login(ctx);
    await nd.getByTestId("btc-balance").waitFor({ timeout: 30000 });
    await nd.locator(".crypto-tabs").getByRole("button", { name: "Security" }).click();
    await nd.getByRole("button", { name: /I lost my wallet/ }).click();
    const kyc = nd.locator(".step").first().locator("input");
    await kyc.nth(0).fill("Martin");
    await kyc.nth(1).fill("1992-03-21");
    await kyc.nth(2).fill("246810");
    await nd.getByRole("button", { name: "Verify my identity" }).click();
    await nd.locator("p", { hasText: lostKey.slice(0, 22) }).getByRole("button", { name: "Select" }).click();
    const coins = (await nd.getByText(/coin\(s\),/).textContent({ timeout: 30000 })) ?? "";
    const w2 = await popupOf(ctx, () => nd.getByRole("button", { name: "Create a new wallet with the Client Wallet" }).click());
    await choosePin(w2);
    await w2.getByRole("button", { name: "Generate my secret phrase" }).click();
    await w2.locator(".words li").nth(23).waitFor();
    await w2.getByLabel("I have written my phrase down in a safe place").check();
    await w2.getByRole("button", { name: "Send my public key to Swissquote" }).click();
    await nd.getByRole("button", { name: "Prepare the request" }).click({ timeout: 30000 });
    await nd.getByRole("button", { name: "Request Swissquote's signature" }).click();
    const sqPsbt = await nd.locator(".step textarea[readonly]").inputValue({ timeout: 20000 });
    // A3 : la demande part au tiers par le relais Swissquote (lien), sans copier-coller de PSBT.
    await nd.getByRole("button", { name: /^Send the request to/ }).click();
    const link = (await nd.getByTestId("relay-link").textContent({ timeout: 10000 }))!;
    const tiersCtx = await device();
    const tiers = await tiersCtx.newPage();
    await tiers.goto(link);
    await tiers.waitForFunction(() => !!(document.querySelector("textarea[placeholder^='PSBT received']") as HTMLTextAreaElement | null)?.value, null, { timeout: 10000 });
    const loaded = await tiers.getByPlaceholder(/PSBT received from the client/).inputValue();
    await tiers.getByPlaceholder("word1 word2 … word24").fill(state.tiersWords.join(" "));
    await tiers.getByRole("button", { name: "Sign as trusted contact" }).click();
    await tiers.getByRole("button", { name: "Send back to the client via Swissquote" }).click();
    await tiers.getByTestId("relay-sent").waitFor({ timeout: 10000 });
    await nd.getByRole("button", { name: "Fetch the trusted contact's signature" }).click();
    await nd.getByRole("button", { name: "Broadcast the recovery" }).click({ timeout: 10000 });
    const out = (await nd.locator(".step .success, .step .error").last().textContent({ timeout: 30000 })) ?? "";
    await shot(nd, "4-recovery-signet");
    const txid = out.includes("Recovery broadcast") ? out.match(/[0-9a-f]{64}/)?.[0] : undefined;
    state.recoveryTxid = txid ?? null;
    saveState();
    let opened = false;
    if (txid) {
      await nd.getByRole("button", { name: "Open my new account" }).click();
      await nd.getByText("Recovery complete").waitFor({ timeout: 30000 });
      await shot(nd, "5-nouveau-wallet-signet");
      opened = true;
    }
    const onChain = txid ? await (await fetch(`https://blockstream.info/signet/api/tx/${txid}`)).json() : null;
    report("8-4", "Signet, interface : recovery Swissquote + tiers depuis un nouvel appareil (relais A3), diffusée sur le réseau signet, nouveau wallet ouvert",
      gone && !!txid && onChain?.txid === txid && loaded === sqPsbt && opened,
      `ancien wallet absent du Wallet du client : ${gone} ; ${coins.trim()} ; rendu à ${confs} conf. ; PSBT relayé identique : ${loaded === sqPsbt} ; ${txid ? `${EXPLORER}/tx/${txid}` : out.trim()}`);
  }
} finally {
  await browser.close();
}
report("8-x", "Aucune erreur dans les consoles des navigateurs", errors.length === 0, errors.join(" | ") || "aucune");
process.exit(summary() ? 0 : 1);
