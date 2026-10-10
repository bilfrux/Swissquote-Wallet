// Faisabilité EVM sur le VRAI Sepolia : un Safe sans ETH, déployé avec le module de recovery Candide (instance 3 min)
// et deux gardiens (seuil 2), en UNE UserOperation dont le gas est parrainé par le paymaster public de Candide.
// Clés jetables générées en mémoire (viem), jamais écrites. Aucune clé API.
import { Erc7677Paymaster, SafeAccountV0_3_0, SocialRecoveryModule, SocialRecoveryModuleGracePeriodSelector as Delay } from "abstractionkit";
import { createPublicClient, http, type Hex } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { sepolia } from "viem/chains";

const NODE = process.env.SEPOLIA_RPC_URL ?? "https://ethereum-sepolia-rpc.publicnode.com";
const CANDIDE = process.env.CANDIDE_URL ?? "https://api.candide.dev/public/v3/11155111";
const pub = createPublicClient({ chain: sepolia, transport: http(NODE) });

const ownerKey: Hex = generatePrivateKey();
const owner = privateKeyToAccount(ownerKey);
const [swissquote, tiers] = [privateKeyToAccount(generatePrivateKey()), privateKeyToAccount(generatePrivateKey())];

const safe = SafeAccountV0_3_0.initializeNewAccount([owner.address]);
const srm = new SocialRecoveryModule(Delay.After3Minutes);
console.log(`Safe (contrefactuel) : ${safe.accountAddress}\npropriétaire (EOA) : ${owner.address}\ngardiens : Swissquote ${swissquote.address}, tiers ${tiers.address}`);
console.log(`solde ETH du Safe avant : ${await pub.getBalance({ address: safe.accountAddress as Hex })}`);

let op = await safe.createUserOperation([
  srm.createEnableModuleMetaTransaction(safe.accountAddress),
  srm.createAddGuardianWithThresholdMetaTransaction(swissquote.address, 1n),
  srm.createAddGuardianWithThresholdMetaTransaction(tiers.address, 2n),
], NODE, CANDIDE);

const paymaster = new Erc7677Paymaster(CANDIDE);
try {
  ({ userOperation: op } = await paymaster.createPaymasterUserOperation(safe, op, CANDIDE));
  console.log(`paymaster : parrainage accordé (paymaster ${(op as any).paymaster})`);
} catch (e) {
  console.log(`paymaster : REFUS -> ${(e as Error).message}`);
  process.exit(1);
}
op.signature = safe.signUserOperation(op, [ownerKey], BigInt(sepolia.id));
const sent = await safe.sendUserOperation(op, CANDIDE);
console.log(`UserOperation envoyée : ${sent.userOperationHash}`);
const receipt = await sent.included();
const txHash = receipt?.receipt?.transactionHash;
console.log(`incluse : success=${receipt?.success} tx=${txHash} https://sepolia.etherscan.io/tx/${txHash}`);

// Lecture directe du contrat (getGuardians d'AbstractionKit, appelé juste après l'inclusion, a renvoyé une liste vide au 1er essai).
const srmAbi = [
  { type: "function", name: "getGuardians", stateMutability: "view", inputs: [{ type: "address" }], outputs: [{ type: "address[]" }] },
  { type: "function", name: "threshold", stateMutability: "view", inputs: [{ type: "address" }], outputs: [{ type: "uint256" }] },
] as const;
const read = async () => Promise.all([
  pub.readContract({ address: Delay.After3Minutes as Hex, abi: srmAbi, functionName: "getGuardians", args: [safe.accountAddress as Hex] }),
  pub.readContract({ address: Delay.After3Minutes as Hex, abi: srmAbi, functionName: "threshold", args: [safe.accountAddress as Hex] }),
]);
let [guardians, threshold] = await read();
for (let i = 0; i < 5 && guardians.length < 2; i++) { await new Promise((r) => setTimeout(r, 3000)); [guardians, threshold] = await read(); }
const code = await pub.getCode({ address: safe.accountAddress as Hex });
console.log(`Safe déployé : ${!!code && code !== "0x"} ; solde ETH après : ${await pub.getBalance({ address: safe.accountAddress as Hex })}`);
console.log(`gardiens sur le module (lu sur Sepolia) : ${guardians.join(", ")} ; seuil : ${threshold}`);
const ok = receipt?.success && guardians.length === 2 && threshold === 2n;
console.log(ok ? "RÉSULTAT : fonctionne" : "RÉSULTAT : ne fonctionne pas");
process.exit(ok ? 0 : 1);
