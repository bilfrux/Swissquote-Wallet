// Étape 8 (n°3) : alertes au client. bank-mock isolé :4130 (stockage neuf, surveillance périodique coupée,
// déclenchée à la main par POST /alerts/run). Prérequis : npm run regtest:up
import { type ChildProcess, spawn } from "node:child_process";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { buildSpend, createWalletConfig, outputAt, scan } from "@sq/bitcoin";
import { accountKey, masterFromMnemonic, newMnemonic } from "@sq/bitcoin/keys";
import { makeReport, miner, rpc } from "./lib.ts";

const BANK = "http://localhost:4130";
const DATA = `${process.cwd()}/.local/e2e-8-alerts`;
rmSync(DATA, { recursive: true, force: true });
const proc: ChildProcess = spawn("npm", ["run", "-s", "dev", "-w", "bank-mock"], {
  env: { ...process.env, BANK_MOCK_PORT: "4130", BANK_MOCK_DATA: DATA, ALERT_INTERVAL_MS: "0", ALERT_SIGNET_INTERVAL_MS: "0" }, stdio: "ignore", detached: true,
});
for (let i = 0; i < 100; i++) { try { if ((await fetch(`${BANK}/health`)).ok) break; } catch {} await new Promise((r) => setTimeout(r, 200)); }
const call = async (path: string, token?: string, body?: unknown) => {
  const r = await fetch(BANK + path, { method: body ? "POST" : "GET", headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, body: (await r.json()) as any };
};
const run = async () => (await call("/alerts/run", undefined, { network: "regtest" })).body;
const { report, summary } = makeReport();
const D = 6;

try {
  const token = (await call("/auth/login", undefined, { customerId: "CH-0003", password: "demo0003" })).body.token;
  const sq = (await call("/guardian/key?network=regtest")).body.accountKey;
  const key = () => accountKey(masterFromMnemonic(newMnemonic(), "regtest"));
  const tiers = key();
  const A = await createWalletConfig({ network: "regtest", delay: D, client: key(), swissquote: sq, tiers });
  const B = await createWalletConfig({ network: "regtest", delay: D, client: key(), swissquote: sq, tiers });
  for (const c of [A, B]) await call("/accounts/register", token, { network: "regtest", delay: D, client: c.client.raw, tiers: c.tiers.raw, tiersName: "Marie Dupont" });
  const m = await miner();
  await m.pay(outputAt(A, 0, 0).getAddress(), 0.05);
  await m.mine(1);

  const r1 = await run();
  report("8-11", "1 confirmation (recovery dans 5 blocs) : aucune alerte", r1.created === 0, `alertes créées : ${r1.created} ; erreurs : ${r1.errors.join(" | ") || "aucune"}`);

  await m.mine(3); // 4 confirmations : recovery dans 2 blocs (seuil ⌈6/3⌉ = 2)
  const r2 = await run();
  const r2bis = await run();
  report("8-12", "Recovery dans 2 blocs : alerte « bientôt » créée une seule fois (pas de doublon au passage suivant)", r2.created === 1 && r2bis.created === 0, `1er passage : ${r2.created} ; 2e passage : ${r2bis.created}`);

  await m.mine(2); // 6 confirmations : recovery ouverte
  const r3 = await run();
  report("8-13", "Recovery ouverte (D confirmations) : alerte « ouverte » créée", r3.created === 1, `alertes créées : ${r3.created}`);

  // Swissquote signe une recovery A -> B après re-KYC : alerte immédiate
  const kyc = (await call("/identity/verify", undefined, { customerId: "CH-0003", lastName: "Martin", birthDate: "1992-03-21", otp: "246810" })).body.token;
  const { psbt } = await buildSpend({ cfg: A, backend: rpc, utxos: await scan(A, rpc), path: "recovery", feeRate: 2, to: outputAt(B, 0, 0).getAddress() });
  const signed = await call("/guardian/sign", undefined, { token: kyc, network: "regtest", psbt });
  const list = (await call("/notifications", token)).body;
  const kinds = list.items.map((n: any) => n.kind);
  report("8-14", "Swissquote signe une recovery : le client reçoit immédiatement l'alerte « Swissquote a signé une demande de recovery »",
    signed.status === 200 && kinds[0] === "recovery-signee" && list.unread === 3,
    `alertes (récentes d'abord) : ${kinds.join(", ")} ; non lues : ${list.unread} ; « ${list.items[0]?.body.slice(0, 120)}… »`);

  const outbox = existsSync(`${DATA}/outbox.log`) ? readFileSync(`${DATA}/outbox.log`, "utf8").trim().split("\n") : [];
  report("8-15", "Chaque alerte est aussi « envoyée » par email simulé (outbox.log)", outbox.length === 3 && outbox.every((l) => l.includes("SIMULATED email to léa.martin@exemple.invalid")), `${outbox.length} ligne(s) ; ex. : ${outbox[0]?.slice(0, 140)}`);

  await call("/notifications/read", token, {});
  const after = (await call("/notifications", token)).body;
  const other = (await call("/notifications", (await call("/auth/login", undefined, { customerId: "CH-0002", password: "demo5678" })).body.token)).body;
  report("8-16", "Alertes marquées lues ; un autre client ne voit pas ces alertes", after.unread === 0 && other.items.length === 0, `non lues après lecture : ${after.unread} ; alertes visibles par CH-0002 : ${other.items.length}`);
} finally {
  try { process.kill(-proc.pid!, "SIGTERM"); } catch {}
}
process.exit(summary() ? 0 : 1);
