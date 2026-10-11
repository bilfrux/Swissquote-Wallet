// Étape 17 : compte Ethereum depuis l'INTERFACE, sur le vrai Sepolia, sans ETH (Chrome headless).
//   ajout du compte (adresse dérivée dans le Wallet du client, adresse du tiers lue dans sa console),
//   activation (Safe + module + 2 gardiens) signée dans le Wallet du client après décodage,
//   envoi d'1 USDC si le Safe en détient (faucet Circle), refus du wallet pour un appel inconnu.
// Prérequis : scripts/demo/signet-ports.sh (appli APP_URL, console CONSOLE_URL, wallet :5180, bank-mock :4000),
// et le client CH-0003 avec un wallet Bitcoin actif (état .local/signet-ui/state.json, phrase du tiers incluse).
import { readFileSync } from "node:fs";
import { type BrowserContext, type Page, chromium } from "playwright-core";
import { getAddress, parseUnits, type Address } from "viem";
import { USDC_DECIMALS, buildSponsoredOp, publicClient, readState as readLatest, safeAddressOf } from "@sq/evm";
import { makeReport } from "./lib.ts";

const APP = process.env.APP_URL ?? "http://localhost:5183", CONSOLE = process.env.CONSOLE_URL ?? "http://localhost:5184", WALLET = "http://localhost:5180", BANK = "http://localhost:4000";
// PIN du wallet propriétaire : 482916 pour le wallet de l'étape 8 ; 731905 pour ceux créés par la recovery de l'étape 18.
let PIN = "482916";
const state = JSON.parse(readFileSync(".local/signet-ui/state.json", "utf8"));
const SHOTS = "docs/validation/captures";
const { report, summary } = makeReport();
const browser = await chromium.launch({ executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: true });
const errors: string[] = [];
const device = async () => {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 1100 } });
  ctx.on("page", (p) => { p.on("pageerror", (e) => errors.push(e.message)); p.on("console", (m) => m.type() === "error" && errors.push(m.text())); });
  return ctx;
};
const popupOf = async (ctx: BrowserContext, click: () => Promise<void>) => { const [p] = await Promise.all([ctx.waitForEvent("page"), click()]); await p.waitForLoadState(); return p; };
const typePinIfAsked = async (w: Page) => { const box = w.getByLabel("Wallet PIN"); if (await box.count()) await box.fill(PIN); };
// Lecture au bloc de la dernière transaction vue (le nœud public peut renvoyer un état en retard, voir étape 16).
let atBlock: bigint | undefined;
const seen = async (text: string) => {
  const hash = text.match(/0x[0-9a-f]{64}/)?.[0] as `0x${string}` | undefined;
  if (hash) atBlock = (await publicClient.waitForTransactionReceipt({ hash })).blockNumber;
};
async function readState(safe: Address) {
  for (let i = 0; ; i++) { try { return await readLatest(safe, atBlock); } catch (e) { if (i > 15) throw e; await new Promise((r) => setTimeout(r, 2000)); } }
}
// Choix du réseau Ethereum dans le sélecteur (un seul réseau affiché à la fois, étape 19).
const toEthereum = async (p: Page) => { await p.getByTestId("network-switcher").click(); await p.getByTestId("network-evm").click(); };
const shot = (p: Page, n: string) => p.screenshot({ path: `${SHOTS}/etape-17-${n}.png`, fullPage: true });

try {
  // Adresse Ethereum du tiers, lue dans SA console (même phrase que sa clé Bitcoin).
  const tiersCtx = await device();
  const tiers = await tiersCtx.newPage();
  await tiers.goto(CONSOLE);
  await tiers.getByPlaceholder("word1 word2 … word24").fill(state.tiersWords.join(" "));
  await tiers.getByRole("button", { name: /Show my Ethereum address/ }).click();
  const tiersEvm = (await tiers.getByTestId("evm-address").textContent())!.trim();

  const ctx = await device();
  const app = await ctx.newPage();
  await app.goto(APP);
  await app.evaluate(() => { localStorage.clear(); sessionStorage.clear(); });
  await app.reload();
  await app.getByLabel("Client ID").fill("CH-0003");
  await app.getByLabel("Password").fill("demo0003");
  await app.getByRole("button", { name: "Log in", exact: true }).click();
  await app.getByRole("button", { name: "Crypto", exact: true }).click();
  await toEthereum(app);
  const card = app.getByTestId("evm-card");
  await card.waitFor({ timeout: 30000 });

  // 17-1 Ajout du compte : le Wallet du client ne transmet que l'adresse ; Swissquote recalcule le Safe.
  if (await card.getByRole("button", { name: "Add my Ethereum account" }).count()) {
    await card.locator("input").fill(tiersEvm);
    const w = await popupOf(ctx, () => card.getByRole("button", { name: "Add my Ethereum account" }).click());
    await w.getByRole("heading", { name: "Add an Ethereum account" }).waitFor({ timeout: 15000 });
    await typePinIfAsked(w);
    await w.getByRole("button", { name: "Send my Ethereum address" }).click();
  }
  const safe = getAddress((await app.getByTestId("evm-safe").textContent({ timeout: 30000 }))!.trim());
  const wallets = JSON.parse(readFileSync("client-wallet/data/wallets.json", "utf8")) as any[];
  // Propriétaire : lu on-chain si le Safe existe (après une recovery, ce n'est plus la clé qui l'a créé).
  const onChain = (await readLatest(safe)).owners[0];
  const owner = (onChain ? wallets.find((x) => x.evmAddress && getAddress(x.evmAddress) === getAddress(onChain)) : wallets.find((x) => x.evmAddress && safeAddressOf(x.evmAddress) === safe))?.evmAddress as Address | undefined;
  if (owner && safeAddressOf(owner) !== safe) PIN = "731905";
  const reg = await (await fetch(`${BANK}/evm/accounts/register`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" })).status;
  report("17-1", "Ajout du compte Ethereum : adresse dérivée dans le Wallet du client (même phrase), Safe recalculé par Swissquote et affiché",
    !!owner && reg === 401, `Safe ${safe} ; propriétaire ${owner} ; tiers ${tiersEvm} ; enregistrement sans session : ${reg}`);

  // 17-2 Activation : décodée et signée dans le Wallet du client ; Safe + module + 2 gardiens, sans ETH.
  let st = await readState(safe);
  if (!(st.deployed && st.moduleEnabled)) {
    await card.getByRole("button", { name: "Activate my Ethereum account" }).click();
    const w = await popupOf(ctx, () => card.getByRole("button", { name: "Sign with my Client Wallet" }).click({ timeout: 90000 }));
    await w.getByRole("heading", { name: "Confirm the Ethereum operation" }).waitFor({ timeout: 60000 });
    const screen = (await w.locator("section").first().textContent()) ?? "";
    await shot(w, "1-activation-wallet");
    await typePinIfAsked(w);
    await w.getByRole("button", { name: "Confirm and sign" }).click();
    const done = (await app.getByTestId("evm-last-tx").textContent({ timeout: 180000 })) ?? "";
    await seen(done);
    st = await readState(safe);
    const sq = (await (await fetch(`${BANK}/guardian/evm-address`)).json()).address as Address;
    report("17-2", "Activation depuis l'interface : écran du wallet en clair (module, 2 gardiens, frais parrainés), Safe déployé, gardiens Swissquote + tiers, seuil 2, 0 ETH",
      st.deployed && st.moduleEnabled && st.threshold === 2n && st.guardians.map(getAddress).sort().join() === [sq, getAddress(tiersEvm)].sort().join() && st.owners[0] === owner
        && screen.includes("Enable the recovery module") && screen.includes("paid by a sponsor"),
      `${done.trim()} ; écran : ${screen.replace(/\s+/g, " ").slice(0, 260)}`);
  } else report("17-2", "Activation (déjà faite lors d'un essai précédent)", true, `gardiens ${st.guardians.join(", ")} ; seuil ${st.threshold}`);
  await app.reload();
  await app.getByRole("button", { name: "Crypto", exact: true }).click();
  await toEthereum(app);
  await app.getByTestId("evm-guardians").waitFor({ timeout: 30000 });
  await shot(app, "2-compte-ethereum");

  // 17-3 Le Wallet du client refuse de signer un appel qu'il ne sait pas expliquer (appel direct à son API, comme un outil local).
  {
    const op = await buildSponsoredOp({ safe, owner: owner! }, [{ to: "0x9a7af758aE5d7B6aAE84fe4C5Ba67c041dFE5336", value: 0n, data: "0x6a627842" + safe.slice(2).toLowerCase().padStart(64, "0") }]);
    const r = await fetch(`${WALLET}/api/evm/sign`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ op, pin: PIN }) });
    const j = await r.json();
    report("17-3", "Le Wallet du client refuse de signer une opération contenant un appel non reconnu", r.status === 400 && /refused/.test(j.error), `${r.status} ${j.error}`);
  }

  // 17-4 Envoi d'1 USDC (si le Safe en a reçu du faucet Circle), signé dans le Wallet du client.
  st = await readState(safe);
  if (st.usdc >= parseUnits("1", USDC_DECIMALS)) {
    const before = st.usdc;
    await card.getByRole("button", { name: "Send", exact: true }).click();
    await card.getByPlaceholder("0x…").fill(tiersEvm);
    await card.getByPlaceholder("1").fill("1");
    await card.getByRole("button", { name: "Send USDC" }).click();
    const w = await popupOf(ctx, () => card.getByRole("button", { name: "Sign with my Client Wallet" }).click({ timeout: 90000 }));
    await w.getByRole("heading", { name: "Confirm the Ethereum operation" }).waitFor({ timeout: 60000 });
    const screen = (await w.locator("section").first().textContent()) ?? "";
    await shot(w, "3-envoi-usdc-wallet");
    await typePinIfAsked(w);
    await w.getByRole("button", { name: "Confirm and sign" }).click();
    const done = (await app.getByTestId("evm-last-tx").textContent({ timeout: 180000 })) ?? "";
    await app.getByText(/^USDC sent: 0x/).waitFor({ timeout: 10000 });
    await seen(done);
    const after = (await readState(safe)).usdc;
    await shot(app, "4-envoi-usdc");
    report("17-4", "Envoi d'1 USDC depuis l'interface, signé dans le Wallet du client, frais parrainés", before - after === parseUnits("1", USDC_DECIMALS) && screen.includes("Send 1 USDC"),
      `${done.trim()} ; solde ${before} -> ${after} (unités de 10^-6) ; écran : ${screen.replace(/\s+/g, " ").slice(0, 160)}`);
  } else console.log(`[-- ] 17-4 non testé : le Safe ${safe} n'a pas d'USDC (faucet Circle à demander vers cette adresse)`);
} finally {
  await browser.close();
}
report("17-x", "Aucune erreur dans les consoles des navigateurs", errors.length === 0, errors.join(" | ") || "aucune");
process.exit(summary() ? 0 : 1);
