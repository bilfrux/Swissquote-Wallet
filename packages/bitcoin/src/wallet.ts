// Adresses, UTXO, construction et décodage de PSBT, finalisation après signature externe.
// PSBT : @scure/btc-signer (BIP174), via @bitcoinerlab/descriptors-scure. Aucune clé privée ici.
import { Output, btc } from "@bitcoinerlab/descriptors-scure";
import { base64, hex } from "@scure/base";
import type { ChainBackend, ChainTx } from "./backend.ts";
import { type WalletConfig, btcNetwork, descriptor, pubkeyAt } from "./policy.ts";

export type SpendPath = "client" | "recovery";
export type AddressInfo = { address: string; change: 0 | 1; index: number };
export type WalletUtxo = AddressInfo & {
  txid: string;
  vout: number;
  value: bigint;
  confirmations: number;
  // Blocs restants avant que le chemin Swissquote + tiers ne s'ouvre pour cet UTXO (0 = ouvert).
  recoveryOpensIn: number;
};

export function outputAt(cfg: WalletConfig, change: 0 | 1, index: number, path?: SpendPath) {
  const net = cfg.network;
  const signersPubKeys =
    path === "client"
      ? [pubkeyAt(cfg.client, net, change, index)]
      : path === "recovery"
        ? [pubkeyAt(cfg.swissquote, net, change, index), pubkeyAt(cfg.tiers, net, change, index)]
        : undefined;
  return new Output({ descriptor: descriptor(cfg, change), index, network: btcNetwork(net), ...(signersPubKeys ? { signersPubKeys } : {}) });
}

export function addresses(cfg: WalletConfig, count = 20): AddressInfo[] {
  const out: AddressInfo[] = [];
  for (const change of [0, 1] as const)
    for (let index = 0; index < count; index++) out.push({ address: outputAt(cfg, change, index).getAddress(), change, index });
  return out;
}

// Adresses à interroger : par limite d'écart si le backend sait dire si une adresse a servi (on s'arrête après
// `gap` adresses consécutives jamais utilisées, par chaîne), sinon un nombre fixe.
export async function discover(cfg: WalletConfig, backend: ChainBackend, count = 20, gap = 5, max = 200): Promise<AddressInfo[]> {
  if (!backend.isUsed) return addresses(cfg, count);
  const out: AddressInfo[] = [];
  for (const change of [0, 1] as const) {
    let lastUsed = -1;
    for (let index = 0; index < max && index <= lastUsed + gap; index++) {
      const address = outputAt(cfg, change, index).getAddress();
      out.push({ address, change, index });
      if (await backend.isUsed(address)) lastUsed = index;
    }
  }
  return out;
}

export async function scan(cfg: WalletConfig, backend: ChainBackend, count = 20): Promise<WalletUtxo[]> {
  const infos = await discover(cfg, backend, count);
  const byAddr = new Map(infos.map((a) => [a.address, a]));
  const [tip, utxos] = await Promise.all([backend.tipHeight(), backend.utxos(infos.map((a) => a.address))]);
  return utxos.map((u) => {
    const confirmations = u.height ? tip - u.height + 1 : 0;
    return { ...byAddr.get(u.address)!, txid: u.txid, vout: u.vout, value: u.value, confirmations, recoveryOpensIn: Math.max(0, cfg.delay - confirmations) };
  });
}

// Premier index de réception (ou de change) jamais utilisé, d'après les UTXO connus et l'historique fourni.
export function nextIndex(utxos: { change: 0 | 1; index: number }[], change: 0 | 1, used: number[] = []) {
  const idx = [...utxos.filter((u) => u.change === change).map((u) => u.index), ...used];
  return idx.length ? Math.max(...idx) + 1 : 0;
}

const DUST = 546n;
const vbytes = (weight: number) => Math.ceil(weight / 4);
// Poids hors entrées/sorties : version, nombres d'entrées et de sorties, locktime (4 octets ×4) + marqueur segwit.
const TX_OVERHEAD_WEIGHT = 10 * 4 + 2;

export type BuildSpendParams = {
  cfg: WalletConfig;
  backend: ChainBackend;
  utxos: WalletUtxo[];
  path: SpendPath;
  feeRate: number; // sat/vB
  // Destination : adresse quelconque, ou interne (rafraîchissement / recovery vers le compte).
  to: string;
  // Montant envoyé ; absent = tout envoyer (sweep), sans change.
  amount?: bigint;
  changeIndex?: number;
};

export async function buildSpend(p: BuildSpendParams) {
  const { cfg, path } = p;
  if (!p.utxos.length) throw new Error("aucun UTXO à dépenser");
  const network = btcNetwork(cfg.network);
  const recipient = new Output({ descriptor: `addr(${p.to})`, network });
  const change = outputAt(cfg, 1, p.changeIndex ?? 0);
  const inW = (u: WalletUtxo) => outputAt(cfg, u.change, u.index, path).inputWeight(true, "DANGEROUSLY_USE_FAKE_SIGNATURES");

  // Sélection : sweep = tout ; sinon les plus gros d'abord jusqu'à couvrir montant + frais.
  const sorted = [...p.utxos].sort((a, b) => (a.value > b.value ? -1 : 1));
  let selected: WalletUtxo[] = [];
  let fee = 0n;
  let changeValue = 0n;
  if (p.amount === undefined) {
    selected = sorted;
    fee = BigInt(Math.ceil(vbytes(TX_OVERHEAD_WEIGHT + selected.reduce((s, u) => s + inW(u), 0) + recipient.outputWeight()) * p.feeRate));
  } else {
    let total = 0n, weight = TX_OVERHEAD_WEIGHT + recipient.outputWeight() + change.outputWeight();
    for (const u of sorted) {
      selected.push(u);
      total += u.value;
      weight += inW(u);
      fee = BigInt(Math.ceil(vbytes(weight) * p.feeRate));
      if (total >= p.amount + fee) break;
    }
    changeValue = total - p.amount - fee;
    if (changeValue < 0n) throw new Error(`fonds insuffisants : ${total} sats pour ${p.amount} + ${fee} de frais`);
    if (changeValue < DUST) changeValue = 0n; // reliquat trop petit : laissé aux frais
  }
  const total = selected.reduce((s, u) => s + u.value, 0n);
  const sendValue = p.amount ?? total - fee;
  if (sendValue < DUST) throw new Error(`montant trop faible après frais : ${sendValue} sats`);

  const tx = new btc.Transaction();
  for (const u of selected) {
    // Transaction précédente complète (non_witness_utxo) : exigée par certains signataires matériels.
    outputAt(cfg, u.change, u.index, path).updatePsbtAsInput({ psbt: tx, txHex: await p.backend.txHex(u.txid), vout: u.vout });
  }
  recipient.updatePsbtAsOutput({ psbt: tx, value: sendValue });
  if (changeValue > 0n) change.updatePsbtAsOutput({ psbt: tx, value: changeValue });
  const psbt = base64.encode(tx.toPSBT());
  return { psbt, summary: simulate(cfg, psbt) };
}

export type PsbtSummary = {
  path: SpendPath;
  inputs: { txid: string; vout: number; value: bigint; sequence: number; signatures: number; change: 0 | 1 | null; index: number | null }[];
  outputs: { address: string; value: bigint; own: AddressInfo | null }[];
  fee: bigint;
  vsize: number | null;
};

const fromB64 = (psbt: string) => btc.Transaction.fromPSBT(base64.decode(psbt.trim()));

function inputMeta(cfg: WalletConfig, inp: any): { change: 0 | 1; index: number } | null {
  const fp = parseInt(cfg.client.fingerprint, 16);
  const d = (inp.bip32Derivation ?? []).find(([, v]: any) => v.fingerprint === fp);
  if (!d) return null;
  const path: number[] = d[1].path;
  return { change: path[path.length - 2] as 0 | 1, index: path[path.length - 1] };
}

// Décodage en clair d'un PSBT, sans appel réseau : base de la simulation avant signature.
export function simulate(cfg: WalletConfig, psbt: string, lookahead = 50): PsbtSummary {
  const tx = fromB64(psbt);
  const network = btcNetwork(cfg.network);
  const own = new Map(addresses(cfg, lookahead).map((a) => [a.address, a]));
  const inputs = [];
  for (let i = 0; i < tx.inputsLength; i++) {
    const inp = tx.getInput(i);
    const meta = inputMeta(cfg, inp);
    inputs.push({
      txid: hex.encode(inp.txid!),
      vout: inp.index!,
      value: inp.witnessUtxo!.amount,
      sequence: inp.sequence!,
      signatures: inp.partialSig?.length ?? 0,
      change: meta?.change ?? null,
      index: meta?.index ?? null,
    });
  }
  const outputs = [];
  for (let i = 0; i < tx.outputsLength; i++) {
    const o = tx.getOutput(i);
    const address = btc.Address(network).encode(btc.OutScript.decode(o.script!));
    outputs.push({ address, value: o.amount!, own: own.get(address) ?? null });
  }
  const paths = new Set(inputs.map((i) => (i.sequence === cfg.delay ? "recovery" : "client")));
  if (paths.size !== 1) throw new Error("PSBT mixte : entrées client et recovery mélangées");
  const fee = inputs.reduce((s, i) => s + i.value, 0n) - outputs.reduce((s, o) => s + o.value, 0n);
  let vsize: number | null = null;
  try { vsize = tx.isFinal ? tx.vsize : null; } catch { vsize = null; }
  return { path: [...paths][0] as SpendPath, inputs, outputs, fee, vsize };
}

// Vrai si TOUTES les entrées du PSBT dépensent un script de ce compte : le chemin BIP32 de la clé client
// désigne (change, index), et le scriptPubKey dépensé doit être exactement celui dérivé à cet index.
export function inputsBelongTo(cfg: WalletConfig, psbt: string): boolean {
  const tx = fromB64(psbt);
  if (tx.inputsLength === 0) return false;
  for (let i = 0; i < tx.inputsLength; i++) {
    const inp = tx.getInput(i);
    const meta = inputMeta(cfg, inp);
    if (!meta || !inp.witnessUtxo) return false;
    if (hex.encode(inp.witnessUtxo.script) !== hex.encode(outputAt(cfg, meta.change, meta.index).getScriptPubKey())) return false;
  }
  return true;
}

export function combinePsbts(psbts: string[]): string {
  const [first, ...rest] = psbts.map(fromB64);
  for (const t of rest) first.combine(t);
  return base64.encode(first.toPSBT());
}

// Finalise un PSBT signé à l'extérieur. Les finaliseurs Miniscript sont reconstruits à partir des chemins BIP32
// du PSBT (clé du client : .../change/index) et du nSequence (= D : chemin recovery).
export function finalizePsbt(cfg: WalletConfig, psbt: string): { hex: string; txid: string } {
  const signed = fromB64(psbt);
  const replay = new btc.Transaction();
  for (let i = 0; i < signed.inputsLength; i++) {
    const inp = signed.getInput(i);
    const meta = inputMeta(cfg, inp);
    if (!meta) throw new Error(`entrée ${i} : n'appartient pas à ce compte`);
    const path: SpendPath = inp.sequence === cfg.delay ? "recovery" : "client";
    // La transaction précédente complète est dans le PSBT (non_witness_utxo) : on la réutilise.
    const prev = inp.nonWitnessUtxo
      ? { txHex: hex.encode(btc.RawTx.encode(inp.nonWitnessUtxo)) }
      : { txId: hex.encode(inp.txid!), value: inp.witnessUtxo!.amount };
    const finalize = outputAt(cfg, meta.change, meta.index, path).updatePsbtAsInput({ psbt: replay, vout: inp.index!, ...prev });
    // La validité des signatures est vérifiée par le nœud à la diffusion (l'adaptateur scure ne la vérifie pas entièrement).
    finalize({ psbt: signed, validate: false });
  }
  return { hex: signed.hex, txid: signed.id };
}

// Historique du compte : chaque transaction classée du point de vue du compte.
export type HistoryKind = "reçu" | "reçu par recovery" | "envoyé" | "rafraîchissement" | "recovery sortante";
export type HistoryEntry = { txid: string; height: number | null; time: number | null; kind: HistoryKind; amount: bigint; fee: bigint | null; counterpart: string | null };

export async function history(cfg: WalletConfig, backend: ChainBackend, count = 20): Promise<HistoryEntry[]> {
  // Adresses du compte connues (lookahead large) pour classer les sorties ; requêtes limitées aux adresses découvertes.
  const own = new Set([...addresses(cfg, count), ...(await discover(cfg, backend, count))].map((a) => a.address));
  const queried = (await discover(cfg, backend, count)).map((a) => a.address);
  const raw: ChainTx[] = await backend.history(queried, [descriptor(cfg, 0), descriptor(cfg, 1)]);
  const entries = raw.map((t): HistoryEntry => {
    const ownIn = t.vin.filter((i) => i.address && own.has(i.address));
    const inSum = ownIn.reduce((s, i) => s + i.value, 0n);
    const outOwn = t.vout.filter((o) => o.address && own.has(o.address)).reduce((s, o) => s + o.value, 0n);
    const ext = t.vout.filter((o) => !o.address || !own.has(o.address));
    const extSum = ext.reduce((s, o) => s + o.value, 0n);
    const fee = inSum > 0n ? (t.fee ?? inSum - outOwn - extSum) : null;
    // nSequence = D : chemin de recovery (Swissquote + tiers)
    const recoveryPath = t.vin.some((i) => i.sequence === cfg.delay);
    let kind: HistoryKind, amount: bigint;
    if (inSum === 0n) { kind = recoveryPath ? "reçu par recovery" : "reçu"; amount = outOwn; }
    else if (extSum === 0n) { kind = "rafraîchissement"; amount = 0n; }
    else { kind = recoveryPath ? "recovery sortante" : "envoyé"; amount = -extSum; }
    return { txid: t.txid, height: t.height, time: t.time, kind, amount, fee, counterpart: kind === "envoyé" || kind === "recovery sortante" ? ext[0]?.address ?? null : null };
  });
  // En attente d'abord, puis du plus récent au plus ancien.
  return entries.sort((a, b) => (a.height === null ? -1 : b.height === null ? 1 : b.height - a.height));
}
