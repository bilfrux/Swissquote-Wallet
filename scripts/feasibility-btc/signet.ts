// Étape 0 Bitcoin, partie signet : vraie transaction du client et recovery réelle par le chemin backup + Swissquote.
// Les graines de test sont stockées dans .keys/signet.json (ignoré par git). Diffusion via l'API Esplora de blockstream.info (mempool.space injoignable depuis ce poste).
//   npm run signet -- address       adresse à financer (faucet signet)
//   npm run signet -- status        UTXO et confirmations
//   npm run signet -- client-spend  dépense réelle par le client seul (envoi à soi-même = rafraîchissement)
//   npm run signet -- recover       recovery backup + Swissquote (D1) vers la génération 1 du client
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { generateMnemonic, mnemonicToSeedSync } from "@scure/bip39";
import { wordlist } from "@scure/bip39/wordlists/english.js";
import { HDKey, Output, btc, keyExpressionBIP32, networks, signers } from "@bitcoinerlab/descriptors-scure";
import { compilePolicy, ready } from "@bitcoinerlab/miniscript-policies";

const API = process.env.ESPLORA_URL ?? "https://blockstream.info/signet/api";
const network = networks.testnet; // signet partage les préfixes de testnet (tb1, tpub)
const ORIGIN = "/48'/1'/0'/2'";
const D1 = 6, D2 = 12, D3 = 24;
const FEE = 500n;

const KEYS_FILE = new URL("./.keys/signet.json", import.meta.url);
function loadMnemonics(): Record<string, string> {
  if (existsSync(KEYS_FILE)) return JSON.parse(readFileSync(KEYS_FILE, "utf8"));
  mkdirSync(new URL("./.keys/", import.meta.url), { recursive: true });
  const m = Object.fromEntries(["client", "backup", "swissquote", "tiers"].map((n) => [n, generateMnemonic(wordlist, 256)]));
  writeFileSync(KEYS_FILE, JSON.stringify(m, null, 2), { mode: 0o600 });
  return m;
}
const M = loadMnemonics();
const node = (n: string) => HDKey.fromMasterSeed(mnemonicToSeedSync(M[n]), network.bip32);
const CLIENT = node("client"), BACKUP = node("backup"), SQ = node("swissquote"), TIERS = node("tiers");
const keyExpr = (n: HDKey, keyPath: string) => keyExpressionBIP32({ masterNode: n, originPath: ORIGIN, keyPath });
const pub = (n: HDKey, keyPath: string) => n.derive(`m${ORIGIN}${keyPath}`).publicKey!;

const POLICY = `or(pk(@C),or(and(thresh(2,pk(@B1),pk(@S1)),older(${D1})),or(and(thresh(2,pk(@B2),pk(@T2)),older(${D2})),and(thresh(2,pk(@S3),pk(@T3)),older(${D3})))))`;
await ready;
const MINISCRIPT = compilePolicy(POLICY).miniscript;
function descriptor(gen: number) {
  const map: Record<string, string> = {
    "@C": keyExpr(CLIENT, `/0/${gen}`), "@B1": keyExpr(BACKUP, "/1/0"), "@S1": keyExpr(SQ, "/1/0"),
    "@B2": keyExpr(BACKUP, "/2/0"), "@T2": keyExpr(TIERS, "/2/0"), "@S3": keyExpr(SQ, "/3/0"), "@T3": keyExpr(TIERS, "/3/0"),
  };
  return `wsh(${MINISCRIPT.replace(/@(C|B1|S1|B2|T2|S3|T3)\b/g, (m) => map[m])})`;
}
const addressOf = (gen: number) => new Output({ descriptor: descriptor(gen), network }).getAddress();

async function api(path: string, init?: RequestInit) {
  const r = await fetch(API + path, init);
  const body = await r.text();
  if (!r.ok) throw new Error(`${path} -> HTTP ${r.status} ${body}`);
  return body;
}
const tip = async () => Number(await api("/blocks/tip/height"));
async function utxos(gen: number) {
  const list = JSON.parse(await api(`/address/${addressOf(gen)}/utxo`));
  const h = await tip();
  return list.map((u: any) => ({ ...u, gen, conf: u.status.confirmed ? h - u.status.block_height + 1 : 0 }));
}

async function spend(u: any, signerNodes: HDKey[], pubkeys: Uint8Array[], destGen: number) {
  const txHex = await api(`/tx/${u.txid}/hex`);
  const input = new Output({ descriptor: descriptor(u.gen), network, signersPubKeys: pubkeys });
  const tx = new btc.Transaction();
  const finalize = input.updatePsbtAsInput({ psbt: tx, txHex, vout: u.vout });
  new Output({ descriptor: descriptor(destGen), network }).updatePsbtAsOutput({ psbt: tx, value: BigInt(u.value) - FEE });
  const unsigned = tx.toPSBT();
  const signed = signerNodes.map((n) => {
    const copy = btc.Transaction.fromPSBT(unsigned);
    signers.signBIP32({ psbt: copy, masterNode: n });
    return copy.toPSBT();
  });
  const combined = btc.Transaction.fromPSBT(signed[0]);
  for (const s of signed.slice(1)) combined.combine(btc.Transaction.fromPSBT(s));
  finalize({ psbt: combined, validate: false }); // la validité complète est vérifiée par le nœud à la diffusion
  try {
    const txid = await api("/tx", { method: "POST", body: combined.hex });
    console.log(`diffusée : txid=${txid}\n  https://blockstream.info/signet/tx/${txid}`);
  } catch (e: any) {
    console.log(`refusée par le nœud : ${e.message}`);
  }
}

const cmd = process.argv[2] ?? "address";
if (cmd === "address") {
  console.log(`Adresse signet de la politique (client génération 0) : ${addressOf(0)}`);
  console.log(`Adresse de destination après recovery (génération 1) : ${addressOf(1)}`);
} else if (cmd === "status") {
  console.log(`hauteur signet = ${await tip()}`);
  for (const g of [0, 1]) for (const u of await utxos(g)) console.log(`gen ${g} ${u.txid}:${u.vout} ${u.value} sats, ${u.conf} conf`);
} else if (cmd === "client-spend") {
  const [u] = await utxos(0);
  if (!u) throw new Error("aucun UTXO en génération 0 : financer l'adresse d'abord");
  console.log(`dépense client seul de ${u.txid}:${u.vout} (${u.conf} conf) vers soi-même`);
  await spend(u, [CLIENT], [pub(CLIENT, "/0/0")], 0);
} else if (cmd === "recover") {
  const [u] = await utxos(0);
  if (!u) throw new Error("aucun UTXO en génération 0");
  console.log(`recovery backup + Swissquote de ${u.txid}:${u.vout} (${u.conf} conf, D1 = ${D1}) vers la génération 1`);
  await spend(u, [BACKUP, SQ], [pub(BACKUP, "/1/0"), pub(SQ, "/1/0")], 1);
}
