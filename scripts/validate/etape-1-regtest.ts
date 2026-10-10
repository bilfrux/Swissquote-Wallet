// Validation de l'étape 1 en regtest : politique à un délai, adresse, réception, dépense du client
// signée par un signataire EXTERNE (tools/client-signer, puis Bitcoin Core), finalisée et diffusée par la bibliothèque de l'appli.
// Prérequis : npm run regtest:up
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { BitcoindBackend, createWalletConfig, descriptor, finalizePsbt, nextIndex, scan, buildSpend, simulate } from "@sq/bitcoin";
import { accountKey, accountPrivateKey, masterFromMnemonic, newMnemonic } from "@sq/bitcoin/keys";

const RPC = process.env.BTC_RPC_URL ?? "http://regtest:regtest@127.0.0.1:18443";
const rpc = new BitcoindBackend(RPC);
const DIR = ".local/regtest";
mkdirSync(DIR, { recursive: true });

const results: [string, string, boolean][] = [];
const report = (id: string, label: string, ok: boolean, detail: string) => {
  results.push([id, label, ok]);
  console.log(`[${ok ? "OK " : "KO "}] ${id} ${label}\n       ${detail}`);
};
const sats = (b: number) => BigInt(Math.round(b * 1e8));

// Graines de TEST (regtest) : client, Swissquote, tiers. Le client signe uniquement via le signataire externe.
const seeds = Object.fromEntries(["client", "swissquote", "tiers"].map((n) => [n, newMnemonic()]));
writeFileSync(`${DIR}/client.json`, JSON.stringify({ mnemonic: seeds.client }), { mode: 0o600 });
const masters = Object.fromEntries(Object.entries(seeds).map(([n, m]) => [n, masterFromMnemonic(m, "regtest")]));

const cfg = await createWalletConfig({
  network: "regtest",
  delay: 6,
  client: accountKey(masters.client),
  swissquote: accountKey(masters.swissquote),
  tiers: accountKey(masters.tiers),
});
report("1", "Politique à un délai compilée, descripteur à plage", cfg.miniscript === "andor(pk(@S),and_v(v:pk(@T),older(6)),pk(@C))",
  `miniscript = ${cfg.miniscript}\n       descripteur réception = ${descriptor(cfg, 0)}`);

// Mineur
const wallets: string[] = await rpc.call("listwallets");
if (!wallets.includes("miner")) await rpc.call("createwallet", ["miner"]).catch(() => rpc.call("loadwallet", ["miner"]));
const minerAddr: string = await rpc.call("getnewaddress", [], "miner");
const mine = (n: number) => rpc.call("generatetoaddress", [n, minerAddr]);
if ((await rpc.tipHeight()) < 101) await mine(101);

// 2. Réception sur deux adresses
const { addresses } = await import("@sq/bitcoin");
const [a0, a1] = addresses(cfg, 2).filter((a) => a.change === 0);
await rpc.call("sendtoaddress", [a0.address, 0.5], "miner");
await rpc.call("sendtoaddress", [a1.address, 0.3], "miner");
await mine(1);
let utxos = await scan(cfg, rpc);
report("2", "Réception sur les adresses 0 et 1 du compte, retrouvées par le scan", utxos.length === 2 && utxos.every((u) => u.confirmations === 1),
  utxos.map((u) => `${u.address} ${u.value} sats, ${u.confirmations} conf, recovery ouverte dans ${u.recoveryOpensIn} blocs`).join("\n       "));

// 3. Dépense du client avec tools/client-signer (processus séparé, phrase lue depuis un fichier de test)
{
  const to: string = await rpc.call("getnewaddress", [], "miner");
  const { psbt, summary } = await buildSpend({ cfg, backend: rpc, utxos, path: "client", feeRate: 2, to, amount: sats(0.6), changeIndex: nextIndex(utxos, 1) });
  const sim = summary.outputs.map((o) => `${o.value} sats -> ${o.address}${o.own ? ` (change, index ${o.own.index})` : ""}`).join(" ; ");
  report("3a", "PSBT préparé par l'appli et simulé en clair (chemin, sorties, frais)", summary.path === "client" && summary.inputs.every((i) => i.signatures === 0),
    `chemin=${summary.path} entrées=${summary.inputs.length} sorties : ${sim} ; frais=${summary.fee} sats`);
  writeFileSync(`${DIR}/unsigned.psbt`, psbt);
  const log = execFileSync("npm", ["run", "-s", "client-signer", "--", "--psbt", `${DIR}/unsigned.psbt`, "--mnemonic-file", `${DIR}/client.json`, "--network", "regtest", "--yes", "--out", `${DIR}/signed.psbt`], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  const signed = readFileSync(`${DIR}/signed.psbt`, "utf8").trim();
  const after = simulate(cfg, signed);
  const { hex, txid } = finalizePsbt(cfg, signed);
  let res: string;
  try { res = `diffusée txid=${await rpc.broadcast(hex)}`; } catch (e: any) { res = `refusée : ${e.message}`; }
  await mine(1);
  const tx = await rpc.call("getrawtransaction", [txid, true]);
  report("3b", "Signé par tools/client-signer, finalisé et diffusé par l'appli, confirmé", res.startsWith("diffusée") && tx.confirmations === 1,
    `${res} ; signatures après signataire = ${after.inputs.map((i) => i.signatures).join(",")} ; confirmations=${tx.confirmations} ; nSequence=${tx.vin.map((v: any) => v.sequence).join(",")}${log ? " ; " + log.trim() : ""}`);
}

// 4. Signataire externe réel : Bitcoin Core (wallet de descripteurs avec la clé privée du client uniquement)
{
  utxos = await scan(cfg, rpc);
  const core = "client-core";
  if (!(await rpc.call("listwallets")).includes(core)) await rpc.call("createwallet", [core, false, true, "", false, true]);
  const priv = accountPrivateKey(masters.client);
  const imports = [];
  for (const change of [0, 1] as const) {
    const d = descriptor(cfg, change).replace(`${cfg.client.raw}/${change}/*`, `${priv}/${change}/*`);
    const { checksum } = await rpc.call("getdescriptorinfo", [d]);
    imports.push({ desc: `${d}#${checksum}`, range: [0, 50], timestamp: "now", active: false });
  }
  const imp = await rpc.call("importdescriptors", [imports], core);
  const to: string = await rpc.call("getnewaddress", [], "miner");
  const { psbt } = await buildSpend({ cfg, backend: rpc, utxos, path: "client", feeRate: 2, to }); // tout envoyer
  const r = await rpc.call("walletprocesspsbt", [psbt, true, "ALL", true, false], core);
  const sigs = simulate(cfg, r.psbt).inputs.map((i) => i.signatures);
  const { hex, txid } = finalizePsbt(cfg, r.psbt);
  let res: string;
  try { res = `diffusée txid=${await rpc.broadcast(hex)}`; } catch (e: any) { res = `refusée : ${e.message}`; }
  await mine(1);
  report("4", "Signataire externe réel : Bitcoin Core 29 signe le PSBT Miniscript (walletprocesspsbt), l'appli finalise et diffuse",
    imp.every((x: any) => x.success) && sigs.every((n) => n === 1) && res.startsWith("diffusée"),
    `import=${imp.map((x: any) => x.success).join(",")} ; signatures Core par entrée=${sigs.join(",")} ; ${res} ; txid=${txid}`);
}

// 5. Solde final : tout a été dépensé par le client seul ; aucun composant Swissquote n'est intervenu.
utxos = await scan(cfg, rpc);
report("5", "Après envoi total, plus aucun UTXO sur le compte", utxos.length === 0, `UTXO restants = ${utxos.length}`);

console.log("\nRÉSUMÉ");
for (const [id, label, ok] of results) console.log(`${id.padEnd(3)} ${(ok ? "fonctionne" : "ne fonctionne pas").padEnd(18)} ${label}`);
if (results.some(([, , ok]) => !ok)) process.exit(1);
