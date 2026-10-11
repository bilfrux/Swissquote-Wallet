// A3 (petite étape) : relais Swissquote vers le tiers de confiance, sans copier-coller. bank-mock isolé :4160 (regtest).
// Prérequis : npm run regtest:up
import { type ChildProcess, spawn } from "node:child_process";
import { rmSync } from "node:fs";
import { buildSpend, combinePsbts, createWalletConfig, outputAt, scan, simulate } from "@sq/bitcoin";
import { accountKey, masterFromMnemonic, newMnemonic } from "@sq/bitcoin/keys";
import { signPsbtWithMnemonic } from "@sq/bitcoin/sign";
import { makeReport, miner, rpc } from "./lib.ts";

const BANK = "http://localhost:4160";
const DATA = `${process.cwd()}/.local/e2e-12`;
rmSync(DATA, { recursive: true, force: true });
const proc: ChildProcess = spawn("npm", ["run", "-s", "dev", "-w", "bank-mock"], { env: { ...process.env, BANK_MOCK_CRYPTO_LOCK: "off", BANK_MOCK_PORT: "4160", BANK_MOCK_DATA: DATA, ALERT_INTERVAL_MS: "0", ALERT_SIGNET_INTERVAL_MS: "0" }, stdio: "ignore", detached: true });
for (let i = 0; i < 100; i++) { try { if ((await fetch(`${BANK}/health`)).ok) break; } catch {} await new Promise((r) => setTimeout(r, 200)); }
const call = async (method: string, path: string, token?: string, body?: unknown) => {
  const r = await fetch(BANK + path, { method, headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, body: (await r.json()) as any };
};
const { report, summary } = makeReport();

try {
  const token = (await call("POST", "/auth/login", undefined, { customerId: "CH-0003", password: "demo0003" })).body.token;
  const tiersSeed = newMnemonic();
  const sq = (await call("GET", "/guardian/key?network=regtest")).body.accountKey;
  const cfg = await createWalletConfig({ network: "regtest", delay: 6, client: accountKey(masterFromMnemonic(newMnemonic(), "regtest")), swissquote: sq, tiers: accountKey(masterFromMnemonic(tiersSeed, "regtest")) });
  const m = await miner();
  await m.pay(outputAt(cfg, 0, 0).getAddress(), 0.2);
  await m.mine(7); // délai D=6 atteint : chemin de recovery
  const { psbt } = await buildSpend({ cfg, backend: rpc, utxos: await scan(cfg, rpc), path: "recovery", feeRate: 2, to: m.addr });

  const noSession = await call("POST", "/relay", undefined, { psbt });
  const created = await call("POST", "/relay", token, { psbt });
  const id = created.body.id;
  const got = await call("GET", `/relay?id=${id}`);
  report("12-1", "Le client dépose la demande (session requise) ; le tiers la lit par l'identifiant du lien, sans copier-coller",
    noSession.status === 401 && created.status === 200 && /^[0-9a-f]{32}$/.test(id) && got.body.psbt === psbt && got.body.signed === null,
    `sans session : ${noSession.status} ; identifiant ${id} (128 bits) ; PSBT relu identique : ${got.body.psbt === psbt}`);

  // Le tiers signe dans sa console (même fonction), renvoie ; une autre transaction est refusée.
  const signed = signPsbtWithMnemonic(psbt, tiersSeed, "regtest").psbt;
  const { psbt: other } = await buildSpend({ cfg, backend: rpc, utxos: await scan(cfg, rpc), path: "recovery", feeRate: 3, to: m.addr });
  const bad = await call("POST", "/relay/signed", undefined, { id, psbt: signPsbtWithMnemonic(other, tiersSeed, "regtest").psbt });
  const unknown = await call("GET", "/relay?id=00000000000000000000000000000000");
  const ok = await call("POST", "/relay/signed", undefined, { id, psbt: signed });
  const back = (await call("GET", `/relay?id=${id}`)).body.signed;
  const sigs = simulate(cfg, combinePsbts([psbt, back])).inputs.map((i) => i.signatures);
  report("12-2", "Signature du tiers renvoyée par le relais et récupérée par le client ; PSBT d'une autre transaction refusé ; identifiant inconnu refusé",
    bad.status === 400 && unknown.status === 404 && ok.status === 200 && back === signed && sigs.every((n) => n === 1),
    `autre transaction : ${bad.status} « ${bad.body.error} » ; inconnu : ${unknown.status} ; renvoi : ${ok.status} ; signatures du tiers par coin : ${sigs.join(",")}`);
} finally {
  try { process.kill(-proc.pid!, "SIGTERM"); } catch {}
}
process.exit(summary() ? 0 : 1);
