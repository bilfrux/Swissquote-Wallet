// Étape 0 Bitcoin : faisabilité de la politique de recovery en regtest (bitcoind dans Docker).
// Bibliothèques : @scure/bip39 (graines), HDKey de @scure/bip32 (via descriptors-scure), compilateur Miniscript
// de référence (miniscript-policies), @bitcoinerlab/miniscript (analyse, satisfactions), @bitcoinerlab/descriptors-scure
// (adresses, PSBT, signature, finalisation), @scure/btc-signer (PSBT BIP174). Aucune cryptographie écrite ici.
import { generateMnemonic, mnemonicToSeedSync } from "@scure/bip39";
import { wordlist } from "@scure/bip39/wordlists/english.js";
import { HDKey, Output, btc, keyExpressionBIP32, networks, signers } from "@bitcoinerlab/descriptors-scure";
import { compilePolicy, ready } from "@bitcoinerlab/miniscript-policies";
import { satisfier } from "@bitcoinerlab/miniscript";

const RPC = process.env.BTC_RPC_URL ?? "http://regtest:regtest@127.0.0.1:18443";
const D1 = 6, D2 = 12, D3 = 24;
const network = networks.regtest;
const ORIGIN = "/48'/1'/0'/2'"; // BIP48, script P2WSH, testnets (coin type 1')

// ---------- RPC bitcoind ----------
async function rpc(method: string, params: unknown[] = [], wallet?: string): Promise<any> {
  const u = new URL(RPC);
  const url = `${u.protocol}//${u.host}${wallet ? `/wallet/${wallet}` : "/"}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "text/plain", authorization: "Basic " + btoa(`${u.username}:${u.password}`) },
    body: JSON.stringify({ jsonrpc: "1.0", id: method, method, params }),
  });
  const j = await res.json();
  if (j.error) throw new Error(`${method}: ${j.error.message}`);
  return j.result;
}
let minerAddr = "";
const mine = async (n: number) => rpc("generatetoaddress", [n, minerAddr]);
const height = async () => (await rpc("getblockchaininfo")).blocks as number;

// ---------- rapport ----------
const results: { id: string; label: string; ok: boolean }[] = [];
function report(id: string, label: string, ok: boolean, detail: string) {
  results.push({ id, label, ok });
  console.log(`[${ok ? "OK " : "KO "}] ${id} ${label}\n       ${detail}`);
}

// ---------- acteurs et clés ----------
type Actor = { name: string; node: HDKey };
const actor = (name: string): Actor => ({ name, node: HDKey.fromMasterSeed(mnemonicToSeedSync(generateMnemonic(wordlist, 256)), network.bip32) });
const CLIENT = actor("client"), BACKUP = actor("backup"), SQ = actor("swissquote"), TIERS = actor("tiers");
// Miniscript interdit une clé répétée : chaque acteur dérive une clé distincte par chemin (/chemin/0).
// Le client utilise /0/<génération> : une nouvelle génération après une recovery.
const keyExpr = (a: Actor, keyPath: string) => keyExpressionBIP32({ masterNode: a.node, originPath: ORIGIN, keyPath });
const pub = (a: Actor, keyPath: string) => a.node.derive(`m${ORIGIN}${keyPath}`).publicKey!;
const KP = { C: (g: number) => `/0/${g}`, B1: "/1/0", S1: "/1/0", B2: "/2/0", T2: "/2/0", S3: "/3/0", T3: "/3/0" };

const POLICY = `or(pk(@C),or(and(thresh(2,pk(@B1),pk(@S1)),older(${D1})),or(and(thresh(2,pk(@B2),pk(@T2)),older(${D2})),and(thresh(2,pk(@S3),pk(@T3)),older(${D3})))))`;
let MINISCRIPT = "";

function descriptor(gen: number) {
  const map: Record<string, string> = {
    "@C": keyExpr(CLIENT, KP.C(gen)), "@B1": keyExpr(BACKUP, KP.B1), "@S1": keyExpr(SQ, KP.S1),
    "@B2": keyExpr(BACKUP, KP.B2), "@T2": keyExpr(TIERS, KP.T2), "@S3": keyExpr(SQ, KP.S3), "@T3": keyExpr(TIERS, KP.T3),
  };
  return `wsh(${MINISCRIPT.replace(/@(C|B1|S1|B2|T2|S3|T3)\b/g, (m) => map[m])})`;
}
const PATHS = {
  client: (g: number) => ({ label: "client seul", signers: [CLIENT], pubkeys: [pub(CLIENT, KP.C(g))] }),
  p1: { label: "backup + Swissquote (D1)", signers: [BACKUP, SQ], pubkeys: [pub(BACKUP, KP.B1), pub(SQ, KP.S1)] },
  p2: { label: "backup + tiers (D2)", signers: [BACKUP, TIERS], pubkeys: [pub(BACKUP, KP.B2), pub(TIERS, KP.T2)] },
  p3: { label: "Swissquote + tiers (D3)", signers: [SQ, TIERS], pubkeys: [pub(SQ, KP.S3), pub(TIERS, KP.T3)] },
};
type Path = { label: string; signers: Actor[]; pubkeys: Uint8Array[] };

// ---------- financement, dépense ----------
type Utxo = { txid: string; vout: number; value: bigint; txHex: string; gen: number };
async function fund(gen: number, btcAmount = 1): Promise<Utxo> {
  const addr = new Output({ descriptor: descriptor(gen), network }).getAddress();
  const txid = await rpc("sendtoaddress", [addr, btcAmount], "miner");
  await mine(1);
  return findUtxo(txid, addr, gen);
}
async function findUtxo(txid: string, addr: string, gen: number): Promise<Utxo> {
  const tx = await rpc("getrawtransaction", [txid, true]);
  const o = tx.vout.find((v: any) => v.scriptPubKey.address === addr);
  return { txid, vout: o.n, value: BigInt(Math.round(o.value * 1e8)), txHex: tx.hex, gen };
}

// Construit le PSBT, le fait signer par chaque acteur SÉPARÉMENT (copie BIP174 propre à chacun),
// combine, finalise. Renvoie la transaction brute.
function buildSpend(utxo: Utxo, path: Path, destGen: number) {
  const input = new Output({ descriptor: descriptor(utxo.gen), network, signersPubKeys: path.pubkeys });
  const dest = new Output({ descriptor: descriptor(destGen), network });
  const tx = new btc.Transaction();
  const finalize = input.updatePsbtAsInput({ psbt: tx, txHex: utxo.txHex, vout: utxo.vout });
  const fee = 2_000n;
  dest.updatePsbtAsOutput({ psbt: tx, value: utxo.value - fee });
  const unsigned = tx.toPSBT();
  const signed = path.signers.map((a) => {
    const copy = btc.Transaction.fromPSBT(unsigned);
    signers.signBIP32({ psbt: copy, masterNode: a.node });
    return copy.toPSBT();
  });
  const combined = btc.Transaction.fromPSBT(signed[0]);
  for (const s of signed.slice(1)) combined.combine(btc.Transaction.fromPSBT(s));
  finalize({ psbt: combined });
  return { hex: combined.hex, sequence: tx.getInput(0).sequence, destAddr: dest.getAddress(), fee };
}
async function accept(hex: string) {
  const [r] = await rpc("testmempoolaccept", [[hex]]);
  return r.allowed ? "accepté" : `refusé (${r["reject-reason"]})`;
}
async function broadcast(hex: string) {
  const txid = await rpc("sendrawtransaction", [hex]);
  await mine(1);
  return txid as string;
}

// ---------- scénario ----------
async function main() {
  await ready;
  const compiled = compilePolicy(POLICY);
  MINISCRIPT = compiled.miniscript;
  report("0a", "Politique compilée par le compilateur de référence (une clé par acteur et par chemin)", compiled.issane,
    `miniscript = ${MINISCRIPT}`);

  // Analyse statique : toutes les satisfactions non malléables du script.
  const sats = satisfier(MINISCRIPT).nonMalleableSats as { asm: string; nSequence?: number }[];
  const actorOf: Record<string, string> = { C: "client", B1: "backup", B2: "backup", S1: "SQ", S3: "SQ", T2: "tiers", T3: "tiers" };
  const summary = sats.map(({ asm, nSequence }) => {
    const keys = [...asm.matchAll(/<sig\(@(\w+)\)>/g)].map((m) => actorOf[m[1]]);
    return { actors: [...new Set(keys)].sort().join("+"), older: nSequence ?? 0 };
  });
  const sqAlone = summary.some((s) => s.actors === "SQ");
  const sqTiersMin = Math.min(...summary.filter((s) => s.actors === "SQ+tiers").map((s) => s.older));
  const nonClientMinActors = Math.min(...summary.filter((s) => !s.actors.includes("client")).map((s) => s.actors.split("+").length));
  report("0b", "Analyse : aucune satisfaction par Swissquote seule ; SQ + tiers exige older(D3) ; hors client, toujours 2 acteurs distincts",
    !sqAlone && sqTiersMin === D3 && nonClientMinActors === 2,
    `satisfactions = ${JSON.stringify(summary)}`);

  const wallets = await rpc("listwallets");
  if (!wallets.includes("miner")) await rpc("createwallet", ["miner"]).catch(() => rpc("loadwallet", ["miner"]));
  minerAddr = await rpc("getnewaddress", [], "miner");
  if ((await height()) < 101) await mine(101);

  // Adresses regtest et signet
  const addrRegtest = new Output({ descriptor: descriptor(0), network }).getAddress();
  const addrSignet = new Output({ descriptor: descriptor(0), network: networks.testnet }).getAddress();
  report("1", "Adresse dérivée en regtest et en signet (signet utilise le préfixe tb1 de testnet)",
    addrRegtest.startsWith("bcrt1q") && addrSignet.startsWith("tb1q"), `regtest=${addrRegtest} signet=${addrSignet}`);

  // 2. Réception + dépense du client seul, immédiatement (1 confirmation)
  {
    const u = await fund(0);
    report("2a", "Réception sur l'adresse de la politique", u.value === 100_000_000n, `txid=${u.txid} vout=${u.vout} valeur=${u.value} sats`);
    const s = buildSpend(u, PATHS.client(0), 0);
    const r = await accept(s.hex);
    const txid = r === "accepté" ? await broadcast(s.hex) : "";
    report("2b", "Dépense par le client seul, 1 confirmation après réception (aucun délai)", r === "accepté", `${r} txid=${txid} nSequence=0x${s.sequence?.toString(16)}`);
  }

  // 3. Les trois chemins : refusés avant le délai, acceptés après
  for (const [id, path, D] of [["3a", PATHS.p1, D1], ["3b", PATHS.p2, D2], ["3c", PATHS.p3, D3]] as const) {
    const u = await fund(0); // 1 confirmation
    const s = buildSpend(u, path, 1); // vers une nouvelle adresse client (génération 1)
    await mine(D - 2); // D-1 confirmations
    const before = await accept(s.hex);
    await mine(1); // D confirmations
    const after = await accept(s.hex);
    const txid = after === "accepté" ? await broadcast(s.hex) : "";
    report(id, `Recovery ${path.label} : refusée à ${D - 1} confirmations, acceptée à ${D}`,
      before.includes("non-BIP68-final") && after === "accepté",
      `nSequence=${s.sequence} ; à ${D - 1} conf : ${before} ; à ${D} conf : ${after} ; txid=${txid} -> ${s.destAddr} (client génération 1)`);
  }

  // 4. Swissquote seule : la bibliothèque ne trouve aucun chemin ; et une signature SQ seule ne finalise pas.
  {
    const u = await fund(0);
    await mine(D3 + 5);
    let lib = "";
    try { buildSpend(u, { label: "SQ seule", signers: [SQ], pubkeys: [pub(SQ, KP.S1), pub(SQ, KP.S3)] }, 1); lib = "PSBT finalisé (!)"; }
    catch (e: any) { lib = `refus : ${String(e.message).split("\n")[0].slice(0, 160)}`; }
    // Chemin p3 choisi, mais seule SQ signe (le tiers ne signe pas)
    let half = "";
    try { buildSpend(u, { ...PATHS.p3, signers: [SQ] }, 1); half = "PSBT finalisé (!)"; }
    catch (e: any) { half = `refus : ${String(e.message).split("\n")[0].slice(0, 160)}`; }
    report("4", "Swissquote seule, même après D3 + 5 blocs : aucune dépense possible", lib.startsWith("refus") && half.startsWith("refus"),
      `clés SQ seules : ${lib} ; chemin SQ + tiers signé par SQ seule : ${half}`);
  }

  // 5. Rafraîchissement : un envoi à soi-même remet le délai à zéro
  {
    const u = await fund(0); // 1 conf
    await mine(D1 - 2); // D1-1 conf : le chemin 1 n'est pas encore ouvert
    const refresh = buildSpend(u, PATHS.client(0), 0);
    const rtxid = await broadcast(refresh.hex); // le nouvel UTXO a 1 conf ; l'ancien aurait eu D1 conf
    const nu = await findUtxo(rtxid, refresh.destAddr, 0);
    const s = buildSpend(nu, PATHS.p1, 1);
    const atOld = await accept(s.hex);
    await mine(D1 - 2);
    const before = await accept(s.hex);
    await mine(1);
    const after = await accept(s.hex);
    report("5", "Rafraîchissement par le client : le délai D1 repart de la confirmation du nouvel UTXO",
      atOld.includes("non-BIP68-final") && before.includes("non-BIP68-final") && after === "accepté",
      `quand l'ancien UTXO aurait eu ${D1} conf : ${atOld} ; nouvel UTXO à ${D1 - 1} conf : ${before} ; à ${D1} conf : ${after}`);
  }

  // 6. PSBT décodable (base de la simulation avant signature)
  {
    const u = await fund(0);
    const input = new Output({ descriptor: descriptor(0), network, signersPubKeys: PATHS.p3.pubkeys });
    const tx = new btc.Transaction();
    input.updatePsbtAsInput({ psbt: tx, txHex: u.txHex, vout: u.vout });
    new Output({ descriptor: descriptor(1), network }).updatePsbtAsOutput({ psbt: tx, value: u.value - 2_000n });
    const decoded = await rpc("decodepsbt", [btc.Transaction.fromPSBT(tx.toPSBT()).toPSBT().length ? Buffer.from(tx.toPSBT()).toString("base64") : ""]);
    const out = decoded.tx.vout[0];
    report("6", "PSBT décodé par bitcoind (sorties, montants, frais, nSequence du chemin)", decoded.fee !== undefined && out.scriptPubKey.address,
      `sortie=${out.scriptPubKey.address} ${out.value} BTC ; frais=${decoded.fee} BTC ; nSequence=${decoded.tx.vin[0].sequence} (= D3)`);
  }

  console.log("\nRÉSUMÉ");
  for (const r of results) console.log(`${r.id.padEnd(3)} ${(r.ok ? "fonctionne" : "ne fonctionne pas").padEnd(18)} ${r.label}`);
}

main().catch((e) => { console.error("ÉCHEC NON PRÉVU :", e); process.exit(1); });
