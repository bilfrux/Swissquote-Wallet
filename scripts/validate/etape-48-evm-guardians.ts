// Étape 48 : le Client Wallet refuse toute opération Ethereum qui changerait les gardiens de recovery ou ferait passer le
// seuil sous 2 (un seul gardien pourrait alors prendre le compte : invariant 1), sauf l'activation initiale du module.
// Hors ligne : les opérations sont encodées comme dans l'appli (abstractionkit, SafeAccountV0_3_0), décodées par
// describeOp (packages/evm), qui sert au Client Wallet pour accepter ou refuser de signer.
import { SafeAccountV0_3_0, SocialRecoveryModule } from "abstractionkit";
import { encodeFunctionData, getAddress, type Address } from "viem";
import { privateKeyToAddress, generatePrivateKey } from "viem/accounts";
import { RECOVERY_MODULE, activationCalls, cancelRecoveryCalls, contactChangeCalls, describeOp, recoveryAbi, safeAddressOf, usdcTransferCall } from "@sq/evm";
import { makeReport } from "./lib.ts";

const { report, summary } = makeReport();
const addr = () => privateKeyToAddress(generatePrivateKey());
const owner = addr(), sq = addr(), tiers = addr(), attacker = addr();
const safe = safeAddressOf(owner);
const op = (calls: { to: string; value: bigint; data: string }[]) => ({
  sender: safe,
  callData: calls.length === 1 ? SafeAccountV0_3_0.createAccountCallDataSingleTransaction(calls[0]) : SafeAccountV0_3_0.createAccountCallDataBatchTransactions(calls),
  factory: null, paymaster: null,
});
const m = new SocialRecoveryModule(RECOVERY_MODULE);
const refused = (calls: { to: string; value: bigint; data: string }[]) => describeOp(op(calls), {}, owner).calls.filter((c) => c.kind === "unknown" || c.risk);
const add = (g: Address, t: bigint) => m.createAddGuardianWithThresholdMetaTransaction(g, t);
const revoke = (prev: Address, g: Address, t: bigint) => ({ to: RECOVERY_MODULE, value: 0n, data: encodeFunctionData({ abi: recoveryAbi, functionName: "revokeGuardianWithThreshold", args: [prev, g, t] }) });

const cases: [string, { to: string; value: bigint; data: string }[], boolean][] = [
  ["activation de l'appli (module + Swissquote seuil 1 + contact seuil 2)", activationCalls(safe, sq, tiers), true],
  ["envoi d'USDC", [usdcTransferCall(attacker, 1_000_000n)], true],
  ["annulation d'une recovery (cancelRecovery + invalidateNonce)", cancelRecoveryCalls(), true],
  ["ajout d'un gardien de l'attaquant avec seuil 1 (seul)", [add(attacker, 1n)], false],
  ["ajout d'un gardien, seuil 2 (hors activation)", [add(attacker, 2n)], false],
  ["activation avec seuil final 1", [m.createEnableModuleMetaTransaction(safe), add(sq, 1n), add(tiers, 1n)], false],
  ["activation avec un seul gardien", [m.createEnableModuleMetaTransaction(safe), add(attacker, 1n)], false],
  ["activation où le propriétaire est gardien", [m.createEnableModuleMetaTransaction(safe), add(sq, 1n), add(getAddress(owner), 2n)], false],
  ["activation avec deux fois le même gardien", [m.createEnableModuleMetaTransaction(safe), add(sq, 1n), add(sq, 2n)], false],
  ["remplacement du contact par l'attaquant (ajout puis retrait, seuil 2)", [add(attacker, 2n), revoke(attacker, tiers, 2n)], false],
  ["retrait d'un gardien avec seuil 1", [revoke(sq, tiers, 1n)], false],
  ["activation + retrait dans le même lot", [...activationCalls(safe, sq, tiers), revoke(sq, tiers, 1n)], false],
];
// Étape 58 : changement de contact, accepté seulement si le wallet connaît les gardiens actuels (lus on-chain).
const current = [tiers, sq];
const refusedWith = (calls: { to: string; value: bigint; data: string }[], guardians?: Address[]) => describeOp(op(calls), {}, owner, guardians).calls.filter((c) => c.kind === "unknown" || c.risk);
const newContact = addr();
const changeCases: [string, { to: string; value: bigint; data: string }[], Address[] | undefined, boolean][] = [
  ["changement de contact (retrait de l'ancien, ajout du nouveau, invalidation), gardiens connus", contactChangeCalls(tiers, newContact, current, false), current, true],
  ["même changement, avec annulation d'une recovery en cours", contactChangeCalls(tiers, newContact, current, true), current, true],
  ["même changement, gardiens actuels inconnus du wallet", contactChangeCalls(tiers, newContact, current, false), undefined, false],
  ["« changement » vers le propriétaire lui-même", contactChangeCalls(tiers, owner, current, false), current, false],
  ["« changement » vers un gardien déjà présent", contactChangeCalls(tiers, sq, current, false), current, false],
  ["retrait d'une adresse qui n'est pas gardien", [revoke(sq, attacker, 1n), add(newContact, 2n)], current, false],
  ["changement avec seuil final 1", [revoke(sq, tiers, 1n), add(newContact, 1n)], current, false],
  ["changement + envoi d'USDC dans le même lot", [...contactChangeCalls(tiers, newContact, current, false), usdcTransferCall(attacker, 1n)], current, false],
];
for (const [i, [label, calls, g, ok]] of changeCases.entries()) {
  const r = refusedWith(calls, g);
  const d = describeOp(op(calls), {}, owner, g);
  report(`48-${cases.length + i + 1}`, `${ok ? "Accepté" : "Refusé"} : ${label}`, ok ? r.length === 0 && d.contactChange?.to === getAddress(newContact) : r.length > 0,
    r.map((c) => `${c.text} · ${c.risk}`).join(" | ") || `aucun appel refusé ; changement affiché : ${d.contactChange ? `${d.contactChange.from} → ${d.contactChange.to}` : "aucun"}`);
}
for (const [i, [label, calls, ok]] of cases.entries()) {
  const r = refused(calls);
  report(`48-${i + 1}`, `${ok ? "Accepté" : "Refusé"} : ${label}`, ok ? r.length === 0 : r.length > 0, r.map((c) => `${c.text} · ${c.risk}`).join(" | ") || "aucun appel refusé");
}
process.exit(summary() ? 0 : 1);
