// Étape 18 : recovery Ethereum depuis l'INTERFACE, sur le vrai Sepolia, sans ETH (Chrome headless).
// Nouvel appareil : re-KYC, nouveau Wallet du client (nouvelle clé), signature de Swissquote, demande au tiers par le
// relais, signature dans sa console, démarrage relayé par le Safe de la nouvelle clé, délai (3 min) appliqué par le
// contrat, finalisation, puis invalidation des signatures restantes. Contrôles de bank-mock appelés directement.
// Prérequis : scripts/demo/signet-ports.sh, compte Ethereum de CH-0003 actif (étape 17), état .local/signet-ui/state.json.
import { readFileSync } from "node:fs";
import { type BrowserContext, type Page, chromium } from "playwright-core";
import { getAddress, type Address } from "viem";
import { buildSponsoredOp, finalizeRecoveryCall, publicClient, readState as readLatest, recoveryNonce, safeAddressOf, sendOp } from "@sq/evm";
import { makeReport } from "./lib.ts";

const APP = process.env.APP_URL ?? "http://localhost:5183", CONSOLE = process.env.CONSOLE_URL ?? "http://localhost:5184", BANK = "http://localhost:4000";
const PIN = "482916", NEW_PIN = "731905";
const state = JSON.parse(readFileSync(".local/signet-ui/state.json", "utf8"));
const SHOTS = "docs/validation/captures";
const { report, summary } = makeReport();
const browser = await chromium.launch({ executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: true });
const errors: string[] = [], failed: string[] = [];
const device = async () => {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 1300 } });
  ctx.on("page", (p) => {
    p.on("pageerror", (e) => errors.push(e.message)); p.on("console", (m) => m.type() === "error" && errors.push(m.text()));
    p.on("response", (r) => { if (r.status() >= 400) failed.push(`${r.status()} ${new URL(r.url()).host}`); }); // quel serveur refuse
  });
  return ctx;
};
const popupOf = async (ctx: BrowserContext, click: () => Promise<void>) => { const [p] = await Promise.all([ctx.waitForEvent("page", { timeout: 150000 }), click()]); await p.waitForLoadState(); return p; };
// Choix du réseau Ethereum dans le sélecteur (un seul réseau affiché à la fois, étape 19).
const toEthereum = async (p: Page) => { await p.getByTestId("network-switcher").click(); await p.getByTestId("network-evm").click(); };
const shot = (p: Page, n: string) => p.screenshot({ path: `${SHOTS}/etape-18-${n}.png`, fullPage: true });
let atBlock: bigint | undefined;
const seen = async (text: string) => { const h = text.match(/0x[0-9a-f]{64}/)?.[0] as `0x${string}` | undefined; if (h) atBlock = (await publicClient.waitForTransactionReceipt({ hash: h })).blockNumber; return h; };
async function readState(safe: Address) { for (let i = 0; ; i++) { try { return await readLatest(safe, atBlock); } catch (e) { if (i > 15) throw e; await new Promise((r) => setTimeout(r, 2000)); } } }
const bank = async (path: string, body: unknown) => { const r = await fetch(BANK + path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }); return { status: r.status, json: await r.json() }; };

try {
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
  await card.getByTestId("evm-guardians").waitFor({ timeout: 60000 });
  const safe = getAddress((await card.getByTestId("evm-safe").textContent())!.trim());
  // Ménage : une recovery laissée en attente par un essai interrompu est finalisée d'abord (via l'API locale du Wallet
  // du client, PIN), sinon une nouvelle demande ne pourrait pas la remplacer (il faudrait plus d'approbations).
  const left = await readState(safe);
  if (left.pending) {
    const to = left.pending.newOwners[0];
    console.log(`[ménage] recovery en attente vers ${to}, applicable après ${new Date(left.pending.executeAfter * 1000).toISOString()}`);
    for (;;) { if ((await publicClient.getBlock()).timestamp > BigInt(left.pending.executeAfter)) break; await new Promise((r) => setTimeout(r, 10000)); }
    const op = await buildSponsoredOp({ safe: safeAddressOf(to), owner: to }, [finalizeRecoveryCall(safe)]);
    const r = await fetch("http://localhost:5180/api/evm/sign", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ op, pin: NEW_PIN }) });
    const j = await r.json(); if (!r.ok) throw new Error(j.error);
    const sent = await sendOp(op, j.signature);
    atBlock = sent.blockNumber;
    console.log(`[ménage] finalisée : ${sent.txHash}`);
    await app.reload(); // l'appli avait chargé l'état d'avant le ménage
    await app.getByRole("button", { name: "Crypto", exact: true }).click();
    await toEthereum(app);
  await toEthereum(app);
    await card.getByTestId("evm-guardians").waitFor({ timeout: 60000 });
  }
  const before = await readState(safe);
  const nonceBefore = await recoveryNonce(safe);

  // 18-1 Contrôles de Swissquote (appel direct) : sans re-KYC, refus ; vers le propriétaire actuel, refus.
  const noKyc = await bank("/guardian/evm/sign-recovery", { token: "x", safe, newOwner: "0x000000000000000000000000000000000000dEaD" });
  const tok = (await bank("/identity/verify", { customerId: "CH-0003", lastName: "Martin", birthDate: "1992-03-21", otp: "246810" })).json.token;
  const toOwner = await bank("/guardian/evm/sign-recovery", { token: tok, safe, newOwner: before.owners[0] });
  report("18-1", "Swissquote refuse de signer sans re-KYC, et vers le propriétaire actuel", noKyc.status === 403 && toOwner.status === 403, `${noKyc.status} ${noKyc.json.error} ; ${toOwner.status} ${toOwner.json.error}`);

  // Parcours dans l'interface, nouvel appareil (nouveau contexte de navigateur).
  await card.getByRole("button", { name: "Recover", exact: true }).click();
  const rec = card.getByTestId("evm-recovery");
  await rec.getByPlaceholder("Last name").fill("Martin");
  await rec.getByPlaceholder("Date of birth (YYYY-MM-DD)").fill("1992-03-21");
  await rec.getByPlaceholder("Code received by SMS").fill("246810");
  await rec.getByRole("button", { name: "Verify my identity" }).click();
  const w1 = await popupOf(ctx, () => rec.getByRole("button", { name: "Create a new Client Wallet" }).click());
  await w1.getByLabel("New PIN (6 to 12 digits)").fill(NEW_PIN);
  await w1.getByLabel("Confirm the PIN").fill(NEW_PIN);
  await w1.getByRole("button", { name: "Generate my secret phrase" }).click();
  await w1.locator(".words li").nth(23).waitFor();
  await w1.getByLabel("I have written my phrase down in a safe place").check();
  await w1.getByRole("button", { name: "Send my public key to Swissquote" }).click();
  await rec.getByRole("button", { name: "Get its Ethereum address" }).waitFor({ timeout: 15000 });
  await w1.close(); // le client ferme la fenêtre du wallet après chaque demande
  const w2 = await popupOf(ctx, () => rec.getByRole("button", { name: "Get its Ethereum address" }).click());
  await w2.getByRole("button", { name: "Send my Ethereum address" }).click();
  const newOwner = getAddress((await rec.getByTestId("evm-new-owner").textContent({ timeout: 15000 }))!.trim());
  await w2.close();
  await rec.getByRole("button", { name: "Request Swissquote's signature" }).click();
  await rec.getByRole("button", { name: /^Send the request to/ }).click();
  const link = (await rec.getByTestId("evm-relay-link").textContent({ timeout: 15000 }))!.trim();

  // Le tiers ouvre le lien dans SA console et signe avec sa phrase.
  const tctx = await device();
  const tiers = await tctx.newPage();
  await tiers.goto(link);
  const shownOwner = (await tiers.getByTestId("evm-new-owner").textContent({ timeout: 15000 }))!.trim();
  await tiers.getByPlaceholder("word1 word2 … word24").fill(state.tiersWords.join(" "));
  await shot(tiers, "1-console-tiers");
  await tiers.getByRole("button", { name: /Sign as trusted contact/ }).click();
  await tiers.getByTestId("relay-sent").waitFor({ timeout: 60000 });
  report("18-2", "Demande transmise au tiers par le relais : sa console affiche la nouvelle clé et signe (EIP-712), Swissquote vérifie que c'est la signature du tiers enregistré",
    getAddress(shownOwner) === newOwner, `lien ${link} ; nouvelle clé affichée ${shownOwner}`);

  // Démarrage : relayé par le Safe de la nouvelle clé, signé dans le Wallet du client.
  await rec.getByRole("button", { name: "Fetch the trusted contact's signature" }).click();
  await rec.getByRole("button", { name: "Start the recovery" }).click();
  const w3 = await popupOf(ctx, () => card.getByRole("button", { name: "Sign with my Client Wallet" }).click({ timeout: 90000 }));
  await w3.getByRole("heading", { name: "Confirm the Ethereum operation" }).waitFor({ timeout: 60000 });
  const startScreen = (await w3.locator("section").first().textContent()) ?? "";
  await w3.getByLabel("Wallet PIN").fill(NEW_PIN);
  await w3.getByRole("button", { name: "Confirm and sign" }).click();
  const started = (await card.getByTestId("evm-last-tx").textContent({ timeout: 180000 })) ?? "";
  await w3.close();
  await seen(started);
  const pending = await readState(safe);
  await rec.getByTestId("evm-countdown").waitFor({ timeout: 30000 });
  await shot(app, "2-recovery-demarree");
  report("18-3", "Recovery démarrée depuis l'interface (Swissquote + tiers), relayée et parrainée ; délai affiché, propriétaire inchangé pendant le délai",
    !!pending.pending && pending.pending.newOwners.map(getAddress).includes(newOwner) && getAddress(pending.owners[0]) === getAddress(before.owners[0]) && startScreen.includes("Relay the guardians' signatures"),
    `${started.trim()} ; applicable après ${pending.pending ? new Date(pending.pending.executeAfter * 1000).toISOString() : "?"} ; écran : ${startScreen.replace(/\s+/g, " ").slice(80, 260)}`);

  // 18-6 La progression survit à un rechargement de la page (mémorisée dans la session, étape 20).
  await app.reload();
  await app.getByRole("button", { name: "Crypto", exact: true }).click();
  await toEthereum(app);
  await card.getByTestId("evm-guardians").waitFor({ timeout: 60000 });
  await card.getByRole("button", { name: "Recover", exact: true }).click();
  const kept = await rec.getByTestId("evm-countdown").waitFor({ timeout: 30000 }).then(() => true, () => false);
  report("18-6", "Après un rechargement de la page pendant le délai, la recovery reprend où elle en était (compte à rebours, bouton de finalisation)", kept, `compte à rebours retrouvé : ${kept}`);

  // Finalisation après le délai, puis invalidation des signatures restantes (règle du projet).
  const fin = rec.getByRole("button", { name: "Complete the recovery" });
  try { await fin.waitFor({ timeout: 300000 }); }
  catch (e) {
    await shot(app, "ECHEC-finalisation");
    console.log("PANNEAU :", (await rec.textContent().catch(() => "(absent)"))?.replace(/\s+/g, " "));
    console.log("CARTE :", (await card.textContent())?.replace(/\s+/g, " ").slice(0, 600));
    throw e;
  }
  await fin.click();
  const w4 = await popupOf(ctx, () => card.getByRole("button", { name: "Sign with my Client Wallet" }).click({ timeout: 90000 }));
  await w4.getByLabel("Wallet PIN").fill(NEW_PIN);
  await w4.getByRole("button", { name: "Confirm and sign" }).click();
  await card.getByRole("button", { name: "Sign with my Client Wallet" }).waitFor({ timeout: 240000 }); // invalidation préparée
  await w4.close();
  const finalized = (await card.getByText(/^Recovery completed: 0x/).textContent()) ?? "";
  await seen(finalized);
  const after = await readState(safe);
  const reg = (await (await fetch(`${BANK}/evm/accounts`, { headers: { authorization: `Bearer ${JSON.parse(await app.evaluate(() => sessionStorage.getItem("sq-bank:session") ?? "null"))?.token}` } })).json()).accounts.find((a: any) => getAddress(a.safe) === safe);
  report("18-4", "Après le délai : recovery finalisée depuis l'interface ; propriétaire = nouvelle clé ; Swissquote a mis à jour son enregistrement",
    after.owners.length === 1 && getAddress(after.owners[0]) === newOwner && !after.pending && getAddress(reg.owner) === newOwner,
    `${finalized.trim()} ; propriétaires ${after.owners.join(",")} ; enregistré chez Swissquote : ${reg.owner}`);
  const w5 = await popupOf(ctx, () => card.getByRole("button", { name: "Sign with my Client Wallet" }).click());
  await w5.getByRole("heading", { name: "Confirm the Ethereum operation" }).waitFor({ timeout: 60000 });
  const invScreen = (await w5.locator("section").first().textContent()) ?? "";
  await w5.getByLabel("Wallet PIN").fill(NEW_PIN);
  await w5.getByRole("button", { name: "Confirm and sign" }).click();
  await card.getByText(/^Leftover guardian signatures invalidated: 0x/).waitFor({ timeout: 180000 });
  await seen((await card.getByTestId("evm-last-tx").textContent()) ?? "");
  const nonceAfter = await recoveryNonce(safe, atBlock);
  await shot(app, "3-recovery-terminee");
  report("18-5", "La nouvelle clé signe depuis le Safe récupéré : invalidation des signatures de gardiens restantes (nonce du module)",
    nonceAfter > nonceBefore + 1n && invScreen.includes("Invalidate any guardian signature"), `nonce ${nonceBefore} -> ${nonceAfter} (démarrage +1, invalidation +1)`);
} finally {
  await browser.close();
}
report("18-x", "Aucune erreur dans les consoles des navigateurs", errors.length === 0, `${errors.join(" | ") || "aucune"} ; réponses en erreur : ${[...new Set(failed)].join(", ") || "aucune"}`);
process.exit(summary() ? 0 : 1);
