// Étape 52 : bank-mock. Requêtes JSON seulement (anti-CSRF), JSON invalide → 400, corps limité ; retraits custody un par
// un (pas de double dépense du solde) ; frais d'une recovery plafonnés ; re-KYC bloqué après 5 échecs.
// bank-mock isolé :4430 (verrou crypto désactivé, comme les tests des étapes < 38). Prérequis : npm run regtest:up
import { type ChildProcess, spawn } from "node:child_process";
import { rmSync } from "node:fs";
import { Signer } from "bip322-js";
import { btc } from "@bitcoinerlab/descriptors-scure";
import { btcNetwork, buildSpend, createWalletConfig, keyAddressOf, outputAt, scan } from "@sq/bitcoin";
import { accountKey, masterFromMnemonic, newMnemonic } from "@sq/bitcoin/keys";
import { makeReport, miner, rpc } from "./lib.ts";

const BANK = "http://localhost:4430";
const DATA = `${process.cwd()}/.local/e2e-52`;
rmSync(DATA, { recursive: true, force: true });
const proc: ChildProcess = spawn("npm", ["run", "-s", "dev", "-w", "bank-mock"], { env: { ...process.env, BANK_MOCK_CRYPTO_LOCK: "off", BANK_MOCK_PORT: "4430", BANK_MOCK_DATA: DATA, ALERT_INTERVAL_MS: "0", ALERT_SIGNET_INTERVAL_MS: "0" }, stdio: "ignore", detached: true });
for (let i = 0; i < 100; i++) { try { if ((await fetch(`${BANK}/health`)).ok) break; } catch {} await new Promise((r) => setTimeout(r, 200)); }
const call = async (method: string, path: string, body?: unknown, token?: string, type = "application/json") => {
  const r = await fetch(BANK + path, { method, headers: { "content-type": type, ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body) });
  return { status: r.status, body: (await r.json().catch(() => ({}))) as any };
};
const { report, summary } = makeReport();

try {
  // --- 52-1 : format des requêtes ---
  const login = { customerId: "CH-0003", password: "demo0003" };
  const plain = await call("POST", "/auth/login", JSON.stringify(login), undefined, "text/plain");
  const form = await call("POST", "/relay/signed", "id=x&psbt=y", undefined, "application/x-www-form-urlencoded");
  const broken = await call("POST", "/auth/login", "{pas du json");
  const huge = await call("POST", "/relay/signed", { id: "x", psbt: "A".repeat(2_000_000) });
  const charset = await call("POST", "/auth/login", login, undefined, "application/json; charset=utf-8");
  report("52-1", "Requêtes : text/plain et formulaire refusés (415), JSON invalide 400, corps de 2 Mo refusé (413), JSON avec charset accepté",
    plain.status === 415 && form.status === 415 && broken.status === 400 && huge.status === 413 && charset.status === 200 && !!charset.body.token,
    `text/plain ${plain.status} ; formulaire ${form.status} ; JSON invalide ${broken.status} « ${broken.body.error} » ; 2 Mo ${huge.status} ; charset ${charset.status}`);
  const token = charset.body.token as string;

  // --- 52-2 : deux retraits simultanés ne dépensent pas deux fois le même solde (0,8 BTC, 2 × 0,5 BTC) ---
  const seed = newMnemonic();
  const sq = (await call("GET", "/guardian/key?network=regtest")).body.accountKey;
  const tiers = accountKey(masterFromMnemonic(newMnemonic(), "regtest"));
  const cfg = await createWalletConfig({ network: "regtest", delay: 6, client: accountKey(masterFromMnemonic(seed, "regtest")), swissquote: sq, tiers });
  await call("POST", "/accounts/register", { network: "regtest", delay: 6, client: cfg.client.raw, tiers, tiersName: "Marie Dupont" }, token);
  const dest = outputAt(cfg, 0, 0).getAddress();
  const ch = await call("POST", "/ownership/challenge", { network: "regtest", client: cfg.client.raw, change: 0, index: 0 }, token);
  const k = masterFromMnemonic(seed, "regtest").derive("m/48'/1'/0'/2'/0/0");
  await call("POST", "/ownership/verify", { challengeId: ch.body.challengeId, signature: Signer.sign(btc.WIF(btcNetwork("regtest")).encode(k.privateKey!), keyAddressOf(k.publicKey!, "regtest"), ch.body.message) }, token);
  const before = (await call("GET", "/custody?network=regtest", undefined, token)).body.balanceSats;
  const both = await Promise.all([1, 2].map(() => call("POST", "/custody/withdraw", { network: "regtest", address: dest, amountSats: 50_000_000 }, token)));
  const after = (await call("GET", "/custody?network=regtest", undefined, token)).body.balanceSats;
  const m = await miner();
  await m.mine(1);
  const received = (await scan(cfg, rpc)).reduce((s, u) => s + u.value, 0n);
  report("52-2", "Deux retraits simultanés de 0,5 BTC pour 0,8 BTC d'avoirs : un seul passe, l'autre est refusé ; solde et réception cohérents",
    before === 80_000_000 && both.filter((r) => r.status === 200).length === 1 && both.filter((r) => r.status === 400).length === 1 && after === 30_000_000 && received === 50_000_000n,
    `statuts ${both.map((r) => r.status).join(" / ")} (« ${both.find((r) => r.status !== 200)?.body.error} ») ; solde ${before} → ${after} sats ; reçu dans le wallet : ${received} sats`);

  // --- 52-3 : frais d'une recovery plafonnés ---
  const newCfg = await createWalletConfig({ network: "regtest", delay: 6, client: accountKey(masterFromMnemonic(newMnemonic(), "regtest")), swissquote: sq, tiers });
  await call("POST", "/accounts/register", { network: "regtest", delay: 6, client: newCfg.client.raw, tiers, tiersName: "Marie Dupont" }, token);
  await m.pay(outputAt(cfg, 0, 1).getAddress(), 0.001);
  await m.mine(1);
  const small = (await scan(cfg, rpc)).filter((u) => u.value === 100_000n);
  const kyc = (await call("POST", "/identity/verify", { customerId: "CH-0003", lastName: "Martin", birthDate: "1992-03-21", otp: "246810" })).body.token;
  const greedy = await buildSpend({ cfg, backend: rpc, utxos: small, path: "recovery", feeRate: 200, to: outputAt(newCfg, 0, 0).getAddress() });
  const fair = await buildSpend({ cfg, backend: rpc, utxos: small, path: "recovery", feeRate: 2, to: outputAt(newCfg, 0, 0).getAddress() });
  const rg = await call("POST", "/guardian/sign", { token: kyc, network: "regtest", psbt: greedy.psbt });
  const rf = await call("POST", "/guardian/sign", { token: kyc, network: "regtest", psbt: fair.psbt });
  report("52-3", "Recovery dont les frais dépassent 5 % du montant : Swissquote refuse de signer (403) ; frais normaux : signée",
    rg.status === 403 && /fee too high/.test(rg.body.error) && rf.status === 200 && rf.body.added > 0,
    `frais ${greedy.summary.fee} sats sur 100000 : ${rg.status} « ${rg.body.error} » ; frais ${fair.summary.fee} sats : ${rf.status}`);

  // --- 52-4 : re-KYC bloqué après 5 échecs ---
  const wrong = [];
  for (let i = 0; i < 5; i++) wrong.push((await call("POST", "/identity/verify", { customerId: "CH-0002", lastName: "Exemple", birthDate: "1985-06-15", otp: String(100000 + i) })).status);
  const right = await call("POST", "/identity/verify", { customerId: "CH-0002", lastName: "Exemple", birthDate: "1985-06-15", otp: "654321" });
  const otherClient = await call("POST", "/identity/verify", { customerId: "CH-0001", lastName: "Muster", birthDate: "1990-01-01", otp: "123456" });
  report("52-4", "Re-KYC : après 5 codes faux, même le bon code est refusé (429) ; les autres clients ne sont pas touchés",
    wrong.every((s) => s === 403) && right.status === 429 && otherClient.status === 200, `codes faux : ${wrong.join(", ")} ; bon code ensuite : ${right.status} « ${right.body.error} » ; autre client : ${otherClient.status}`);
} finally {
  try { process.kill(-proc.pid!, "SIGTERM"); } catch {}
}
process.exit(summary() ? 0 : 1);
