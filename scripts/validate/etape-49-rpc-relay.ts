// Étape 49 : le relais RPC de développement de l'appli (regtest) ne transmet que ce dont l'appli a besoin.
// Appli isolée :5213 (Vite, regtest). Prérequis : npm run regtest:up
import { type ChildProcess, spawn } from "node:child_process";
import { makeReport, rpc } from "./lib.ts";

const APP = "http://localhost:5213";
const proc: ChildProcess = spawn("npx", ["vite", "--port", "5213", "--strictPort"], { cwd: "client", env: { ...process.env, VITE_BTC_NETWORK: "regtest" }, stdio: "ignore", detached: true });
for (let i = 0; i < 150; i++) { try { if ((await fetch(APP)).ok) break; } catch {} await new Promise((r) => setTimeout(r, 200)); }
const { report, summary } = makeReport();
const call = async (path: string, method: string, params: unknown[] = [], headers: Record<string, string> = {}) => {
  const r = await fetch(`${APP}/regtest-rpc${path}`, { method: "POST", headers: { "content-type": "text/plain", origin: APP, ...headers }, body: JSON.stringify({ jsonrpc: "1.0", id: 1, method, params }) });
  const j: any = await r.json().catch(() => ({}));
  return { status: r.status, result: j.result, error: j.error?.message as string | undefined };
};

try {
  const tip = await rpc.call("getblockcount");
  const ok = await call("/", "getblockcount");
  const fees = await call("/", "estimatesmartfee", [3]);
  const watch = await call("/", "listwallets");
  report("49-1", "Méthodes de l'appli transmises : hauteur de la chaîne, frais, liste des portefeuilles", ok.status === 200 && ok.result === tip && fees.status === 200 && watch.status === 200,
    `getblockcount ${ok.status} = ${ok.result} (nœud : ${tip}) ; estimatesmartfee ${fees.status} ; listwallets ${watch.status}`);

  const loaded: string[] = await rpc.call("listwallets");
  const omni = await call("/wallet/sq-omnibus", "sendtoaddress", ["bcrt1qw508d6qejxtdg4y5r3zarvary0c5xw7kygt080", 1]);
  const omniBal = await call("/wallet/sq-omnibus", "getbalance");
  const stop = await call("/", "stop");
  const dump = await call("/wallet/sq-watch-abc", "dumpwallet", ["/tmp/x"]);
  const keyed = await call("/", "createwallet", ["sq-watch-x", false, false]);
  const other = await call("/", "loadwallet", ["sq-omnibus"]);
  const batch = await fetch(`${APP}/regtest-rpc/`, { method: "POST", headers: { origin: APP }, body: JSON.stringify([{ method: "getblockcount", params: [] }]) });
  const stillUp = await rpc.call("getblockcount").then(() => true, () => false);
  report("49-2", "Refusé : sendtoaddress et getbalance sur le portefeuille de garde, stop, dumpwallet, portefeuille avec clés privées, chargement d'un autre portefeuille, requête groupée ; le nœud reste en marche",
    [omni, omniBal, stop, dump, keyed, other].every((r) => r.status === 403) && batch.status === 403 && stillUp,
    `sendtoaddress ${omni.status} « ${omni.error} » ; getbalance ${omniBal.status} ; stop ${stop.status} ; dumpwallet ${dump.status} ; createwallet avec clés ${keyed.status} ; loadwallet sq-omnibus ${other.status} ; lot ${batch.status} ; nœud en marche : ${stillUp} (portefeuilles chargés : ${loaded.length})`);

  const csrf = await call("/", "getblockcount", [], { origin: "http://attacker.example" });
  report("49-3", "Requête d'un autre site (Origin étranger) refusée avant d'atteindre le nœud (CSRF)", csrf.status === 403, `${csrf.status} « ${csrf.error} »`);
} finally {
  try { process.kill(-proc.pid!, "SIGTERM"); } catch {}
}
process.exit(summary() ? 0 : 1);
