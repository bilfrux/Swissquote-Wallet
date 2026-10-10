// Budget de requêtes Esplora d'un rafraîchissement (scan + historique), mesuré hors ligne avec une fausse API
// qui compte les appels. Compte avec 2 adresses utilisées (réception 0 et change 0). Avant : 20 adresses par chaîne.
import { EsploraBackend, createWalletConfig, history, outputAt, scan } from "@sq/bitcoin";
import { accountKey, masterFromMnemonic, newMnemonic } from "@sq/bitcoin/keys";
import { makeReport } from "./lib.ts";

const key = () => accountKey(masterFromMnemonic(newMnemonic(), "signet"));
const cfg = await createWalletConfig({ network: "signet", delay: 6, client: key(), swissquote: key(), tiers: key() });
const used = new Set([outputAt(cfg, 0, 0).getAddress(), outputAt(cfg, 1, 0).getAddress()]);
const calls: string[] = [];
const tx = (addr: string) => ({ txid: "aa".repeat(32), status: { confirmed: true, block_height: 100, block_time: 1 }, fee: 100, vin: [], vout: [{ scriptpubkey_address: addr, value: 5000 }] });
globalThis.fetch = (async (url: string) => {
  const path = String(url).replace("https://fake/api", "");
  calls.push(path);
  const m = path.match(/^\/address\/([^/]+)\/(txs|utxo)$/);
  let body: unknown = 100;
  if (m) body = used.has(m[1]) ? (m[2] === "txs" ? [tx(m[1])] : [{ txid: "aa".repeat(32), vout: 0, value: 5000, status: { confirmed: true, block_height: 100 } }]) : [];
  return new Response(JSON.stringify(body), { status: 200 });
}) as typeof fetch;

const chain = new EsploraBackend("https://fake/api");
const utxos = await scan(cfg, chain);
const h = await history(cfg, chain);
const { report, summary } = makeReport();
report("9-7", "Esplora : un rafraîchissement (scan + historique) reste sous ~20 requêtes grâce à la limite d'écart et au cache (avant : ~80)",
  calls.length <= 20 && utxos.length === 2 && h.length >= 1,
  `${calls.length} requêtes (${calls.filter((c) => c.endsWith("/txs")).length} txs, ${calls.filter((c) => c.endsWith("/utxo")).length} utxo, ${calls.filter((c) => c.includes("tip")).length} hauteur) ; coins trouvés : ${utxos.length}`);
process.exit(summary() ? 0 : 1);
