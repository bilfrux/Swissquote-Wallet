// A1 : authentification et montants élevés (partie Node). Wallet du client :5197 et bank-mock :4140 isolés.
// Prérequis : npm run regtest:up
import { type ChildProcess, spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { rmSync } from "node:fs";
import { buildSpend, createWalletConfig, outputAt, scan } from "@sq/bitcoin";
import { accountKey, masterFromMnemonic, newMnemonic } from "@sq/bitcoin/keys";
import { makeReport, miner, rpc } from "./lib.ts";

const WALLET = "http://localhost:5197", BANK = "http://localhost:4140";
const DATA = `${process.cwd()}/.local/e2e-10`;
rmSync(DATA, { recursive: true, force: true });
const procs: ChildProcess[] = [];
const start = (cmd: string[], env: Record<string, string>) => procs.push(spawn(cmd[0], cmd.slice(1), { env: { ...process.env, ...env }, stdio: "ignore", detached: true }));
start(["npm", "run", "-s", "dev", "-w", "client-wallet"], { CLIENT_WALLET_PORT: "5197", CLIENT_WALLET_DATA: `${DATA}/wallet` });
start(["npm", "run", "-s", "dev", "-w", "bank-mock"], { BANK_MOCK_PORT: "4140", BANK_MOCK_DATA: `${DATA}/bank`, ALERT_INTERVAL_MS: "0", ALERT_SIGNET_INTERVAL_MS: "0" });
for (const u of [`${WALLET}/api/wallets`, `${BANK}/health`]) for (let i = 0; i < 100; i++) { try { if ((await fetch(u)).ok) break; } catch {} await new Promise((r) => setTimeout(r, 200)); }
const post = async (base: string, path: string, body: unknown, token?: string) => {
  const r = await fetch(base + path, { method: "POST", headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body) });
  return { status: r.status, body: (await r.json()) as any };
};
const { report, summary } = makeReport();
// Depuis l'étape 36, le Client Wallet se déverrouille par biométrie (secret PRF) : secret simulé ici, comme à l'étape 37.
const BIO = { credentialId: randomBytes(32).toString("base64url"), prfSalt: randomBytes(32).toString("base64url"), prf: randomBytes(32).toString("base64url") };

try {
  // Wallet du client avec un compte regtest financé (0,5 BTC)
  const w = await post(WALLET, "/api/wallets", { network: "regtest", bio: BIO });
  const sq = accountKey(masterFromMnemonic(newMnemonic(), "regtest")), t = accountKey(masterFromMnemonic(newMnemonic(), "regtest"));
  const cfg = await createWalletConfig({ network: "regtest", delay: 6, client: w.body.wallet.accountKey, swissquote: sq, tiers: t });
  await post(WALLET, `/api/wallets/${w.body.wallet.id}/policy`, { policy: { network: "regtest", delay: 6, swissquote: sq, tiers: t }, prf: BIO.prf });
  const m = await miner();
  await m.pay(outputAt(cfg, 0, 0).getAddress(), 0.5);
  await m.mine(1);
  const utxos = await scan(cfg, rpc);

  const big = await buildSpend({ cfg, backend: rpc, utxos, path: "client", feeRate: 2, to: m.addr, amount: 25_000_000n, changeIndex: 0 });
  const d = await post(WALLET, "/api/describe", { psbt: big.psbt, network: "regtest" });
  const tail = m.addr.slice(-6);
  const none = await post(WALLET, "/api/sign", { psbt: big.psbt, network: "regtest", prf: BIO.prf });
  const wrong = await post(WALLET, "/api/sign", { psbt: big.psbt, network: "regtest", prf: BIO.prf, confirmDest: "zzzzzz" });
  const ok = await post(WALLET, "/api/sign", { psbt: big.psbt, network: "regtest", prf: BIO.prf, confirmDest: tail.toUpperCase() });
  report("10-1", "Wallet : 0,25 BTC (≥ seuil de 0,2 BTC) marqué « montant élevé » ; signature refusée sans les 6 derniers caractères de l'adresse ou avec des caractères faux, acceptée avec les bons",
    d.body.high === true && none.status === 400 && wrong.status === 400 && ok.status === 200 && ok.body.added === 1,
    `envoyé ${d.body.sent} sats, seuil ${d.body.highValueSats} ; sans : ${none.status} « ${none.body.error} » ; faux : ${wrong.status} ; bons (« ${tail} ») : ${ok.status}`);

  const small = await buildSpend({ cfg, backend: rpc, utxos, path: "client", feeRate: 2, to: m.addr, amount: 5_000_000n, changeIndex: 0 });
  const ds = await post(WALLET, "/api/describe", { psbt: small.psbt, network: "regtest" });
  const sOk = await post(WALLET, "/api/sign", { psbt: small.psbt, network: "regtest", prf: BIO.prf });
  report("10-2", "Wallet : 0,05 BTC (sous le seuil) signé avec la seule biométrie", ds.body.high === false && sOk.status === 200, `high=${ds.body.high} ; signature : ${sOk.status}`);

  // bank-mock : passkeys et step-up (cas négatifs ; les cas positifs exigent un authentificateur : test Chrome)
  const token = (await post(BANK, "/auth/login", { customerId: "CH-0003", password: "demo0003" })).body.token;
  const noPk = await post(BANK, "/auth/stepup/options", {}, token);
  const noLogin = await post(BANK, "/auth/passkey/login/options", { customerId: "CH-0003" });
  const noSession = await post(BANK, "/auth/stepup/options", {});
  const fake = await post(BANK, "/auth/stepup/verify", { response: { id: "AAAA", rawId: "AAAA", type: "public-key", response: {} }, amountSats: 25_000_000 }, token);
  report("10-3", "Swissquote : step-up impossible sans passkey enregistrée, sans session, ou avec une assertion inventée",
    noPk.status === 404 && noLogin.status === 404 && noSession.status === 401 && fake.status === 403,
    `sans passkey : ${noPk.status} « ${noPk.body.error} » ; connexion passkey : ${noLogin.status} ; sans session : ${noSession.status} ; assertion inventée : ${fake.status} « ${fake.body.error} »`);
} finally {
  procs.forEach((p) => { try { process.kill(-p.pid!, "SIGTERM"); } catch {} });
}
process.exit(summary() ? 0 : 1);
