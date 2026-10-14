// Étape 56 : une clé Swissquote par compte. Avant, tous les clients partageaient la clé m/48'/1'/0'/2' : chaque script
// révélé on-chain portait une clé publique de Swissquote commune, et reliait les coins de tous les clients.
// bank-mock isolé :4450 (verrou désactivé, comme les tests des étapes < 38). Prérequis : npm run regtest:up
import { type ChildProcess, spawn } from "node:child_process";
import { readFileSync, rmSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { hex } from "@scure/base";
import { buildSpend, combinePsbts, createWalletConfig, finalizePsbt, outputAt, pubkeyAt, scan } from "@sq/bitcoin";
import { accountKey, masterFromMnemonic, newMnemonic } from "@sq/bitcoin/keys";
import { signPsbtWithMnemonic } from "@sq/bitcoin/sign";
import { makeReport, miner, nodeVerdict, rpc } from "./lib.ts";

const BANK = "http://localhost:4450";
const DATA = `${process.cwd()}/.local/e2e-56`;
rmSync(DATA, { recursive: true, force: true });
let proc: ChildProcess;
const startBank = async () => {
  proc = spawn("npm", ["run", "-s", "dev", "-w", "bank-mock"], { env: { ...process.env, BANK_MOCK_CRYPTO_LOCK: "off", BANK_MOCK_PORT: "4450", BANK_MOCK_DATA: DATA, ALERT_INTERVAL_MS: "0", ALERT_SIGNET_INTERVAL_MS: "0" }, stdio: "ignore", detached: true });
  for (let i = 0; i < 100; i++) { try { if ((await fetch(`${BANK}/health`)).ok) return; } catch {} await new Promise((r) => setTimeout(r, 200)); }
};
const stopBank = async () => { try { process.kill(-proc.pid!, "SIGTERM"); } catch {} await new Promise((r) => setTimeout(r, 800)); };
const call = async (method: string, path: string, body?: unknown) => {
  const r = await fetch(BANK + path, { method, headers: { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: r.status, body: (await r.json().catch(() => ({}))) as any };
};
const sqFor = async (client: string) => (await call("GET", `/guardian/key?network=regtest&client=${encodeURIComponent(client)}`)).body.accountKey as string;
const { report, summary } = makeReport();
const D = 6;

try {
  await startBank();
  const seeds = { a: newMnemonic(), b: newMnemonic(), tiers: newMnemonic() };
  const key = (m: string) => accountKey(masterFromMnemonic(m, "regtest"));
  const [ka, kb] = [key(seeds.a), key(seeds.b)];
  const [sqA, sqA2, sqB] = [await sqFor(ka), await sqFor(ka), await sqFor(kb)];
  const legacyKey = accountKey(masterFromMnemonic(JSON.parse(readFileSync(`${DATA}/swissquote-seed.json`, "utf8")).mnemonic, "regtest"));
  const noClient = await call("GET", "/guardian/key?network=regtest");
  const fp = (k: string) => k.slice(1, 9);
  const cfgA = await createWalletConfig({ network: "regtest", delay: D, client: ka, swissquote: sqA, tiers: key(seeds.tiers) });
  const cfgB = await createWalletConfig({ network: "regtest", delay: D, client: kb, swissquote: sqB, tiers: key(seeds.tiers) });
  const pubA = hex.encode(pubkeyAt(cfgA.swissquote, "regtest", 0, 0)), pubB = hex.encode(pubkeyAt(cfgB.swissquote, "regtest", 0, 0));
  report("56-1", "Clé Swissquote propre au compte : différente pour deux clients, stable pour un même compte, jamais la clé historique ; même empreinte Swissquote ; sans clé client : 400",
    sqA === sqA2 && sqA !== sqB && sqA !== legacyKey && sqB !== legacyKey && pubA !== pubB && fp(sqA) === fp(legacyKey) && fp(sqB) === fp(legacyKey) && noClient.status === 400,
    `A ${sqA.slice(0, 32)}… ; B ${sqB.slice(0, 32)}… ; clés publiques Swissquote à l'index 0 : ${pubA.slice(0, 12)}… ≠ ${pubB.slice(0, 12)}… ; sans clé client : ${noClient.status}`);

  // Enregistrement : Swissquote recalcule elle-même la clé du compte ; l'appli ne peut pas lui imposer la clé commune.
  const regA = await call("POST", "/accounts/register", { customerId: "CH-0001", network: "regtest", delay: D, client: ka, tiers: key(seeds.tiers), swissquote: legacyKey });
  const regB = await call("POST", "/accounts/register", { customerId: "CH-0001", network: "regtest", delay: D, client: kb, tiers: key(seeds.tiers) });
  const listed = (await call("POST", "/accounts/list", { token: (await call("POST", "/identity/verify", { customerId: "CH-0001", lastName: "Muster", birthDate: "1990-01-01", otp: "123456" })).body.token, network: "regtest" })).body.accounts;
  report("56-2", "Enregistrement : clé Swissquote recalculée par Swissquote (une clé imposée par l'appli est ignorée), renvoyée et listée pour chaque compte",
    regA.status === 200 && regA.body.swissquote === sqA && regB.body.swissquote === sqB && listed.length === 2 && listed[0].swissquote === sqA && listed[1].swissquote === sqB,
    `compte A ${regA.status} → ${fp(regA.body.swissquote)}…${regA.body.swissquote?.slice(10, 24)} ; compte B → ${regB.body.swissquote?.slice(10, 24)} ; listés : ${listed.length}`);

  // Recovery A → B, signée par Swissquote (clé du compte A) et le contact, refusée avant D, acceptée à D.
  const m = await miner();
  await m.pay(outputAt(cfgA, 0, 0).getAddress(), 0.1);
  await m.mine(1);
  const kyc = (await call("POST", "/identity/verify", { customerId: "CH-0001", lastName: "Muster", birthDate: "1990-01-01", otp: "123456" })).body.token;
  const rec = await buildSpend({ cfg: cfgA, backend: rpc, utxos: await scan(cfgA, rpc), path: "recovery", feeRate: 2, to: outputAt(cfgB, 0, 0).getAddress() });
  const sq = await call("POST", "/guardian/sign", { token: kyc, network: "regtest", psbt: rec.psbt });
  const both = combinePsbts([sq.body.psbt, signPsbtWithMnemonic(rec.psbt, seeds.tiers, "regtest").psbt]);
  const early = await nodeVerdict(finalizePsbt(cfgA, both).hex);
  await m.mine(D);
  const atD = await nodeVerdict(finalizePsbt(cfgA, both).hex);
  report("56-3", "Recovery d'un compte à clé propre : signée par Swissquote (clé du compte) et le contact ; refusée avant D, acceptée à D",
    sq.status === 200 && sq.body.added === 1 && early === "non-BIP68-final" && atD === "accepted", `Swissquote ${sq.status} (+${sq.body.added}) ; avant D : ${early} ; à D : ${atD}`);

  // Compte historique (enregistré avant l'étape 56, sans clé propre en base) : toujours servi par la clé commune.
  await stopBank();
  const seedL = newMnemonic();
  const cfgL = await createWalletConfig({ network: "regtest", delay: D, client: key(seedL), swissquote: legacyKey, tiers: key(seeds.tiers) });
  const db = new DatabaseSync(`${DATA}/bank-mock.sqlite`);
  db.prepare("insert into accounts (customer_id, network, delay, client_key, tiers_key, tiers_name) values (?, ?, ?, ?, ?, ?)").run("CH-0001", "regtest", D, cfgL.client.raw, cfgL.tiers.raw, "Marie Dupont");
  db.close();
  await startBank();
  const kyc2 = (await call("POST", "/identity/verify", { customerId: "CH-0001", lastName: "Muster", birthDate: "1990-01-01", otp: "123456" })).body.token;
  const listed2 = (await call("POST", "/accounts/list", { token: kyc2, network: "regtest" })).body.accounts;
  const legacyRow = listed2.find((a: any) => a.client === cfgL.client.raw);
  await m.pay(outputAt(cfgL, 0, 0).getAddress(), 0.05);
  await m.mine(1);
  const recL = await buildSpend({ cfg: cfgL, backend: rpc, utxos: await scan(cfgL, rpc), path: "recovery", feeRate: 2, to: outputAt(cfgB, 0, 1).getAddress() });
  const sqL = await call("POST", "/guardian/sign", { token: kyc2, network: "regtest", psbt: recL.psbt });
  report("56-4", "Compte historique (sans clé propre en base) : listé avec la clé commune, et sa recovery reste signée par Swissquote",
    legacyRow?.swissquote === legacyKey && sqL.status === 200 && sqL.body.added === 1, `clé listée = clé historique : ${legacyRow?.swissquote === legacyKey} ; signature Swissquote : ${sqL.status} (+${sqL.body.added})`);
} finally {
  await stopBank();
}
process.exit(summary() ? 0 : 1);
