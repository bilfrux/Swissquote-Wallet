// A2 : transferts compte Swissquote <-> wallet self-custody sous la Travel Rule. bank-mock isolé :4150 (regtest).
// La preuve de propriété est signée comme le fait le Wallet du client (même dérivation, BIP-322 « simple », bip322-js).
// Prérequis : npm run regtest:up
import { type ChildProcess, spawn } from "node:child_process";
import { rmSync } from "node:fs";
import { Signer } from "bip322-js";
import { btc } from "@bitcoinerlab/descriptors-scure";
import { btcNetwork, buildSpend, combinePsbts, createWalletConfig, finalizePsbt, keyAddressOf, outputAt, scan } from "@sq/bitcoin";
import { accountKey, masterFromMnemonic, newMnemonic } from "@sq/bitcoin/keys";
import { signPsbtWithMnemonic } from "@sq/bitcoin/sign";
import { makeReport, miner, rpc } from "./lib.ts";

const BANK = "http://localhost:4150";
const DATA = `${process.cwd()}/.local/e2e-11`;
rmSync(DATA, { recursive: true, force: true });
const proc: ChildProcess = spawn("npm", ["run", "-s", "dev", "-w", "bank-mock"], { env: { ...process.env, BANK_MOCK_CRYPTO_LOCK: "off", BANK_MOCK_PORT: "4150", BANK_MOCK_DATA: DATA, ALERT_INTERVAL_MS: "0", ALERT_SIGNET_INTERVAL_MS: "0" }, stdio: "ignore", detached: true });
for (let i = 0; i < 100; i++) { try { if ((await fetch(`${BANK}/health`)).ok) break; } catch {} await new Promise((r) => setTimeout(r, 200)); }
const call = async (method: string, path: string, token: string, body?: unknown) => {
  const r = await fetch(BANK + path, { method, headers: { "content-type": "application/json", authorization: `Bearer ${token}` }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, body: (await r.json()) as any };
};
const { report, summary } = makeReport();

try {
  const token = (await (await fetch(`${BANK}/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ customerId: "CH-0003", password: "demo0003" }) })).json()).token;
  const seed = newMnemonic();
  const sq = (await (await fetch(`${BANK}/guardian/key?network=regtest&client=${encodeURIComponent(accountKey(masterFromMnemonic(seed, "regtest")))}`)).json()).accountKey; // clé du compte (étape 56)
  const cfg = await createWalletConfig({ network: "regtest", delay: 6, client: accountKey(masterFromMnemonic(seed, "regtest")), swissquote: sq, tiers: accountKey(masterFromMnemonic(newMnemonic(), "regtest")) });
  await call("POST", "/accounts/register", token, { network: "regtest", delay: 6, client: cfg.client.raw, tiers: cfg.tiers.raw, tiersName: "Marie Dupont" });
  const dest = outputAt(cfg, 0, 0).getAddress();
  const m = await miner();

  const bal0 = (await call("GET", "/custody?network=regtest", token)).body.balanceSats;
  const noProof = await call("POST", "/custody/withdraw", token, { network: "regtest", address: dest, amountSats: 30_000_000 });
  const foreign = await call("POST", "/custody/withdraw", token, { network: "regtest", address: m.addr, amountSats: 30_000_000 });
  report("11-1", "Retrait sans preuve de propriété : refusé (Travel Rule) ; vers une adresse qui n'est pas un wallet enregistré du client : refusé",
    bal0 === 80_000_000 && noProof.status === 412 && noProof.body.needProof === true && foreign.status === 403,
    `solde Swissquote ${bal0} sats ; sans preuve : ${noProof.status} « ${noProof.body.error} » ; adresse étrangère : ${foreign.status} « ${foreign.body.error} »`);

  // Preuve de propriété (comme le Wallet du client), puis retrait
  const ch = await call("POST", "/ownership/challenge", token, { network: "regtest", client: cfg.client.raw, change: 0, index: 0 });
  const k = masterFromMnemonic(seed, "regtest").derive("m/48'/1'/0'/2'/0/0");
  const sig = Signer.sign(btc.WIF(btcNetwork("regtest")).encode(k.privateKey!), keyAddressOf(k.publicKey!, "regtest"), ch.body.message);
  const v = await call("POST", "/ownership/verify", token, { challengeId: ch.body.challengeId, signature: sig });
  const wd = await call("POST", "/custody/withdraw", token, { network: "regtest", address: dest, amountSats: 30_000_000 });
  await m.mine(1);
  const got = (await scan(cfg, rpc)).reduce((s, u) => s + u.value, 0n);
  const rec = (await call("GET", "/custody/travel-rule?network=regtest", token)).body.records[0];
  report("11-2", "Après preuve de propriété vérifiée : retrait de 0,3 BTC envoyé on-chain par le portefeuille omnibus de Swissquote, reçu dans le wallet ; solde Swissquote débité",
    v.body.verified === true && wd.status === 200 && got === 30_000_000n && wd.body.balanceSats === 50_000_000,
    `txid ${wd.body.txid} ; reçu dans le wallet : ${got} sats ; solde Swissquote : ${wd.body.balanceSats} sats`);
  report("11-3", "Enregistrement Travel Rule du retrait : donneur d'ordre et bénéficiaire, wallet auto-hébergé, référence de la preuve",
    rec?.direction === "sortant" && rec.txid === wd.body.txid && rec.verification.startsWith("proof of ownership") && rec.beneficiary.includes("self-hosted wallet"),
    `${rec?.originator} → ${rec?.beneficiary} ; ${rec?.verification}`);

  const over = await call("POST", "/custody/withdraw", token, { network: "regtest", address: dest, amountSats: 90_000_000 });
  report("11-4", "Retrait supérieur aux avoirs : refusé", over.status === 400, `${over.status} « ${over.body.error} »`);

  // Dépôt depuis le wallet (provenance vérifiable), puis dépôt d'une source inconnue
  const depAddr = (await call("GET", "/custody/deposit-address?network=regtest", token)).body.address;
  const { psbt } = await buildSpend({ cfg, backend: rpc, utxos: await scan(cfg, rpc), path: "client", feeRate: 2, to: depAddr, amount: 10_000_000n, changeIndex: 0 });
  await rpc.broadcast(finalizePsbt(cfg, combinePsbts([signPsbtWithMnemonic(psbt, seed, "regtest").psbt])).hex);
  await m.pay(depAddr, 0.05); // source inconnue (pas un wallet enregistré du client)
  await m.mine(1);
  const sync = (await call("POST", "/custody/sync", token, { network: "regtest" })).body;
  const bal2 = (await call("GET", "/custody?network=regtest", token)).body.balanceSats;
  const recs = (await call("GET", "/custody/travel-rule?network=regtest", token)).body.records.filter((r: any) => r.direction === "entrant");
  report("11-5", "Dépôts : celui du wallet du client (provenance vérifiée) est crédité ; celui d'une source inconnue est mis en attente, non crédité",
    sync.credited === 1 && sync.held === 1 && bal2 === 60_000_000 && recs.some((r: any) => r.status === "crédité") && recs.some((r: any) => r.status === "en attente de vérification"),
    `crédités : ${sync.credited}, en attente : ${sync.held} ; solde Swissquote : ${bal2} sats ; ${recs.map((r: any) => `${r.status} (${r.verification})`).join(" | ")}`);

  const signet = await call("POST", "/custody/withdraw", token, { network: "signet", address: dest, amountSats: 30_000_000 });
  report("11-6", "Signet : compte crypto Swissquote non disponible (portefeuille omnibus non approvisionné), refus explicite", signet.status === 501, `${signet.status} « ${signet.body.error} »`);
} finally {
  try { process.kill(-proc.pid!, "SIGTERM"); } catch {}
}
process.exit(summary() ? 0 : 1);
