// Étape 16 : parcours EVM complet sur le VRAI Sepolia, sans aucun ETH (bundler + paymaster publics de Candide).
// Safe du client (propriétaire : son EOA) + module de recovery Candide (instance 3 min) + gardiens Swissquote et tiers (seuil 2).
// Clés jetables générées en mémoire (viem), jamais écrites. Les gardiens signent la demande en EIP-712 (viem) ;
// n'importe qui peut relayer : ici un Safe « relais » de la nouvelle clé du client, lui aussi parrainé.
import { Erc7677Paymaster, SafeAccountV0_3_0, SocialRecoveryModule, SocialRecoveryModuleGracePeriodSelector as Delay, type MetaTransaction } from "abstractionkit";
import { createPublicClient, encodeFunctionData, http, parseAbi, type Address, type Hex } from "viem";
import { generatePrivateKey, privateKeyToAccount, type PrivateKeyAccount } from "viem/accounts";
import { sepolia } from "viem/chains";

const NODE = process.env.SEPOLIA_RPC_URL ?? "https://ethereum-sepolia-rpc.publicnode.com";
const CANDIDE = process.env.CANDIDE_URL ?? "https://api.candide.dev/public/v3/11155111";
const pub = createPublicClient({ chain: sepolia, transport: http(NODE) });
const paymaster = new Erc7677Paymaster(CANDIDE);
const MODULE = Delay.After3Minutes as Address;
const srm = new SocialRecoveryModule(MODULE);
const NFT = "0x9a7af758aE5d7B6aAE84fe4C5Ba67c041dFE5336" as Address; // contrat NFT de test utilisé dans la doc de Candide
const srmAbi = parseAbi([
  "struct RecoveryRequest { uint256 guardiansApprovalCount; uint256 newThreshold; uint64 executeAfter; address[] newOwners; }",
  "function getRecoveryRequest(address) view returns (RecoveryRequest)",
  "function nonce(address) view returns (uint256)",
  "function cancelRecovery()",
  "function invalidateNonce()",
]);
const nftAbi = parseAbi(["function mint(address)", "function balanceOf(address) view returns (uint256)"]);
const ownersAbi = parseAbi(["function getOwners() view returns (address[])"]);

const results: [string, string, boolean][] = [];
const report = (id: string, label: string, ok: boolean, detail: string) => {
  results.push([id, label, ok]);
  console.log(`[${ok ? "OK " : "KO "}] ${id} ${label}\n       ${detail}`);
};
const key = () => { const k = generatePrivateKey(); return { k, a: privateKeyToAccount(k) }; };
const tx = (to: Address, data: Hex): MetaTransaction => ({ to, value: 0n, data });
// Raison du refus : la cause renvoyée par le bundler (revert du contrat ou code AA), sinon le message.
const short = (e: any) => {
  const c = e?.cause;
  return (c ? `${e.code} <- ${c.code ?? ""}: ${c.message}` : `${e?.code ?? ""} ${e?.message ?? e}`).replace(/\s+/g, " ").slice(0, 240);
};

// Envoie une UserOperation parrainée, signée par `signerKey`, et attend son inclusion.
async function sendOp(safe: SafeAccountV0_3_0, signerKey: Hex, txs: MetaTransaction[]) {
  let op = await safe.createUserOperation(txs, NODE, CANDIDE);
  ({ userOperation: op } = await paymaster.createPaymasterUserOperation(safe, op, CANDIDE));
  op.signature = safe.signUserOperation(op, [signerKey], BigInt(sepolia.id));
  const sent = await safe.sendUserOperation(op, CANDIDE);
  const r = await sent.included();
  if (!r?.success) throw new Error(`UserOperation incluse mais en échec : ${sent.userOperationHash}`);
  lastBlock = BigInt(r.receipt.blockNumber);
  return r.receipt.transactionHash as Hex;
}
// Le nœud RPC public (répartiteur de charge) peut répondre avec un état en retard juste après l'inclusion :
// toutes les lectures se font AU bloc de la dernière opération incluse, en réessayant tant que le nœud ne l'a pas.
let lastBlock = 0n;
async function at<T>(f: (blockNumber?: bigint) => Promise<T>): Promise<T> {
  for (let i = 0; ; i++) {
    try { return await f(lastBlock || undefined); } catch (e) { if (i >= 15) throw e; await new Promise((r) => setTimeout(r, 2000)); }
  }
}
const tryOp = async (safe: SafeAccountV0_3_0, signerKey: Hex, txs: MetaTransaction[]) => {
  try { return { ok: true as const, tx: await sendOp(safe, signerKey, txs) }; } catch (e) { return { ok: false as const, err: short(e) }; }
};
// Signature EIP-712 d'un gardien sur la demande de recovery (données typées fournies par AbstractionKit, signées par viem).
async function guardianSig(g: PrivateKeyAccount, wallet: Address, newOwners: Address[]) {
  const recoveryNonce = await at((blockNumber) => pub.readContract({ address: MODULE, abi: srmAbi, functionName: "nonce", args: [wallet], blockNumber }));
  const { domain, types, messageValue } = await srm.getRecoveryRequestEip712Data(NODE, BigInt(sepolia.id), wallet, newOwners, 1n, { recoveryNonce });
  const signature = await g.signTypedData({ domain: domain as any, types: types as any, primaryType: "ExecuteRecovery", message: messageValue as any });
  return { signer: g.address, signature };
}
const sorted = <T extends { signer: string }>(p: T[]) => [...p].sort((a, b) => (BigInt(a.signer) < BigInt(b.signer) ? -1 : 1));
const request = (wallet: Address) => at((blockNumber) => pub.readContract({ address: MODULE, abi: srmAbi, functionName: "getRecoveryRequest", args: [wallet], blockNumber }));
const owners = (wallet: Address) => at((blockNumber) => pub.readContract({ address: wallet, abi: ownersAbi, functionName: "getOwners", blockNumber }));
const nfts = (wallet: Address) => at((blockNumber) => pub.readContract({ address: NFT, abi: nftAbi, functionName: "balanceOf", args: [wallet], blockNumber }));
const link = (h: string) => `https://sepolia.etherscan.io/tx/${h}`;

const client = key(), swissquote = key(), tiers = key(), newClient = key(), attacker = key();
const A = SafeAccountV0_3_0.initializeNewAccount([client.a.address]);
const wallet = A.accountAddress as Address;
console.log(`Safe du client : ${wallet}\nclient ${client.a.address} ; Swissquote ${swissquote.a.address} ; tiers ${tiers.a.address} ; nouvelle clé ${newClient.a.address}`);

// 16-1 Création : Safe + module + 2 gardiens (seuil 2) + première transaction du client (mint d'un NFT de test), en une UserOp.
{
  const h = await sendOp(A, client.k, [
    srm.createEnableModuleMetaTransaction(wallet),
    srm.createAddGuardianWithThresholdMetaTransaction(swissquote.a.address, 1n),
    srm.createAddGuardianWithThresholdMetaTransaction(tiers.a.address, 2n),
    tx(NFT, encodeFunctionData({ abi: nftAbi, functionName: "mint", args: [wallet] })),
  ]);
  report("16-1", "Création sans ETH : Safe + module de recovery + 2 gardiens (seuil 2) + transaction signée par le client, une UserOp parrainée",
    (await nfts(wallet)) === 1n && (await at((blockNumber) => pub.getBalance({ address: wallet, blockNumber }))) === 0n, `${link(h)} ; NFT détenus : ${await nfts(wallet)} ; ETH du Safe : 0`);
}

// Relais : Safe de la nouvelle clé du client (n'importe qui peut relayer les signatures des gardiens).
const H = SafeAccountV0_3_0.initializeNewAccount([newClient.a.address]);

// 16-2 Swissquote seul ne lance pas de recovery.
{
  const r = await tryOp(H, newClient.k, [srm.createMultiConfirmRecoveryMetaTransaction(wallet, [newClient.a.address], 1, [await guardianSig(swissquote.a, wallet, [newClient.a.address])], true)]);
  report("16-2", "Swissquote seul : la recovery ne démarre pas", !r.ok && r.err.includes("less than threshold") && (await request(wallet)).executeAfter === 0n, r.ok ? `ACCEPTÉE ${link(r.tx)}` : r.err);
}

// 16-3 Swissquote + tiers lancent la recovery vers la nouvelle clé ; finaliser avant le délai est refusé.
let started: bigint;
{
  const sigs = sorted([await guardianSig(swissquote.a, wallet, [newClient.a.address]), await guardianSig(tiers.a, wallet, [newClient.a.address])]);
  const h = await sendOp(H, newClient.k, [srm.createMultiConfirmRecoveryMetaTransaction(wallet, [newClient.a.address], 1, sigs, true)]);
  const req = await request(wallet);
  started = req.executeAfter;
  const early = await tryOp(H, newClient.k, [srm.createFinalizeRecoveryMetaTransaction(wallet)]);
  report("16-3", "Swissquote + tiers lancent la recovery (relayée, parrainée) ; finalisation avant le délai refusée",
    req.executeAfter > 0n && !early.ok && early.err.includes("recovery period still pending") && (await owners(wallet))[0] === client.a.address,
    `${link(h)} ; applicable après ${new Date(Number(req.executeAfter) * 1000).toISOString()} ; finalisation anticipée : ${early.ok ? "ACCEPTÉE" : early.err}`);
}

// Attente du délai (instance 3 min), d'après l'horodatage des blocs.
for (;;) {
  const b = await pub.getBlock();
  if (b.timestamp > started) break;
  process.stdout.write(`  attente du délai : ${Number(started - b.timestamp)} s\r`);
  await new Promise((r) => setTimeout(r, 15000));
}
console.log("");

// 16-4 Finalisation après le délai ; la nouvelle clé signe ; l'ancienne est refusée.
{
  const h = await sendOp(H, newClient.k, [srm.createFinalizeRecoveryMetaTransaction(wallet)]);
  const A2 = new SafeAccountV0_3_0(wallet);
  const old = await tryOp(A2, client.k, [tx(NFT, encodeFunctionData({ abi: nftAbi, functionName: "mint", args: [wallet] }))]);
  const h2 = await sendOp(A2, newClient.k, [
    tx(NFT, encodeFunctionData({ abi: nftAbi, functionName: "mint", args: [wallet] })),
    tx(MODULE, encodeFunctionData({ abi: srmAbi, functionName: "invalidateNonce" })), // règle du projet après toute recovery
  ]);
  const o = await owners(wallet);
  report("16-4", "Après le délai : propriétaire remplacé ; la nouvelle clé signe (et invalide le nonce) ; l'ancienne clé est refusée",
    o.length === 1 && o[0] === newClient.a.address && !old.ok && old.err.includes("Invalid account signature") && (await nfts(wallet)) === 2n,
    `finalisation ${link(h)} ; propriétaires : ${o.join(",")} ; ancienne clé : ${old.ok ? `ACCEPTÉE ${link(old.tx)}` : old.err} ; nouvelle clé ${link(h2)}`);
}

// 16-5 Une recovery hostile (Swissquote + tiers vers un attaquant) est annulée par le propriétaire pendant le délai.
{
  const sigs = sorted([await guardianSig(swissquote.a, wallet, [attacker.a.address]), await guardianSig(tiers.a, wallet, [attacker.a.address])]);
  await sendOp(H, newClient.k, [srm.createMultiConfirmRecoveryMetaTransaction(wallet, [attacker.a.address], 1, sigs, true)]);
  const pending = (await request(wallet)).executeAfter;
  const h = await sendOp(new SafeAccountV0_3_0(wallet), newClient.k, [
    srm.createCancelRecoveryMetaTransaction(),
    tx(MODULE, encodeFunctionData({ abi: srmAbi, functionName: "invalidateNonce" })),
  ]);
  const after = await request(wallet);
  const fin = await tryOp(H, newClient.k, [srm.createFinalizeRecoveryMetaTransaction(wallet)]);
  report("16-5", "Recovery vers un attaquant lancée par Swissquote + tiers : annulée par le propriétaire (cancelRecovery + invalidateNonce)",
    pending > 0n && after.executeAfter === 0n && !fin.ok && fin.err.includes("no ongoing recovery") && (await owners(wallet))[0] === newClient.a.address,
    `en attente jusqu'à ${pending} ; annulation ${link(h)} ; ensuite finalisation : ${fin.ok ? "ACCEPTÉE" : fin.err}`);
}

console.log("\nRÉSUMÉ");
for (const [id, label, ok] of results) console.log(`${id.padEnd(5)} ${ok ? "fonctionne        " : "ne fonctionne pas "} ${label}`);
process.exit(results.every((r) => r[2]) ? 0 : 1);
