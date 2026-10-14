// Compte Ethereum du client : Safe dont le propriétaire est l'EOA du client (clé dans le Wallet du client),
// module de recovery Candide (Swissquote + tiers, seuil 2), opérations ERC-4337 parrainées par un paymaster.
// AUCUNE clé privée ici : adresses, construction des opérations, décodage pour l'écran de confirmation.
// Bibliothèques : abstractionkit (Safe, module, bundler, paymaster) et viem (lecture, ABI, EIP-712). Aucune crypto maison.
import { Erc7677Paymaster, SafeAccountV0_3_0, SocialRecoveryModule, type MetaTransaction, type UserOperationV7 } from "abstractionkit";
import { createPublicClient, decodeFunctionData, encodeFunctionData, formatUnits, getAddress, hexToBigInt, hexToNumber, http, parseAbi, size, slice, type Address, type Hex } from "viem";
import { sepolia } from "viem/chains";

export const CHAIN = sepolia;
export const CHAIN_ID = BigInt(sepolia.id);
const env = (k: string): string | undefined => (globalThis as any).process?.env?.[k] ?? (import.meta as any).env?.[k];
export const NODE_URL = env("VITE_EVM_RPC_URL") ?? env("EVM_RPC_URL") ?? "https://ethereum-sepolia-rpc.publicnode.com";
// Bundler et paymaster PUBLICS de Candide (sans clé API, limités par IP) : opérés par un tiers, pas par Swissquote.
export const BUNDLER_URL = env("VITE_EVM_BUNDLER_URL") ?? env("EVM_BUNDLER_URL") ?? "https://api.candide.dev/public/v3/11155111";
// Instance du module de recovery : 3 minutes pour la démo (v0.0.1, adresses de l'étape 0). Valeur cible : 7 ou 14 jours.
export const RECOVERY_MODULE = getAddress(env("VITE_EVM_RECOVERY_MODULE") ?? env("EVM_RECOVERY_MODULE") ?? "0x949d01d424bE050D09C16025dd007CB59b3A8c66");
export const RECOVERY_DELAY_LABEL = RECOVERY_MODULE === "0x949d01d424bE050D09C16025dd007CB59b3A8c66" ? "3 minutes" : "module delay";
// USDC de test de Circle sur Sepolia (adresse publiée par Circle ; symbole USDC, 6 décimales lus on-chain).
export const USDC = getAddress("0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238");
export const USDC_DECIMALS = 6;
const MULTISEND = getAddress(SafeAccountV0_3_0.DEFAULT_MULTISEND_CONTRACT_ADDRESS);
export const EXPLORER = "https://sepolia.etherscan.io";

// Requêtes regroupées (JSON-RPC batch) : le nœud public limite le débit (429) ; une page en émettait ~100 en 25 s.
export const publicClient = createPublicClient({ chain: sepolia, transport: http(NODE_URL, { batch: { batchSize: 50, wait: 20 } }) });
const module_ = new SocialRecoveryModule(RECOVERY_MODULE);

export const erc20Abi = parseAbi([
  "function transfer(address to, uint256 amount) returns (bool)",
  "function approve(address spender, uint256 amount) returns (bool)",
  "function balanceOf(address) view returns (uint256)",
]);
export const recoveryAbi = parseAbi([
  "struct RecoveryRequest { uint256 guardiansApprovalCount; uint256 newThreshold; uint64 executeAfter; address[] newOwners; }",
  "function getRecoveryRequest(address) view returns (RecoveryRequest)",
  "function getGuardians(address) view returns (address[])",
  "function threshold(address) view returns (uint256)",
  "function nonce(address) view returns (uint256)",
  "function addGuardianWithThreshold(address guardian, uint256 threshold)",
  "function revokeGuardianWithThreshold(address prevGuardian, address guardian, uint256 threshold)",
  "function cancelRecovery()",
  "function invalidateNonce()",
  "function finalizeRecovery(address wallet)",
  "function multiConfirmRecovery(address wallet, address[] newOwners, uint256 newThreshold, (address signer, bytes signature)[] signatures, bool execute)",
]);
const safeAbi = parseAbi([
  "function enableModule(address module)",
  "function getOwners() view returns (address[])",
  "function isModuleEnabled(address) view returns (bool)",
  "function executeUserOpWithErrorString(address to, uint256 value, bytes data, uint8 operation)",
  "function executeUserOp(address to, uint256 value, bytes data, uint8 operation)",
  "function multiSend(bytes transactions)",
]);

// ---- Adresses ----
export const safeAddressOf = (owner: Address): Address => getAddress(SafeAccountV0_3_0.createAccountAddress([owner]));
const accountFor = (owner: Address, deployed: boolean) => (deployed ? new SafeAccountV0_3_0(safeAddressOf(owner)) : SafeAccountV0_3_0.initializeNewAccount([owner]));
export const isDeployed = async (a: Address) => { const c = await publicClient.getCode({ address: a }); return !!c && c !== "0x"; };

// ---- Lecture de l'état (au bloc donné : le nœud public peut renvoyer un état en retard, voir étape 16) ----
// Lecture à un bloc précis : le nœud public peut ne pas l'avoir encore (« block not found ») : on réessaie ~40 s.
export async function readState(safe: Address, blockNumber?: bigint): ReturnType<typeof readStateOnce> {
  for (let i = 0; ; i++) {
    try { return await readStateOnce(safe, blockNumber); }
    catch (e) { if (blockNumber === undefined || i >= 20) throw e; await new Promise((r) => setTimeout(r, 2000)); }
  }
}
async function readStateOnce(safe: Address, blockNumber?: bigint) {
  const code = await publicClient.getCode({ address: safe, blockNumber });
  const deployed = !!code && code !== "0x";
  const usdc = await publicClient.readContract({ address: USDC, abi: erc20Abi, functionName: "balanceOf", args: [safe], blockNumber });
  if (!deployed) return { deployed, usdc, owners: [] as Address[], guardians: [] as Address[], threshold: 0n, moduleEnabled: false, pending: null };
  const [owners, moduleEnabled, guardians, threshold, req] = await Promise.all([
    publicClient.readContract({ address: safe, abi: safeAbi, functionName: "getOwners", blockNumber }),
    publicClient.readContract({ address: safe, abi: safeAbi, functionName: "isModuleEnabled", args: [RECOVERY_MODULE], blockNumber }),
    publicClient.readContract({ address: RECOVERY_MODULE, abi: recoveryAbi, functionName: "getGuardians", args: [safe], blockNumber }),
    publicClient.readContract({ address: RECOVERY_MODULE, abi: recoveryAbi, functionName: "threshold", args: [safe], blockNumber }),
    publicClient.readContract({ address: RECOVERY_MODULE, abi: recoveryAbi, functionName: "getRecoveryRequest", args: [safe], blockNumber }),
  ]);
  const pending = req.executeAfter > 0n ? { executeAfter: Number(req.executeAfter), newOwners: req.newOwners as Address[], approvals: req.guardiansApprovalCount } : null;
  return { deployed, usdc, owners: owners as Address[], guardians: guardians as Address[], threshold, moduleEnabled, pending };
}

// ---- Opérations ----
const tx = (to: Address, data: Hex, value = 0n): MetaTransaction => ({ to, value, data });
// Activation : module de recovery + deux gardiens (seuil 2). Envoyée avec le déploiement du Safe.
export const activationCalls = (safe: Address, swissquote: Address, tiers: Address): MetaTransaction[] => [
  module_.createEnableModuleMetaTransaction(safe),
  module_.createAddGuardianWithThresholdMetaTransaction(swissquote, 1n),
  module_.createAddGuardianWithThresholdMetaTransaction(tiers, 2n),
];
export const usdcTransferCall = (to: Address, amount: bigint) => tx(USDC, encodeFunctionData({ abi: erc20Abi, functionName: "transfer", args: [getAddress(to), amount] }));
// Changement de contact de confiance (étape 58), en un seul lot : annulation d'une recovery en cours (si besoin : le retrait
// d'un gardien n'annule pas sa recovery, module v0.0.1), retrait de l'ancien contact (seuil 1 le temps du lot), ajout du
// nouveau (seuil final 2), invalidation des signatures de gardiens déjà collectées. `guardians` : liste lue on-chain, dans
// l'ordre de la liste chaînée du module (le précédent du premier est la sentinelle).
const SENTINEL = "0x0000000000000000000000000000000000000001" as Address;
export function contactChangeCalls(oldContact: Address, newContact: Address, guardians: Address[], pending: boolean): MetaTransaction[] {
  const i = guardians.findIndex((g) => getAddress(g) === getAddress(oldContact));
  if (i < 0) throw new Error(`${oldContact} is not a current guardian`);
  const prev = i === 0 ? SENTINEL : getAddress(guardians[i - 1]);
  return [
    ...(pending ? [module_.createCancelRecoveryMetaTransaction()] : []),
    module_.createStandardRevokeGuardianWithThresholdMetaTransaction(prev, getAddress(oldContact), 1n),
    module_.createAddGuardianWithThresholdMetaTransaction(getAddress(newContact), 2n),
    tx(RECOVERY_MODULE, encodeFunctionData({ abi: recoveryAbi, functionName: "invalidateNonce" })),
  ];
}
export const cancelRecoveryCalls = (): MetaTransaction[] => [
  module_.createCancelRecoveryMetaTransaction(),
  tx(RECOVERY_MODULE, encodeFunctionData({ abi: recoveryAbi, functionName: "invalidateNonce" })),
];

// Opération sérialisable (JSON) : les bigint deviennent des chaînes hexadécimales.
export type JsonOp = Record<string, string | null>;
export const opToJson = (op: UserOperationV7): JsonOp =>
  Object.fromEntries(Object.entries(op).map(([k, v]) => [k, typeof v === "bigint" ? "0x" + v.toString(16) : (v as string | null)]));
const BIG = ["nonce", "callGasLimit", "verificationGasLimit", "preVerificationGas", "maxFeePerGas", "maxPriorityFeePerGas", "paymasterVerificationGasLimit", "paymasterPostOpGasLimit"];
export const opFromJson = (j: JsonOp): UserOperationV7 =>
  Object.fromEntries(Object.entries(j).map(([k, v]) => [k, BIG.includes(k) && v != null ? BigInt(v) : v])) as unknown as UserOperationV7;

// Construit une opération du Safe `safe` (déploiement inclus si besoin, à partir de `owner`) et la fait parrainer.
// Après une recovery, l'adresse du Safe ne se déduit plus du propriétaire : on la passe explicitement.
export async function buildSponsoredOp(acc: { safe: Address; owner: Address }, calls: MetaTransaction[]) {
  const deployed = await isDeployed(acc.safe);
  if (!deployed && safeAddressOf(acc.owner) !== getAddress(acc.safe)) throw new Error("undeployed account that does not match its owner");
  const account = deployed ? new SafeAccountV0_3_0(acc.safe) : SafeAccountV0_3_0.initializeNewAccount([acc.owner]);
  let op = await account.createUserOperation(calls, NODE_URL, BUNDLER_URL);
  ({ userOperation: op } = await new Erc7677Paymaster(BUNDLER_URL).createPaymasterUserOperation(account, op, BUNDLER_URL));
  return opToJson(op);
}
// Propriétaires actuels d'un Safe (lecture on-chain ; [] s'il n'est pas déployé).
export async function ownersOf(safe: Address, blockNumber?: bigint): Promise<Address[]> {
  if (!(await isDeployed(safe))) return [];
  return [...(await publicClient.readContract({ address: safe, abi: safeAbi, functionName: "getOwners", blockNumber }))] as Address[];
}
// Signature par l'EOA propriétaire (format Safe 4337, EIP-712) : appelée UNIQUEMENT dans le Wallet du client.
export const signOp = (j: JsonOp, ownerPrivateKey: Hex): string =>
  new SafeAccountV0_3_0(j.sender!).signUserOperation(opFromJson(j), [ownerPrivateKey], CHAIN_ID);
// Envoi au bundler et attente de l'inclusion. Renvoie le hash de transaction et le bloc.
export async function sendOp(j: JsonOp, signature: string) {
  const op = { ...opFromJson(j), signature };
  const sent = await new SafeAccountV0_3_0(op.sender).sendUserOperation(op, BUNDLER_URL);
  const r = await sent.included();
  if (!r?.success) throw new Error(`operation included but failed (${sent.userOperationHash})`);
  return { txHash: r.receipt.transactionHash as Hex, blockNumber: BigInt(r.receipt.blockNumber), userOpHash: sent.userOperationHash };
}

// ---- Décodage indépendant, pour l'écran de confirmation du Wallet du client ----
export type Call = { to: Address; value: bigint; data: Hex; delegate: boolean };
function unpackMultiSend(packed: Hex): Call[] {
  const out: Call[] = [];
  let i = 0;
  const n = size(packed);
  while (i < n) {
    const op = hexToNumber(slice(packed, i, i + 1));
    const to = getAddress(slice(packed, i + 1, i + 21));
    const value = hexToBigInt(slice(packed, i + 21, i + 53));
    const len = Number(hexToBigInt(slice(packed, i + 53, i + 85)));
    const data = len ? slice(packed, i + 85, i + 85 + len) : "0x";
    out.push({ to, value, data, delegate: op === 1 });
    i += 85 + len;
  }
  return out;
}
export function callsOf(callData: Hex): Call[] {
  const d = decodeFunctionData({ abi: safeAbi, data: callData });
  if (d.functionName !== "executeUserOpWithErrorString" && d.functionName !== "executeUserOp") throw new Error(`unexpected Safe call: ${d.functionName}`);
  const [to, value, data, operation] = d.args as [Address, bigint, Hex, number];
  if (operation === 1) {
    if (getAddress(to) !== MULTISEND) throw new Error(`delegatecall to an unknown contract: ${to}`);
    const m = decodeFunctionData({ abi: safeAbi, data });
    return unpackMultiSend((m.args as [Hex])[0]);
  }
  return [{ to: getAddress(to), value, data, delegate: false }];
}
export type Described = { kind: string; text: string; risk?: string };
// Traduit chaque appel en langage clair. Ce qui n'est pas reconnu est signalé comme tel.
export function describeCall(c: Call, safe: Address, labels: Record<string, string> = {}): Described {
  const name = (a: Address) => labels[a.toLowerCase()] ? `${labels[a.toLowerCase()]} (${a})` : a;
  if (c.delegate) return { kind: "unknown", text: `delegatecall to ${c.to}`, risk: "a delegatecall can take full control of your account" };
  try {
    if (c.to === USDC) {
      const d = decodeFunctionData({ abi: erc20Abi, data: c.data });
      if (d.functionName === "transfer") { const [to, amt] = d.args as [Address, bigint]; return { kind: "usdc-transfer", text: `Send ${formatUnits(amt, USDC_DECIMALS)} USDC to ${name(to)}` }; }
      if (d.functionName === "approve") { const [sp, amt] = d.args as [Address, bigint]; return { kind: "usdc-approve", text: `Allow ${name(sp)} to spend ${amt >= 2n ** 255n ? "an UNLIMITED amount of" : formatUnits(amt, USDC_DECIMALS)} USDC`, risk: amt >= 2n ** 255n ? "unlimited approval" : undefined }; }
    }
    if (c.to === getAddress(safe)) {
      const d = decodeFunctionData({ abi: safeAbi, data: c.data });
      if (d.functionName === "enableModule") { const [m] = d.args as [Address]; return { kind: "enable-module", text: m === RECOVERY_MODULE ? `Enable the recovery module (Candide, ${RECOVERY_DELAY_LABEL} delay)` : `Enable module ${m}`, risk: m === RECOVERY_MODULE ? undefined : "unknown module: it could move your funds" }; }
    }
    if (c.to === RECOVERY_MODULE) {
      const d = decodeFunctionData({ abi: recoveryAbi, data: c.data });
      switch (d.functionName) {
        case "addGuardianWithThreshold": { const [g, t] = d.args as [Address, bigint]; return { kind: "add-guardian", text: `Add recovery guardian ${name(g)} (guardians needed: ${t})` }; }
        case "revokeGuardianWithThreshold": { const [, g, t] = d.args as [Address, Address, bigint]; return { kind: "revoke-guardian", text: `Remove recovery guardian ${name(g)} (guardians needed: ${t})` }; }
        case "cancelRecovery": return { kind: "cancel-recovery", text: "Cancel the recovery in progress on your account" };
        case "invalidateNonce": return { kind: "invalidate-nonce", text: "Invalidate any guardian signature already collected" };
        case "finalizeRecovery": { const [w] = d.args as [Address]; return { kind: "finalize-recovery", text: `Finalize the recovery of account ${w}` }; }
        case "multiConfirmRecovery": { const [w, owners] = d.args as unknown as [Address, readonly Address[]]; return { kind: "start-recovery", text: `Relay the guardians' signatures to start the recovery of ${w} to ${owners.join(", ")}` }; }
      }
    }
  } catch { /* données non reconnues : signalées ci-dessous */ }
  return { kind: "unknown", text: `Unrecognised call to ${c.to}${c.value ? ` with ${formatUnits(c.value, 18)} ETH` : ""} (data ${c.data.slice(0, 10)}…)`, risk: "not decoded: do not sign unless you know what it does" };
}
// Règles sur les gardiens, pour toute l'opération (les appels d'un lot s'exécutent ensemble) : la recovery ne doit jamais
// pouvoir être faite par un seul gardien (invariant 1). Deux changements de gardiens seulement sont acceptés :
//  - l'ACTIVATION du module (activationCalls) : module activé dans le même lot, exactement deux gardiens distincts ajoutés
//    (ni le Safe, ni son propriétaire), seuil final 2 ;
//  - le CHANGEMENT DE CONTACT (contactChangeCalls, étape 58), seulement si la liste actuelle des gardiens est connue
//    (lue on-chain par le wallet) : un gardien actuel retiré, un nouveau ajouté (ni gardien, ni le Safe, ni le
//    propriétaire), toujours deux gardiens, seuil final 2. Le wallet affiche l'ancienne et la nouvelle adresse.
// Tout autre ajout ou retrait de gardien est refusé par ce wallet.
const guardianRules = (calls: Call[], described: Described[], safe: Address, owner?: Address, guardians?: Address[]): { described: Described[]; contactChange: { from: Address; to: Address } | null } => {
  let enables = false, finalThreshold: bigint | null = null;
  const added: Address[] = [], removed: Address[] = [];
  calls.forEach((c, i) => {
    const k = described[i].kind;
    if (k === "enable-module" && !described[i].risk) enables = true;
    if (k === "add-guardian" || k === "revoke-guardian") {
      const d = decodeFunctionData({ abi: recoveryAbi, data: c.data });
      const args = d.args as readonly unknown[];
      finalThreshold = args[args.length - 1] as bigint;
      if (k === "add-guardian") added.push(getAddress(args[0] as Address));
      else removed.push(getAddress(args[1] as Address));
    }
  });
  if (finalThreshold === null) return { described, contactChange: null };
  const distinct = new Set(added).size === added.length;
  const okGuardians = added.every((g) => g !== getAddress(safe) && (!owner || g !== getAddress(owner)));
  const activation = enables && added.length === 2 && distinct && okGuardians && finalThreshold === 2n && !described.some((d) => d.kind === "revoke-guardian");
  const current = (guardians ?? []).map((g) => getAddress(g));
  const allowedExtra = new Set(["revoke-guardian", "add-guardian", "invalidate-nonce", "cancel-recovery"]);
  const change = !!guardians && current.length === 2 && !enables && added.length === 1 && removed.length === 1 && current.includes(removed[0])
    && !current.includes(added[0]) && okGuardians && finalThreshold === 2n && described.every((d) => allowedExtra.has(d.kind));
  const contactChange = change ? { from: removed[0], to: added[0] } : null;
  return { contactChange, described: described.map((d) => {
    if (d.kind !== "add-guardian" && d.kind !== "revoke-guardian") return d;
    if (activation || change) return d;
    const risk = finalThreshold! < 2n
      ? "a single guardian could take over your account (recovery threshold below 2)"
      : d.kind === "revoke-guardian"
        ? "changes who can recover your account: not supported by this wallet"
        : !okGuardians ? "your own key or account cannot be a recovery guardian" : "changes who can recover your account: only the initial activation or the replacement of one guardian (two guardians, threshold 2) is accepted";
    return { ...d, risk };
  }) };
};
// `guardians` : gardiens actuels du Safe, lus on-chain par le wallet (sans eux, aucun changement de contact n'est accepté).
export function describeOp(j: JsonOp, labels: Record<string, string> = {}, owner?: Address, guardians?: Address[]) {
  const safe = getAddress(j.sender!);
  const raw = callsOf(j.callData as Hex);
  const { described: calls, contactChange } = guardianRules(raw, raw.map((c) => describeCall(c, safe, labels)), safe, owner, guardians);
  return { safe, deploys: !!j.factory, sponsored: !!j.paymaster, paymaster: j.paymaster, calls, contactChange };
}

// ---- Recovery (données publiques) ----
export async function recoveryTypedData(safe: Address, newOwner: Address, recoveryNonce: bigint) {
  const { domain, types, messageValue } = await module_.getRecoveryRequestEip712Data(NODE_URL, CHAIN_ID, safe, [newOwner], 1n, { recoveryNonce });
  return { domain, types, primaryType: "ExecuteRecovery" as const, message: messageValue };
}
export const recoveryNonce = (safe: Address, blockNumber?: bigint) =>
  publicClient.readContract({ address: RECOVERY_MODULE, abi: recoveryAbi, functionName: "nonce", args: [safe], blockNumber });
export const startRecoveryCall = (safe: Address, newOwner: Address, sigs: { signer: Address; signature: Hex }[]) =>
  module_.createMultiConfirmRecoveryMetaTransaction(safe, [newOwner], 1, [...sigs].sort((a, b) => (BigInt(a.signer) < BigInt(b.signer) ? -1 : 1)), true);
export const finalizeRecoveryCall = (safe: Address) => module_.createFinalizeRecoveryMetaTransaction(safe);

// ---- Historique lu sur la chaîne (logs) ----
// Événements du module vérifiés sur des transactions réelles (étape 19) : le hash de chaque signature correspond au
// topic0 observé, et le premier champ indexé (topic1) est le Safe.
const TRANSFER = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
const MODULE_EVENTS: Record<string, string> = {
  "0x1fa74635dcccfa96011b50295a26dd08b8c3c6ca7d66ede450288192674ebf01": "recovery-started", // RecoveryExecuted(address,address[],uint256,uint256,uint64,uint256)
  "0x8f02bbdd0d302f6cdd4a448157ae4156c07384b648beae077292ba804d60ad5a": "recovery-completed", // RecoveryFinalized(address,address[],uint256,uint256)
  "0x81da66c7aac3ee4365918a5d70f73e846a59e8a8af01ef155e86518190490519": "recovery-cancelled", // RecoveryCanceled(address,uint256)
  "0x1800cd2301fbc20790ed94f3d55a28ef2306a9c31cd3c72b5b71b6e4cf5c6241": "signatures-invalidated", // NonceInvalidated(address,uint256)
};
export type Activity = { kind: "usdc-in" | "usdc-out" | "recovery-started" | "recovery-completed" | "recovery-cancelled" | "signatures-invalidated"; txHash: Hex; blockNumber: bigint; logIndex: number; amount?: bigint; counterparty?: Address; time?: number };
const topicOf = (a: Address) => ("0x" + a.slice(2).toLowerCase().padStart(64, "0")) as Hex;
// Le nœud public a élagué son historique (« pruned history unavailable » au-delà de quelques milliers de blocs) :
// on lit à reculons par tranches et on s'arrête à la première tranche élaguée. `since` = premier bloc couvert.
export async function activity(safe: Address, lookback = 50_000n, chunk = 2_000n): Promise<{ items: Activity[]; since: bigint }> {
  const latest = await publicClient.getBlockNumber();
  const floor = latest > lookback ? latest - lookback : 0n;
  const raw: { log: any; kind: Activity["kind"] }[] = [];
  const t = topicOf(safe);
  let since = latest + 1n;
  for (let to = latest; to >= floor; to -= chunk) {
    const from = to - chunk + 1n > floor ? to - chunk + 1n : floor;
    const range = { fromBlock: "0x" + from.toString(16), toBlock: "0x" + to.toString(16) };
    const get = (params: object) => publicClient.request({ method: "eth_getLogs", params: [{ ...range, ...params }] as any }) as Promise<any[]>;
    let parts: any[][] | null = null;
    // Nœud public derrière un répartiteur de charge : un serveur en retard peut refuser une plage (« bloc introuvable ») ;
    // on réessaie. Une plage élaguée (« pruned ») marque la fin de l'historique disponible.
    for (let attempt = 0; !parts; attempt++) {
      try {
        parts = await Promise.all([
          get({ address: USDC, topics: [TRANSFER, null, t] }),
          get({ address: USDC, topics: [TRANSFER, t] }),
          get({ address: RECOVERY_MODULE, topics: [Object.keys(MODULE_EVENTS), t] }),
        ]);
      } catch (e: any) {
        if (/pruned/i.test(e?.details ?? e?.message ?? "")) break;
        if (attempt >= 3) throw e;
        await new Promise((r) => setTimeout(r, 1500));
      }
    }
    if (!parts) break;
    const [inc, out, mod] = parts;
    for (const l of inc) raw.push({ log: l, kind: "usdc-in" });
    for (const l of out) raw.push({ log: l, kind: "usdc-out" });
    for (const l of mod) raw.push({ log: l, kind: MODULE_EVENTS[l.topics[0]] as Activity["kind"] });
    since = from;
    if (from === floor) break;
  }
  const blocks = [...new Set(raw.map((r) => r.log.blockNumber as string))];
  const times = new Map(await Promise.all(blocks.map(async (b) => [b, Number((await publicClient.getBlock({ blockNumber: BigInt(b) })).timestamp)] as const)));
  const items = raw.map(({ log, kind }) => ({
    kind, txHash: log.transactionHash, blockNumber: BigInt(log.blockNumber), logIndex: Number(log.logIndex), time: times.get(log.blockNumber),
    ...(kind === "usdc-in" || kind === "usdc-out" ? { amount: BigInt(log.data), counterparty: getAddress("0x" + log.topics[kind === "usdc-in" ? 1 : 2].slice(26)) } : {}),
  } as Activity)).sort((a, b) => (a.blockNumber === b.blockNumber ? b.logIndex - a.logIndex : Number(b.blockNumber - a.blockNumber)));
  return { items, since };
}
