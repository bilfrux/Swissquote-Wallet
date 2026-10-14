// Étape 41 : kit de sortie. Le client récupère tous ses coins avec sa clé, SANS le site, SANS bank-mock, SANS compte Swissquote.
// Pile : le Client Wallet seul (:5198, stockage neuf) + bitcoind regtest. Aucun processus Swissquote n'est lancé.
// Prérequis : npm run regtest:up
// Limite : le secret PRF est ici 32 octets aléatoires qui tiennent lieu de la sortie de l'authentificateur (comme à
// l'étape 37) ; la biométrie WebAuthn elle-même n'est pas exercée. Le chemin d'écran est vérifié jusqu'à la demande de biométrie.
import { type ChildProcess, spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdirSync, rmSync } from "node:fs";
import { chromium } from "playwright-core";
import { createWalletConfig, outputAt, scan, BitcoindBackend } from "@sq/bitcoin";
import { accountKey, masterFromMnemonic, newMnemonic } from "@sq/bitcoin/keys";
import { makeReport, miner, rpc } from "./lib.ts";

const WALLET = "http://localhost:5198";
const DATA = `${process.cwd()}/.local/e2e-41`;
const SHOTS = "docs/validation/captures";
rmSync(DATA, { recursive: true, force: true });
mkdirSync(SHOTS, { recursive: true });
const proc: ChildProcess = spawn("npm", ["run", "-s", "dev", "-w", "client-wallet"], { env: { ...process.env, CLIENT_WALLET_PORT: "5198", CLIENT_WALLET_DATA: DATA }, stdio: "ignore", detached: true });
for (let i = 0; i < 150; i++) { try { if ((await fetch(`${WALLET}/api/wallets`)).ok) break; } catch {} await new Promise((r) => setTimeout(r, 200)); }
const post = async (path: string, body: unknown) => { const r = await fetch(WALLET + path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }); return { status: r.status, body: (await r.json()) as any }; };
const b64u = (n: number) => randomBytes(n).toString("base64url");
const bio = { credentialId: b64u(32), prfSalt: b64u(32), prf: b64u(32) };
const { report, summary } = makeReport();
const { addr: minerAddr, mine, pay } = await miner();
const node = new BitcoindBackend(process.env.BTC_RPC_URL ?? "http://regtest:regtest@127.0.0.1:18443");

try {
  // Wallet du client + politique enregistrée (données publiques), deux adresses financées (0,3 + 0,1 BTC).
  const created = await post("/api/wallets", { network: "regtest", bio });
  const w = created.body.wallet;
  const sq = accountKey(masterFromMnemonic(newMnemonic(), "regtest")), t = accountKey(masterFromMnemonic(newMnemonic(), "regtest"));
  const policy = { network: "regtest", delay: 6, swissquote: sq, tiers: t, tiersName: "Marie Dupont" };
  await post(`/api/wallets/${w.id}/policy`, { policy, prf: bio.prf });
  const cfg = await createWalletConfig({ network: "regtest", delay: 6, client: w.accountKey, swissquote: sq, tiers: t });
  await pay(outputAt(cfg, 0, 0).getAddress(), 0.3);
  await pay(outputAt(cfg, 0, 1).getAddress(), 0.1);
  await mine(1);
  const dest: string = await rpc.call("getnewaddress", [], "miner");
  const before = Number(await rpc.call("getreceivedbyaddress", [dest, 0], "miner"));

  // 41-1 Refus propres, sans rien dépenser.
  const noWallet = await post("/api/exit/prepare", { walletId: "deadbeef", to: dest });
  const badAddr = await post("/api/exit/prepare", { walletId: w.id, to: "pas-une-adresse" });
  const noPolicyWallet = (await post("/api/wallets", { network: "regtest", bio: { credentialId: b64u(32), prfSalt: b64u(32), prf: b64u(32) } })).body.wallet;
  const noPolicy = await post("/api/exit/prepare", { walletId: noPolicyWallet.id, to: dest });
  report("41-1", "Refus : wallet inconnu (404), adresse invalide (400), wallet sans politique enregistrée (409)",
    noWallet.status === 404 && badAddr.status === 400 && noPolicy.status === 409, `${noWallet.status} ${noWallet.body.error} | ${badAddr.status} ${badAddr.body.error} | ${noPolicy.status} ${noPolicy.body.error}`);

  // 41-2 Préparation : les 2 coins sont trouvés sur la chaîne, un seul PSBT « clé du client seule ».
  const prep = await post("/api/exit/prepare", { walletId: w.id, to: dest, feeRate: 2 });
  const desc = prep.status === 200 ? (await post("/api/describe", { psbt: prep.body.psbt, network: "regtest" })).body : null;
  report("41-2", "Préparation : 2 coins trouvés (0,4 BTC), PSBT par le chemin « votre clé seule », une seule sortie vers l'adresse choisie, montant élevé signalé",
    prep.status === 200 && prep.body.coins === 2 && prep.body.total === "40000000" && desc?.path === "client" && desc.outputs.length === 1 && desc.outputs[0].address === dest && desc.high === true,
    `${prep.status} ; coins ${prep.body.coins} ; total ${prep.body.total} ; chemin ${desc?.path} ; sorties ${desc?.outputs?.length} ; montant élevé ${desc?.high}`);

  // 41-3 Sans biométrie, pas de signature ; diffusion refusée tant que le PSBT n'est pas signé.
  const noBio = await post("/api/sign", { psbt: prep.body.psbt, network: "regtest", confirmDest: dest.slice(-6) });
  const unsignedBroadcast = await post("/api/exit/broadcast", { walletId: w.id, psbt: prep.body.psbt });
  report("41-3", "Sans secret biométrique : signature refusée (403) ; PSBT non signé : diffusion refusée (400)",
    noBio.status === 403 && unsignedBroadcast.status === 400, `signature ${noBio.status} ${noBio.body.error} | diffusion ${unsignedBroadcast.status} ${unsignedBroadcast.body.error}`);

  // 41-4 Signature (confirmation des 6 derniers caractères, montant élevé), diffusion, confirmation on-chain.
  const wrong = await post("/api/sign", { psbt: prep.body.psbt, network: "regtest", confirmDest: "abcdef", prf: bio.prf });
  const signed = await post("/api/sign", { psbt: prep.body.psbt, network: "regtest", confirmDest: dest.slice(-6), prf: bio.prf });
  const sent = await post("/api/exit/broadcast", { walletId: w.id, psbt: signed.body.psbt });
  await mine(1);
  const after = Number(await rpc.call("getreceivedbyaddress", [dest, 1], "miner"));
  const left = await scan(cfg, node);
  report("41-4", "Signature (6 caractères exigés), diffusion et confirmation : l'adresse choisie reçoit ≈ 0,4 BTC, le wallet est vidé",
    wrong.status === 400 && signed.status === 200 && sent.status === 200 && after - before > 0.3999 && left.length === 0,
    `mauvais 6 caractères ${wrong.status} ; signature ${signed.status} ; diffusion ${sent.status} (${sent.body.txid}) ; reçu ${(after - before).toFixed(8)} BTC ; coins restants ${left.length}`);

  // 41-5 Interface (Chrome headless) : bouton, formulaire, préparation, écran de confirmation jusqu'à la demande de biométrie.
  await pay(outputAt(cfg, 0, 2).getAddress(), 0.05);
  await mine(1);
  const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: true });
  const errors: string[] = [];
  try {
    const p = await (await browser.newContext({ viewport: { width: 900, height: 1100 } })).newPage();
    p.on("pageerror", (e) => errors.push(e.message));
    await p.goto(WALLET);
    await p.getByRole("button", { name: "Emergency exit (works without Swissquote)" }).first().click();
    await p.getByLabel("Destination address").fill(dest);
    await p.screenshot({ path: `${SHOTS}/etape-41-1-sortie-formulaire.png` });
    await p.getByRole("button", { name: "Prepare the exit" }).click();
    await p.getByRole("heading", { name: "Confirm the transfer" }).waitFor({ timeout: 30000 });
    const text = (await p.locator("main").textContent()) ?? "";
    await p.screenshot({ path: `${SHOTS}/etape-41-2-sortie-confirmation.png` });
    report("41-5", "Interface du Client Wallet seul : bouton « Emergency exit », formulaire, écran de confirmation (chemin « votre clé seule », 0,05 BTC, adresse choisie) puis demande de biométrie",
      text.includes("your key alone") && text.includes("0.05000000 BTC") && text.includes(dest) && text.includes("Emergency exit (this wallet, no Swissquote service)") && errors.length === 0,
      `chemin affiché : ${text.includes("your key alone")} ; montant : ${text.includes("0.05000000 BTC")} ; adresse : ${text.includes(dest)} ; erreurs JS : ${errors.length}`);
  } finally { await browser.close(); }
} catch (e: any) {
  report("41-x", "Exécution", false, e.stack ?? e.message);
} finally {
  try { process.kill(-proc.pid!, "SIGTERM"); } catch {}
}
process.exit(summary() ? 0 : 1);
