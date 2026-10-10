// Étape 0 : faisabilité du module de recovery Candide, exécutée sur un fork Anvil de Sepolia.
// Le fork exécute le bytecode réellement déployé sur Sepolia. Les clés utilisées sont les clés
// de test publiques d'Anvil : aucune valeur secrète.
import {
  SafeAccountV0_3_0,
  SocialRecoveryModule,
  SocialRecoveryModuleGracePeriodSelector as Delay,
} from "abstractionkit";
import {
  createPublicClient,
  createTestClient,
  createWalletClient,
  http,
  parseAbi,
  encodeFunctionData,
  getAddress,
  hashTypedData,
  pad,
  concat,
  type Address,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { sepolia } from "viem/chains";

const RPC = process.env.FORK_RPC_URL ?? "http://127.0.0.1:8545";
const chain = { ...sepolia, rpcUrls: { default: { http: [RPC] } } };
const pub = createPublicClient({ chain, transport: http(RPC) });
const test = createTestClient({ chain, mode: "anvil", transport: http(RPC) });

// Clés de test publiques d'Anvil (mnémonique « test test ... junk »).
const KEYS: Hex[] = [
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80",
  "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d",
  "0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a",
  "0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6",
  "0x47e179ec197488593b187f80a00eb0da91f1b9d0b13f8733639f19c30a34926a",
  "0x8b3a350cf5c34c9194ca85829a2df0ec3153be0318b5e2d3348e872092edffba",
];
const [owner, backup, swissquote, tiers, newOwner, attacker] = KEYS.map((k) => privateKeyToAccount(k));
const wallet = (acc: typeof owner) => createWalletClient({ account: acc, chain, transport: http(RPC) });

const safeAbi = parseAbi([
  "function execTransaction(address to,uint256 value,bytes data,uint8 operation,uint256 safeTxGas,uint256 baseGas,uint256 gasPrice,address gasToken,address refundReceiver,bytes signatures) payable returns (bool)",
  "function getOwners() view returns (address[])",
  "function isModuleEnabled(address) view returns (bool)",
  "function getModulesPaginated(address,uint256) view returns (address[],address)",
  "function VERSION() view returns (string)",
]);
// ABI de la version déployée (0.0.1), lue dans le source au commit audité 113d3c0.
const srmAbi = parseAbi([
  "struct SignatureData { address signer; bytes signature; }",
  "struct RecoveryRequest { uint256 guardiansApprovalCount; uint256 newThreshold; uint64 executeAfter; address[] newOwners; }",
  "function confirmRecovery(address,address[],uint256,bool)",
  "function multiConfirmRecovery(address,address[],uint256,SignatureData[],bool)",
  "function executeRecovery(address,address[],uint256)",
  "function finalizeRecovery(address)",
  "function cancelRecovery()",
  "function invalidateNonce()",
  "function addGuardianWithThreshold(address,uint256)",
  "function revokeGuardianWithThreshold(address,address,uint256)",
  "function getRecoveryRequest(address) view returns (RecoveryRequest)",
  "function getRecoveryHash(address,address[],uint256,uint256) view returns (bytes32)",
  "function getGuardians(address) view returns (address[])",
  "function threshold(address) view returns (uint256)",
  "function nonce(address) view returns (uint256)",
  "function VERSION() view returns (string)",
]);
const webAuthnFactoryAbi = parseAbi([
  "function getSigner(uint256 x,uint256 y,uint176 verifiers) view returns (address)",
  "function createSigner(uint256 x,uint256 y,uint176 verifiers) returns (address)",
]);

// ---------- rapport ----------
type Verdict = "fonctionne" | "ne fonctionne pas" | "non testé";
const results: { id: string; label: string; verdict: Verdict; detail: string }[] = [];
function report(id: string, label: string, ok: boolean, detail: string) {
  const verdict: Verdict = ok ? "fonctionne" : "ne fonctionne pas";
  results.push({ id, label, verdict, detail });
  console.log(`[${ok ? "OK " : "KO "}] ${id} ${label}\n       ${detail}`);
}
async function expectRevert(p: Promise<unknown>): Promise<string> {
  try {
    await p;
    return "PAS DE REVERT";
  } catch (e: any) {
    const m = String(e?.shortMessage ?? e?.message ?? e);
    const reason = m.match(/reverted with the following reason:\s*\n?(.*)/)?.[1] ?? m.split("\n")[0];
    return `revert: ${reason.trim()}`;
  }
}

// ---------- helpers ----------
async function send(acc: typeof owner, to: Address, data: Hex) {
  const hash = await wallet(acc).sendTransaction({ to, data });
  const r = await pub.waitForTransactionReceipt({ hash });
  if (r.status !== "success") throw new Error(`tx reverted ${hash}`);
  return hash;
}
// Transaction du Safe par son propriétaire EOA : signature « approved hash » de Safe
// (v = 1, r = adresse du propriétaire), valide quand msg.sender est ce propriétaire.
async function execSafe(safe: Address, signer: typeof owner, to: Address, data: Hex) {
  const sig = concat([pad(signer.address, { size: 32 }), pad("0x00", { size: 32 }), "0x01"]);
  const z = "0x0000000000000000000000000000000000000000" as Address;
  const callData = encodeFunctionData({
    abi: safeAbi,
    functionName: "execTransaction",
    args: [to, 0n, data, 0, 0n, 0n, 0n, z, z, sig],
  });
  // simulate d'abord pour récupérer la raison du revert
  await pub.call({ account: signer.address, to: safe, data: callData });
  return send(signer, safe, callData);
}
async function guardianSig(signer: typeof owner, module: Address, safe: Address, newOwners: Address[], newThreshold: bigint, nonce: bigint) {
  const domain = { name: "Social Recovery Module", version: "0.0.1", chainId: sepolia.id, verifyingContract: module } as const;
  const types = { ExecuteRecovery: [
    { name: "wallet", type: "address" }, { name: "newOwners", type: "address[]" },
    { name: "newThreshold", type: "uint256" }, { name: "nonce", type: "uint256" },
  ] } as const;
  const message = { wallet: safe, newOwners, newThreshold, nonce };
  const signature = await signer.signTypedData({ domain, types, primaryType: "ExecuteRecovery", message });
  return { signer: signer.address, signature, hash: hashTypedData({ domain, types, primaryType: "ExecuteRecovery", message }) };
}
const sortPairs = (p: { signer: Address; signature: Hex }[]) =>
  [...p].sort((a, b) => (BigInt(a.signer) < BigInt(b.signer) ? -1 : 1));
async function warp(seconds: number) {
  await test.increaseTime({ seconds });
  await test.mine({ blocks: 1 });
}
const read = (address: Address, functionName: any, args: any[] = []) =>
  pub.readContract({ address, abi: srmAbi, functionName, args } as any) as Promise<any>;

// ---------- scénario ----------
const M3m = getAddress(Delay.After3Minutes), M3d = getAddress(Delay.After3Days), M14d = getAddress(Delay.After14Days);

async function main() {
  console.log(`chainId=${await pub.getChainId()} bloc=${await pub.getBlockNumber()}`);
  for (const m of [M3m, M3d, getAddress(Delay.After7Days), M14d]) {
    console.log(`module ${m} VERSION=${await read(m, "VERSION")} code=${((await pub.getCode({ address: m }))!.length - 2) / 2} octets`);
  }

  // T1 : Safe avec une EOA propriétaire, init code calculé par AbstractionKit.
  const acc = SafeAccountV0_3_0.initializeNewAccount([owner.address], { c2Nonce: BigInt(Date.now()) });
  const safe = getAddress(acc.accountAddress);
  await send(attacker, (acc as any).factoryAddress, (acc as any).factoryData);
  const owners0 = await pub.readContract({ address: safe, abi: safeAbi, functionName: "getOwners" });
  report("1", "Safe créé avec une EOA propriétaire", owners0[0] === owner.address,
    `safe=${safe} VERSION=${await pub.readContract({ address: safe, abi: safeAbi, functionName: "VERSION" })} owners=${owners0}`);

  // T2 : trois instances sur le même Safe, chacune 2 guardians, seuil 2.
  const srm = (m: Address) => new SocialRecoveryModule(m);
  const config: [Address, Address[]][] = [
    [M3m, [backup.address, swissquote.address]],
    [M3d, [backup.address, tiers.address]],
    [M14d, [swissquote.address, tiers.address]],
  ];
  for (const [m, gs] of config) {
    const en = srm(m).createEnableModuleMetaTransaction(safe);
    await execSafe(safe, owner, en.to as Address, en.data as Hex);
    for (const g of gs) {
      const t = srm(m).createAddGuardianWithThresholdMetaTransaction(g, 2n);
      // le seuil ne peut pas dépasser le nombre de guardians : 1 au premier ajout, 2 au second
      const thr = (await read(m, "getGuardians", [safe])).length === 0 ? 1n : 2n;
      const data = encodeFunctionData({ abi: srmAbi, functionName: "addGuardianWithThreshold", args: [g, thr] });
      await execSafe(safe, owner, t.to as Address, data);
    }
  }
  const lines = [];
  let ok2 = true;
  for (const [m, gs] of config) {
    const en = await pub.readContract({ address: safe, abi: safeAbi, functionName: "isModuleEnabled", args: [m] });
    const g = await read(m, "getGuardians", [safe]);
    const t = await read(m, "threshold", [safe]);
    ok2 &&= en && g.length === 2 && t === 2n && gs.every((x) => g.includes(x));
    lines.push(`${m} enabled=${en} guardians=${g.length} seuil=${t}`);
  }
  report("2", "Trois instances (3 min, 3 j, 14 j) activées sur le même Safe, seuil 2", ok2, lines.join(" | "));

  // Hash EIP-712 calculé par viem = hash du contrat ?
  {
    const n = await read(M3m, "nonce", [safe]);
    const s = await guardianSig(backup, M3m, safe, [newOwner.address], 1n, n);
    const onchain = await read(M3m, "getRecoveryHash", [safe, [newOwner.address], 1n, n]);
    report("2b", "Hash EIP-712 de viem identique à getRecoveryHash du module", s.hash === onchain, `viem=${s.hash} module=${onchain}`);
  }

  // T3 : un guardian = une adresse = une voix.
  {
    const dupData = encodeFunctionData({ abi: srmAbi, functionName: "addGuardianWithThreshold", args: [backup.address, 2n] });
    const r = await expectRevert(execSafe(safe, owner, M3m, dupData));
    // GS013 masque la raison : on rejoue l'appel interne avec msg.sender = Safe (eth_call simulé)
    const inner = await expectRevert(pub.call({ account: safe, to: M3m, data: dupData }));
    report("3a", "Même adresse enregistrée deux fois dans une instance : refusé", r.includes("GS013") && inner.includes("duplicate guardian"), `via Safe : ${r} ; appel interne : ${inner}`);

    const n = await read(M3m, "nonce", [safe]);
    const s = await guardianSig(swissquote, M3m, safe, [attacker.address], 1n, n);
    const twice = [{ signer: s.signer, signature: s.signature }, { signer: s.signer, signature: s.signature }];
    const r2 = await expectRevert(send(attacker, M3m, encodeFunctionData({ abi: srmAbi, functionName: "multiConfirmRecovery", args: [safe, [attacker.address], 1n, twice, true] })));
    report("3b", "Même signature comptée deux fois (multiConfirm) : refusé", r2.includes("duplicate signers"), r2);

    // rejeu d'une signature d'une instance sur une autre (domaine EIP-712 = adresse du module)
    const n14 = await read(M14d, "nonce", [safe]);
    const s3m = await guardianSig(swissquote, M3m, safe, [attacker.address], 1n, n14);
    const st = await guardianSig(tiers, M14d, safe, [attacker.address], 1n, n14);
    const r3 = await expectRevert(send(attacker, M14d, encodeFunctionData({ abi: srmAbi, functionName: "multiConfirmRecovery",
      args: [safe, [attacker.address], 1n, sortPairs([{ signer: s3m.signer, signature: s3m.signature }, { signer: st.signer, signature: st.signature }]), true] })));
    report("3c", "Signature Swissquote faite pour l'instance 3 min rejouée sur l'instance 14 j : refusé", r3.includes("Invalid guardian signature"), r3);
  }

  // T4 : Swissquote seule.
  {
    const target = [attacker.address];
    const r1 = await expectRevert(send(swissquote, M3m, encodeFunctionData({ abi: srmAbi, functionName: "confirmRecovery", args: [safe, target, 1n, true] })));
    report("4a", "Swissquote seule lance (confirm + execute) sur l'instance 3 min : refusé", r1.includes("less than threshold"), r1);
    // Elle peut enregistrer une confirmation sans exécuter :
    await send(swissquote, M3m, encodeFunctionData({ abi: srmAbi, functionName: "confirmRecovery", args: [safe, target, 1n, false] }));
    const r2 = await expectRevert(send(attacker, M3m, encodeFunctionData({ abi: srmAbi, functionName: "executeRecovery", args: [safe, target, 1n] })));
    report("4b", "Après la confirmation seule de Swissquote, executeRecovery (par n'importe qui) : refusé", r2.includes("less than threshold"), r2);
    const r3 = await expectRevert(send(swissquote, M3d, encodeFunctionData({ abi: srmAbi, functionName: "confirmRecovery", args: [safe, target, 1n, false] })));
    report("4c", "Swissquote confirme sur l'instance 3 j où elle n'est pas guardian : refusé", r3.includes("not a guardian"), r3);
    const r4 = await expectRevert(send(swissquote, M3m, encodeFunctionData({ abi: srmAbi, functionName: "addGuardianWithThreshold", args: [attacker.address, 1n] })));
    report("4d", "Swissquote s'ajoute un complice comme guardian (appel direct) : refusé", r4.startsWith("revert"), r4);
    const r5 = await expectRevert(send(swissquote, M14d, encodeFunctionData({ abi: srmAbi, functionName: "finalizeRecovery", args: [safe] })));
    report("4e", "Swissquote finalise sans recovery en attente : refusé", r5.includes("no ongoing recovery"), r5);
    // nettoyage de la confirmation orpheline
    await execSafe(safe, owner, M3m, encodeFunctionData({ abi: srmAbi, functionName: "invalidateNonce" }));
  }

  // T5 : chemin long lancé par Swissquote + tiers, puis annulé par le propriétaire.
  {
    const target = [attacker.address];
    const n = await read(M14d, "nonce", [safe]);
    const a = await guardianSig(swissquote, M14d, safe, target, 1n, n);
    const b = await guardianSig(tiers, M14d, safe, target, 1n, n);
    await send(attacker, M14d, encodeFunctionData({ abi: srmAbi, functionName: "multiConfirmRecovery",
      args: [safe, target, 1n, sortPairs([{ signer: a.signer, signature: a.signature }, { signer: b.signer, signature: b.signature }]), true] }));
    const req = await read(M14d, "getRecoveryRequest", [safe]);
    const now = (await pub.getBlock()).timestamp;
    report("5a", "Swissquote + tiers lancent une recovery sur l'instance 14 j", req.executeAfter > 0n,
      `executeAfter - maintenant = ${req.executeAfter - now} s (14 j = ${14 * 86400} s)`);
    await warp(13 * 86400);
    const r = await expectRevert(send(attacker, M14d, encodeFunctionData({ abi: srmAbi, functionName: "finalizeRecovery", args: [safe] })));
    report("5b", "Finalisation à J+13 : refusée (délai appliqué on-chain)", r.includes("still pending"), r);
    await execSafe(safe, owner, M14d, encodeFunctionData({ abi: srmAbi, functionName: "cancelRecovery" }));
    await warp(2 * 86400);
    const r2 = await expectRevert(send(attacker, M14d, encodeFunctionData({ abi: srmAbi, functionName: "finalizeRecovery", args: [safe] })));
    report("5c", "Annulation par le propriétaire pendant le délai, puis finalisation à J+15 : refusée", r2.includes("no ongoing recovery"), r2);
    // les mêmes signatures ne peuvent pas relancer : le nonce a avancé à l'exécution
    const r3 = await expectRevert(send(attacker, M14d, encodeFunctionData({ abi: srmAbi, functionName: "multiConfirmRecovery",
      args: [safe, target, 1n, sortPairs([{ signer: a.signer, signature: a.signature }, { signer: b.signer, signature: b.signature }]), true] })));
    report("5d", "Rejeu des mêmes signatures après annulation : refusé", r3.includes("Invalid guardian signature"), r3);
  }

  // T6 : la recovery sur une instance n'est pas annulée par l'annulation d'une autre.
  //      Et instances concurrentes : une recovery 14 j en attente survit à une recovery 3 min réussie.
  const snapBeforeFull = await test.snapshot();
  {
    // 14 j lancée par Swissquote + tiers vers l'attaquant
    const n = await read(M14d, "nonce", [safe]);
    const a = await guardianSig(swissquote, M14d, safe, [attacker.address], 1n, n);
    const b = await guardianSig(tiers, M14d, safe, [attacker.address], 1n, n);
    await send(attacker, M14d, encodeFunctionData({ abi: srmAbi, functionName: "multiConfirmRecovery",
      args: [safe, [attacker.address], 1n, sortPairs([a, b].map(({ signer, signature }) => ({ signer, signature }))), true] }));

    // 3 min menée au bout par backup + Swissquote vers newOwner
    const n3 = await read(M3m, "nonce", [safe]);
    const c = await guardianSig(backup, M3m, safe, [newOwner.address], 1n, n3);
    const d = await guardianSig(swissquote, M3m, safe, [newOwner.address], 1n, n3);
    await send(attacker, M3m, encodeFunctionData({ abi: srmAbi, functionName: "multiConfirmRecovery",
      args: [safe, [newOwner.address], 1n, sortPairs([c, d].map(({ signer, signature }) => ({ signer, signature }))), true] }));
    const r0 = await expectRevert(send(attacker, M3m, encodeFunctionData({ abi: srmAbi, functionName: "finalizeRecovery", args: [safe] })));
    await warp(181);
    await send(attacker, M3m, encodeFunctionData({ abi: srmAbi, functionName: "finalizeRecovery", args: [safe] }));
    const owners1 = await pub.readContract({ address: safe, abi: safeAbi, functionName: "getOwners" });
    report("6a", "Recovery complète backup + Swissquote vers une nouvelle EOA (3 min), finalisée par un tiers quelconque",
      owners1.length === 1 && owners1[0] === newOwner.address, `finalisation avant 3 min : ${r0} ; owners après = ${owners1}`);

    const dummy = encodeFunctionData({ abi: srmAbi, functionName: "invalidateNonce" });
    const rOld = await expectRevert(execSafe(safe, owner, M3m, dummy));
    let newOk = true;
    try { await execSafe(safe, newOwner, M3m, dummy); } catch { newOk = false; }
    report("6b", "Ancien propriétaire ne peut plus signer, le nouveau le peut", rOld.startsWith("revert") && newOk, `ancien : ${rOld} ; nouveau : ${newOk ? "tx acceptée" : "refusée"}`);

    const pending = await read(M14d, "getRecoveryRequest", [safe]);
    const snapConcurrent = await test.snapshot();
    await warp(14 * 86400);
    await send(attacker, M14d, encodeFunctionData({ abi: srmAbi, functionName: "finalizeRecovery", args: [safe] }));
    const owners2 = await pub.readContract({ address: safe, abi: safeAbi, functionName: "getOwners" });
    report("6c", "DANGER confirmé : la recovery 14 j lancée AVANT survit à la recovery 3 min et remplace le NOUVEAU propriétaire si on ne l'annule pas",
      pending.executeAfter > 0n && owners2[0] === attacker.address, `owners après finalisation 14 j = ${owners2}`);
    await test.revert({ id: snapConcurrent });

    // le nouveau propriétaire annule tout sur toutes les instances
    for (const m of [M3m, M3d, M14d]) {
      const req = await read(m, "getRecoveryRequest", [safe]);
      if (req.executeAfter > 0n) await execSafe(safe, newOwner, m, encodeFunctionData({ abi: srmAbi, functionName: "cancelRecovery" }));
      await execSafe(safe, newOwner, m, encodeFunctionData({ abi: srmAbi, functionName: "invalidateNonce" }));
    }
    await warp(14 * 86400);
    const r6 = await expectRevert(send(attacker, M14d, encodeFunctionData({ abi: srmAbi, functionName: "finalizeRecovery", args: [safe] })));
    report("6d", "Après annulation sur toutes les instances par le nouveau propriétaire, la 14 j ne peut plus finaliser", r6.includes("no ongoing recovery"), r6);
  }
  await test.revert({ id: snapBeforeFull });

  // T7 : changement de guardian : délai ? Et effet sur une recovery en attente (pas de L-03 en 0.0.1).
  {
    const snap = await test.snapshot();
    const n = await read(M14d, "nonce", [safe]);
    const a = await guardianSig(swissquote, M14d, safe, [attacker.address], 1n, n);
    const b = await guardianSig(tiers, M14d, safe, [attacker.address], 1n, n);
    await send(attacker, M14d, encodeFunctionData({ abi: srmAbi, functionName: "multiConfirmRecovery",
      args: [safe, [attacker.address], 1n, sortPairs([a, b].map(({ signer, signature }) => ({ signer, signature }))), true] }));
    // le propriétaire remplace le tiers (ajoute avant de retirer), sans attendre
    const before = (await pub.getBlock()).timestamp;
    const newTiers = privateKeyToAccount("0x92db14e403b83dfe3df233f83dfa3a0d7096f21ca9b0d6d6b8d88b2b4ec1564e").address;
    await execSafe(safe, owner, M14d, encodeFunctionData({ abi: srmAbi, functionName: "addGuardianWithThreshold", args: [newTiers, 2n] }));
    const gs = await read(M14d, "getGuardians", [safe]);
    const prev = gs[gs.indexOf(tiers.address) - 1] ?? "0x0000000000000000000000000000000000000001";
    await execSafe(safe, owner, M14d, encodeFunctionData({ abi: srmAbi, functionName: "revokeGuardianWithThreshold", args: [prev, tiers.address, 2n] }));
    const gs2 = await read(M14d, "getGuardians", [safe]);
    const after = (await pub.getBlock()).timestamp;
    report("7a", "Changement de guardian par le propriétaire : effectif immédiatement, aucun délai imposé par le module",
      !gs2.includes(tiers.address) && gs2.includes(newTiers), `écart = ${after - before} s ; guardians = ${gs2}`);
    const still = await read(M14d, "getRecoveryRequest", [safe]);
    await warp(14 * 86400);
    const fin = await expectRevert(send(attacker, M14d, encodeFunctionData({ abi: srmAbi, functionName: "finalizeRecovery", args: [safe] })));
    const owners = await pub.readContract({ address: safe, abi: safeAbi, functionName: "getOwners" });
    report("7b", "DANGER confirmé : retirer le tiers N'ANNULE PAS la recovery qu'il a lancée (v0.0.1, correctif L-03 non déployé)",
      still.executeAfter > 0n && fin === "PAS DE REVERT" && owners[0] === attacker.address, `finalisation : ${fin === "PAS DE REVERT" ? "réussie" : fin} ; owners = ${owners}`);
    await test.revert({ id: snap });
  }

  // T9 : chemin « Swissquote a disparu » : backup + tiers sur l'instance 3 j, et délais réels.
  {
    const snap = await test.snapshot();
    const delayOf = async (m: Address, a: typeof owner, b: typeof owner, to: Address) => {
      const n = await read(m, "nonce", [safe]);
      const s1 = await guardianSig(a, m, safe, [to], 1n, n);
      const s2 = await guardianSig(b, m, safe, [to], 1n, n);
      await send(attacker, m, encodeFunctionData({ abi: srmAbi, functionName: "multiConfirmRecovery",
        args: [safe, [to], 1n, sortPairs([s1, s2].map(({ signer, signature }) => ({ signer, signature }))), true] }));
      return (await read(m, "getRecoveryRequest", [safe])).executeAfter - (await pub.getBlock()).timestamp;
    };
    const d3m = await delayOf(M3m, backup, swissquote, newOwner.address);
    await execSafe(safe, owner, M3m, encodeFunctionData({ abi: srmAbi, functionName: "cancelRecovery" }));
    const d3d = await delayOf(M3d, backup, tiers, newOwner.address);
    await warp(3 * 86400 - 60);
    const early = await expectRevert(send(attacker, M3d, encodeFunctionData({ abi: srmAbi, functionName: "finalizeRecovery", args: [safe] })));
    await warp(61);
    await send(attacker, M3d, encodeFunctionData({ abi: srmAbi, functionName: "finalizeRecovery", args: [safe] }));
    const owners = await pub.readContract({ address: safe, abi: safeAbi, functionName: "getOwners" });
    report("9", "Chemin sans Swissquote : backup + tiers récupèrent sur l'instance 3 j (aucune signature Swissquote)",
      owners[0] === newOwner.address && early.includes("still pending"),
      `délai mesuré 3 min = ${d3m} s, 3 j = ${d3d} s ; finalisation 1 min avant : ${early} ; owners après = ${owners}`);
    await test.revert({ id: snap });
  }

  // T8 : recovery vers une PASSKEY (propriétaire = contrat signataire WebAuthn de Safe).
  {
    // Clé publique P-256 générée par WebCrypto (bibliothèque standard). Ici on ne teste que l'adresse et
    // le changement de propriétaire ; la signature par une vraie passkey est testée à part, dans un navigateur.
    const kp = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign"]);
    const raw = new Uint8Array(await crypto.subtle.exportKey("raw", kp.publicKey));
    const x = BigInt("0x" + Buffer.from(raw.slice(1, 33)).toString("hex"));
    const y = BigInt("0x" + Buffer.from(raw.slice(33, 65)).toString("hex"));
    const sdkAddr = getAddress(SafeAccountV0_3_0.createWebAuthnSignerVerifierAddress(x, y));
    const verifiers = BigInt(SafeAccountV0_3_0.DEFAULT_WEB_AUTHN_CONTRACT_VERIFIER); // précompile = 0x0000 : vérificateur contrat seul
    const factory = getAddress(SafeAccountV0_3_0.DEFAULT_WEB_AUTHN_SIGNER_FACTORY);
    const onchainAddr = await pub.readContract({ address: factory, abi: webAuthnFactoryAbi, functionName: "getSigner", args: [x, y, verifiers] });
    const codeBefore = await pub.getCode({ address: sdkAddr });
    report("8a", "Adresse du signataire passkey calculée hors chaîne (SDK) = adresse donnée par la factory", sdkAddr === onchainAddr,
      `sdk=${sdkAddr} factory=${onchainAddr} ; déployé avant recovery : ${codeBefore ? "oui" : "non"}`);

    const n = await read(M3m, "nonce", [safe]);
    const c = await guardianSig(backup, M3m, safe, [sdkAddr], 1n, n);
    const d = await guardianSig(swissquote, M3m, safe, [sdkAddr], 1n, n);
    await send(attacker, M3m, encodeFunctionData({ abi: srmAbi, functionName: "multiConfirmRecovery",
      args: [safe, [sdkAddr], 1n, sortPairs([c, d].map(({ signer, signature }) => ({ signer, signature }))), true] }));
    await warp(181);
    await send(attacker, M3m, encodeFunctionData({ abi: srmAbi, functionName: "finalizeRecovery", args: [safe] }));
    const owners = await pub.readContract({ address: safe, abi: safeAbi, functionName: "getOwners" });
    report("8b", "Recovery finalisée vers le signataire passkey NON déployé : propriétaire du Safe remplacé",
      owners.length === 1 && owners[0] === sdkAddr, `owners = ${owners}`);
    await send(attacker, factory, encodeFunctionData({ abi: webAuthnFactoryAbi, functionName: "createSigner", args: [x, y, verifiers] }));
    const codeAfter = await pub.getCode({ address: sdkAddr });
    report("8c", "Déploiement du signataire passkey après coup, par n'importe qui (factory permissionless)", !!codeAfter && codeAfter.length > 2,
      `code à ${sdkAddr} : ${codeAfter ? (codeAfter.length - 2) / 2 : 0} octets`);
  }

  console.log("\nRÉSUMÉ");
  for (const r of results) console.log(`${r.id.padEnd(3)} ${r.verdict.padEnd(18)} ${r.label}`);
}

main().catch((e) => {
  console.error("ÉCHEC NON PRÉVU :", e);
  process.exit(1);
});
