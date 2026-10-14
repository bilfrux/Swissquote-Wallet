// Étape 50 : durcissement du Client Wallet.
//  - plus de retour au PIN (set-pin, remove-bio refusés) ; la vérification préalable « check » vérifie vraiment ;
//  - montant élevé vers plusieurs destinataires externes : refusé (la saisie des 6 caractères n'en couvrirait qu'un) ;
//  - une demande en attente de confirmation ne peut pas être remplacée par une autre (écran ≠ transaction signée).
// Pile isolée : Client Wallet :5214 ; « appli » de test :5215. Prérequis : npm run regtest:up
import { type ChildProcess, spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { createServer } from "node:http";
import { readFileSync, rmSync } from "node:fs";
import { base64 } from "@scure/base";
import { Output, btc } from "@bitcoinerlab/descriptors-scure";
import { chromium } from "playwright-core";
import { btcNetwork, buildSpend, createWalletConfig, outputAt, scan, type WalletConfig, type WalletUtxo } from "@sq/bitcoin";
import { accountKey, masterFromMnemonic, newMnemonic } from "@sq/bitcoin/keys";
import { seal } from "../../client-wallet/src/vault.ts";
import { makeReport, miner, rpc } from "./lib.ts";

const WALLET = "http://localhost:5214", APP = "http://localhost:5215";
const DATA = `${process.cwd()}/.local/e2e-50`;
rmSync(DATA, { recursive: true, force: true });
const proc: ChildProcess = spawn("npm", ["run", "-s", "dev", "-w", "client-wallet"], { env: { ...process.env, CLIENT_WALLET_PORT: "5214", CLIENT_WALLET_DATA: DATA, VITE_WALLET_ALLOWED_ORIGINS: APP }, stdio: "ignore", detached: true });
const app = createServer((_, res) => res.writeHead(200, { "content-type": "text/html" }).end(`<!doctype html><script>
  window.responses = [];
  window.openWallet = () => { window.win = window.open(${JSON.stringify(WALLET)}, "w", "popup"); };
  window.send = (r) => window.win.postMessage({ type: "wallet-request", network: "regtest", ...r }, ${JSON.stringify(WALLET)});
  addEventListener("message", (e) => { if (e.origin === ${JSON.stringify(WALLET)} && e.data.type === "wallet-response") window.responses.push(e.data); });
</script>`)).listen(5215, "localhost");
for (let i = 0; i < 150; i++) { try { if ((await fetch(`${WALLET}/api/wallets`)).ok) break; } catch {} await new Promise((r) => setTimeout(r, 200)); }
const { report, summary } = makeReport();
const post = async (path: string, body: unknown) => { const r = await fetch(WALLET + path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }); return { status: r.status, body: (await r.json()) as any }; };
const b64u = (n: number) => randomBytes(n).toString("base64url");
const key = () => accountKey(masterFromMnemonic(newMnemonic(), "regtest"));
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: true });
const { addr: minerAddr, mine, pay } = await miner();

// PSBT « clé du client seule » vers plusieurs destinataires externes (même construction que buildSpend).
async function multiPsbt(cfg: WalletConfig, utxos: WalletUtxo[], outs: [string, bigint][]) {
  const tx = new btc.Transaction();
  for (const u of utxos) outputAt(cfg, u.change, u.index, "client").updatePsbtAsInput({ psbt: tx, txHex: await rpc.txHex(u.txid), vout: u.vout });
  for (const [a, v] of outs) new Output({ descriptor: `addr(${a})`, network: btcNetwork("regtest") }).updatePsbtAsOutput({ psbt: tx, value: v });
  return base64.encode(tx.toPSBT());
}

try {
  // --- 50-1 : plus de retour au PIN ---
  const pinPhrase = newMnemonic();
  const legacy = { id: "cccccccc", label: "ancien PIN", sealed: seal(pinPhrase, "730215"), accountKey: accountKey(masterFromMnemonic(pinPhrase, "regtest")), createdAt: new Date().toISOString() };
  const bio = { credentialId: b64u(32), prfSalt: b64u(32), prf: b64u(32) };
  const w = (await post("/api/wallets", { network: "regtest", label: "biométrie", bio })).body.wallet;
  const file = `${DATA}/wallets.json`;
  const { writeFileSync } = await import("node:fs");
  writeFileSync(file, JSON.stringify([...JSON.parse(readFileSync(file, "utf8")), legacy], null, 2));
  const setPin = await post(`/api/wallets/${w.id}/unlock`, { op: "set-pin", newPin: "123456", auth: { prf: bio.prf } });
  const removeBio = await post(`/api/wallets/${w.id}/unlock`, { op: "remove-bio", auth: { prf: bio.prf } });
  const checkWrong = await post(`/api/wallets/cccccccc/unlock`, { op: "check", auth: { pin: "000000" } });
  const checkOk = await post(`/api/wallets/cccccccc/unlock`, { op: "check", auth: { pin: "730215" } });
  const after = JSON.parse(readFileSync(file, "utf8"));
  report("50-1", "Plus de retour au PIN : set-pin et remove-bio refusés (400) ; « check » refuse un mauvais PIN (403), accepte le bon sans rien changer",
    setPin.status === 400 && removeBio.status === 400 && checkWrong.status === 403 && checkOk.status === 200 && !!after.find((x: any) => x.id === w.id).bio && !after.find((x: any) => x.id === w.id).sealed && !!after.find((x: any) => x.id === "cccccccc").sealed,
    `set-pin ${setPin.status} « ${setPin.body.error} » ; remove-bio ${removeBio.status} ; check mauvais PIN ${checkWrong.status} ; check bon PIN ${checkOk.status}`);

  // --- 50-2 : montant élevé vers plusieurs destinataires ---
  const sq = key(), t = key();
  const policy = { network: "regtest", delay: 6, swissquote: sq, tiers: t };
  await post(`/api/wallets/${w.id}/policy`, { policy, prf: bio.prf });
  const cfg = await createWalletConfig({ ...policy, network: "regtest", client: w.accountKey });
  await pay(outputAt(cfg, 0, 0).getAddress(), 0.6);
  await mine(1);
  const utxos = await scan(cfg, rpc);
  const other: string = await rpc.call("getnewaddress", [], "miner");
  const multi = await multiPsbt(cfg, utxos, [[minerAddr, 1_000_000n], [other, 50_000_000n]]); // 0,01 confirmable + 0,5 jamais confirmé
  const dm = (await post("/api/describe", { psbt: multi, network: "regtest" })).body;
  const sm = await post("/api/sign", { psbt: multi, network: "regtest", confirmDest: minerAddr.slice(-6), prf: bio.prf });
  const single = await buildSpend({ cfg, backend: rpc, utxos, path: "client", feeRate: 2, to: other, amount: 30_000_000n });
  const ss = await post("/api/sign", { psbt: single.psbt, network: "regtest", confirmDest: other.slice(-6), prf: bio.prf });
  report("50-2", "Montant élevé vers deux destinataires externes : signature refusée même avec les 6 caractères du premier ; vers un seul destinataire : signée",
    dm.high === true && sm.status === 400 && /several recipients/.test(sm.body.error) && ss.status === 200 && ss.body.added > 0,
    `envoyé ${dm.sent} sats, élevé=${dm.high} ; deux destinataires : ${sm.status} « ${sm.body.error} » ; un destinataire : ${ss.status}`);

  // --- 50-3 : interface, demande remplacée pendant la confirmation ---
  const ctx = await browser.newContext();
  const opener = await ctx.newPage();
  await opener.goto(APP);
  const [win] = await Promise.all([ctx.waitForEvent("page"), opener.evaluate(() => (window as any).openWallet())]);
  await win.waitForLoadState("networkidle");
  const cdp = await ctx.newCDPSession(win);
  await cdp.send("WebAuthn.enable");
  await cdp.send("WebAuthn.addVirtualAuthenticator", { options: { protocol: "ctap2", transport: "internal", hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true, hasPrf: true } } as any);
  const uw = await win.evaluate(async () => {
    const bio = await import("/src/ui/bio.ts");
    const k = await bio.bioEnroll("étape 50");
    const r = await fetch("/api/wallets", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ network: "regtest", label: "étape 50", bio: k }) });
    return (await r.json()).wallet;
  });
  const send = (r: object) => opener.evaluate((r) => (window as any).send(r), r);
  const answer = (id: string) => opener.waitForFunction((id) => (window as any).responses.find((r: any) => r.id === id), id, { timeout: 20000 }).then((h) => h.jsonValue() as Promise<any>);
  await send({ id: "pol", action: "policy", payload: { walletId: uw.id, policy } });
  await win.getByRole("button", { name: "Confirm and save" }).click({ timeout: 15000 });
  await answer("pol");
  const ucfg = await createWalletConfig({ ...policy, network: "regtest", client: uw.accountKey });
  await pay(outputAt(ucfg, 0, 0).getAddress(), 0.1);
  await mine(1);
  const uutxos = await scan(ucfg, rpc);
  const A = await buildSpend({ cfg: ucfg, backend: rpc, utxos: uutxos, path: "client", feeRate: 2, to: minerAddr, amount: 1_000_000n });
  const B = await buildSpend({ cfg: ucfg, backend: rpc, utxos: uutxos, path: "client", feeRate: 2, to: other, amount: 9_000_000n });
  await send({ id: "A", action: "sign", payload: { psbt: A.psbt } });
  await win.getByRole("heading", { name: "Confirm the transfer" }).waitFor({ timeout: 15000 });
  await send({ id: "B", action: "sign", payload: { psbt: B.psbt } }); // l'appli tente de remplacer la transaction affichée
  const rB = await answer("B");
  const shown = (await win.locator("section").first().textContent()) ?? "";
  await win.getByRole("button", { name: "Confirm and sign" }).click();
  const rA = await answer("A");
  const signedOutputs = rA.ok ? btc.Transaction.fromPSBT(base64.decode(rA.data.psbt)).outputsLength : 0;
  const signedTo = rA.ok ? btc.Address(btcNetwork("regtest")).encode(btc.OutScript.decode(btc.Transaction.fromPSBT(base64.decode(rA.data.psbt)).getOutput(0).script!)) : "";
  report("50-3", "Interface : une 2e demande de signature pendant la confirmation est refusée ; l'écran garde la 1re, et c'est elle qui est signée",
    rB.ok === false && /already waiting/.test(rB.error) && shown.includes(minerAddr) && !shown.includes(other) && rA.ok === true && signedTo === minerAddr && signedOutputs === 2,
    `2e demande : ${JSON.stringify({ ok: rB.ok, error: rB.error })} ; écran : destinataire ${shown.includes(minerAddr) ? "de A" : "autre"} ; signée : vers ${signedTo === minerAddr ? "A" : signedTo}`);
} finally {
  await browser.close();
  app.close();
  try { process.kill(-proc.pid!, "SIGTERM"); } catch {}
}
process.exit(summary() ? 0 : 1);
