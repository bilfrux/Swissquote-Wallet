// Attaques et invariants exécutés contre un vrai nœud (regtest). Utilisés à la fois par `npm run test:attacks`
// et par le panneau « Attaques » de l'appli (via scripts/attacks/server.ts).
// Chaque scénario crée un compte de DÉMO avec des graines jetables : les rôles « Swissquote » et « tiers » complices
// utilisent leurs propres clés de démo et contournent volontairement bank-mock (ce que ferait un guardian malveillant).
// Aucune cryptographie écrite ici : signatures par @scure/btc-signer, @bitcoinerlab/descriptors et @noble/curves.
import { btc, secp256k1 } from "@bitcoinerlab/descriptors-scure";
import { base64 } from "@scure/base";
import { type WalletConfig, buildSpend, combinePsbts, createWalletConfig, finalizePsbt, outputAt, pubkeyAt, scan } from "@sq/bitcoin";
import { accountKey, masterFromMnemonic, newMnemonic } from "@sq/bitcoin/keys";
import { signPsbtWithMnemonic } from "@sq/bitcoin/sign";
import { clientSign, miner, nodeVerdict, rpc, startBankMock } from "../validate/lib.ts";

export const D = 6;
export type AttackResult = {
  id: string;
  title: string;
  expected: "refus" | "succès";
  outcome: "refus" | "succès";
  ok: boolean; // le résultat observé est celui attendu
  chainMessage: string; // message réel du nœud Bitcoin (ou de bank-mock)
  steps: string[];
};

async function demoAccount() {
  const seeds = { client: newMnemonic(), swissquote: newMnemonic(), tiers: newMnemonic() };
  const key = (m: string) => accountKey(masterFromMnemonic(m, "regtest"));
  const cfg = await createWalletConfig({ network: "regtest", delay: D, client: key(seeds.client), swissquote: key(seeds.swissquote), tiers: key(seeds.tiers) });
  const m = await miner();
  await m.pay(outputAt(cfg, 0, 0).getAddress(), 0.1);
  await m.mine(1);
  return { cfg, seeds, ...m };
}

// Témoin P2WSH posé à la main (éléments de pile + witnessScript du compte) : sert à montrer le verdict du consensus
// sur une transaction que la bibliothèque refuse de finaliser.
function withWitness(cfg: WalletConfig, psbt: string, stack: Uint8Array[]): string {
  const tx = btc.Transaction.fromPSBT(base64.decode(psbt));
  const ws = outputAt(cfg, 0, 0).getWitnessScript()!;
  for (let i = 0; i < tx.inputsLength; i++) tx.updateInput(i, { finalScriptWitness: [...stack, ws] }, true);
  return tx.hex;
}
const sigOf = (psbt: string, pubkey: Uint8Array) => {
  const tx = btc.Transaction.fromPSBT(base64.decode(psbt));
  const hexKey = Buffer.from(pubkey).toString("hex");
  return (tx.getInput(0).partialSig ?? []).find(([k]: any) => Buffer.from(k).toString("hex") === hexKey)?.[1];
};
// clé publique /0/0 du rôle, telle qu'elle figure dans le script de l'adresse 0
const pubAt = (cfg: WalletConfig, who: "client" | "swissquote" | "tiers") => pubkeyAt(cfg[who], "regtest", 0, 0);

// ---------------------------------------------------------------------------------------------
// Invariant 1 : Swissquote seule ne peut dépenser par aucun chemin, même après D.
export async function invariant1(): Promise<AttackResult> {
  const { cfg, seeds, addr: attacker, mine } = await demoAccount();
  await mine(D + 4); // délai largement écoulé
  const utxos = await scan(cfg, rpc);
  const steps: string[] = [`compte de démo financé, ${utxos[0].confirmations} confirmations (D = ${D})`];
  // (a) chemin recovery signé par Swissquote seule
  const rec = (await buildSpend({ cfg, backend: rpc, utxos, path: "recovery", feeRate: 2, to: attacker })).psbt;
  const sqRec = signPsbtWithMnemonic(rec, seeds.swissquote, "regtest").psbt;
  let lib = "";
  try { finalizePsbt(cfg, sqRec); lib = "finalisée (!)"; } catch (e: any) { lib = String(e.message).split("\n")[0].slice(0, 90); }
  steps.push(`bibliothèque : finalisation impossible avec la seule signature Swissquote (${lib})`);
  const sigS = sigOf(sqRec, pubAt(cfg, "swissquote"))!;
  const vRec = await nodeVerdict(withWitness(cfg, sqRec, [new Uint8Array(), sigS]));
  steps.push(`témoin [∅ à la place du tiers, signature Swissquote] sur le chemin recovery : ${vRec}`);
  // (b) signature Swissquote présentée dans la branche « client »
  const cli = (await buildSpend({ cfg, backend: rpc, utxos, path: "client", feeRate: 2, to: attacker })).psbt;
  const sqCli = signPsbtWithMnemonic(cli, seeds.swissquote, "regtest").psbt;
  const vCli = await nodeVerdict(withWitness(cfg, sqCli, [sigOf(sqCli, pubAt(cfg, "swissquote"))!, new Uint8Array()]));
  steps.push(`témoin [signature Swissquote à la place du client, ∅] sur le chemin client : ${vCli}`);
  const refused = vRec !== "accepté" && vCli !== "accepté";
  return { id: "invariant-1", title: "Swissquote seule tente de dépenser (après D, par les deux chemins)", expected: "refus", outcome: refused ? "refus" : "succès", ok: refused, chainMessage: `${vRec} | ${vCli}`, steps };
}

// ---------------------------------------------------------------------------------------------
// Attaque 1 : l'attaquant a volé le téléphone et l'email, mais n'a ni la clé du client ni celles des guardians.
export async function attackNoGuardianKeys(): Promise<AttackResult> {
  const { cfg, addr: attacker, mine } = await demoAccount();
  await mine(D + 4);
  const steps: string[] = ["l'appli du téléphone volé ne contient aucune clé privée (clés publiques seulement)"];
  // Couche 1 : re-KYC Swissquote (mocké). L'attaquant connaît l'identifiant client et l'email, pas le dossier d'identité.
  const bank = await startBankMock(4103, ".local/bm-attack-1");
  const kyc = await bank.api("/identity/verify", { customerId: "CH-0001", lastName: "Muster", birthDate: "1970-01-01", otp: "000000" });
  bank.stop();
  steps.push(`re-KYC Swissquote (mocké) : ${kyc.status} ${kyc.json.error ?? "accepté (!)"}`);
  // Couche 2 (la vraie défense) : sans les clés, l'attaquant signe avec SES clés à la place de Swissquote et du tiers.
  const utxos = await scan(cfg, rpc);
  const psbt = (await buildSpend({ cfg, backend: rpc, utxos, path: "recovery", feeRate: 2, to: attacker })).psbt;
  const tx = btc.Transaction.fromPSBT(base64.decode(psbt));
  const inp = tx.getInput(0);
  const sighash = tx.preimageWitnessV0(0, outputAt(cfg, 0, 0).getWitnessScript()!, btc.SigHash.ALL, inp.witnessUtxo!.amount);
  const forge = () => {
    const sk = secp256k1.utils.randomSecretKey();
    const der = secp256k1.sign(sighash, sk, { prehash: false, format: "der" });
    return new Uint8Array([...der, btc.SigHash.ALL]);
  };
  const v = await nodeVerdict(withWitness(cfg, psbt, [forge(), forge()]));
  steps.push(`après D, témoin avec deux signatures de l'attaquant à la place de Swissquote et du tiers : ${v}`);
  const refused = kyc.status === 403 && v !== "accepté";
  return { id: "attaque-1", title: "Attaquant avec téléphone et email, sans les clés des guardians", expected: "refus", outcome: refused ? "refus" : "succès", ok: refused, chainMessage: v, steps };
}

// ---------------------------------------------------------------------------------------------
// Attaque 2 : Swissquote et le tiers, complices, signent ensemble une dépense vers l'attaquant AVANT D.
export async function attackCollusionBeforeD(): Promise<AttackResult> {
  const { cfg, seeds, addr: attacker, mine } = await demoAccount();
  const utxos = await scan(cfg, rpc);
  const psbt = (await buildSpend({ cfg, backend: rpc, utxos, path: "recovery", feeRate: 2, to: attacker })).psbt;
  const both = combinePsbts([signPsbtWithMnemonic(psbt, seeds.swissquote, "regtest").psbt, signPsbtWithMnemonic(psbt, seeds.tiers, "regtest").psbt]);
  const { hex } = finalizePsbt(cfg, both);
  const steps = [`Swissquote et tiers complices signent tous les deux (bank-mock contourné) une dépense vers l'attaquant`];
  const v1 = await nodeVerdict(hex);
  steps.push(`à ${utxos[0].confirmations} confirmation : ${v1}`);
  await mine(D - 2);
  const v5 = await nodeVerdict(hex);
  steps.push(`à ${D - 1} confirmations : ${v5}`);
  await mine(1);
  const v6 = await nodeVerdict(hex);
  steps.push(`(zone grise assumée, non diffusée) à ${D} confirmations sans rafraîchissement du client : ${v6}`);
  const refused = v1 === "non-BIP68-final" && v5 === "non-BIP68-final";
  return { id: "attaque-2", title: "Collusion Swissquote + tiers avant D", expected: "refus", outcome: refused ? "refus" : "succès", ok: refused, chainMessage: v1, steps };
}

// ---------------------------------------------------------------------------------------------
// Attaque 3 : Swissquote disparaît (processus arrêté). Le client dépense seul.
export async function attackSwissquoteDown(): Promise<AttackResult> {
  const { cfg, seeds, addr: dest, mine } = await demoAccount();
  const bank = await startBankMock(4104, ".local/bm-attack-3");
  const reg = await bank.api("/accounts/register", { customerId: "CH-0001", network: "regtest", delay: D, client: cfg.client.raw, tiers: cfg.tiers.raw });
  bank.stop();
  await new Promise((r) => setTimeout(r, 800));
  let reach = "";
  try { await fetch(`${bank.url}/health`); reach = "joignable (!)"; } catch (e: any) { reach = `injoignable (${e.cause?.code ?? e.message})`; }
  const steps = [`compte enregistré chez Swissquote (${reg.status}), puis bank-mock arrêté : ${reach}`];
  const psbt = (await buildSpend({ cfg, backend: rpc, utxos: await scan(cfg, rpc), path: "client", feeRate: 2, to: dest, amount: 2_000_000n })).psbt;
  const { hex } = clientSign(cfg, psbt, seeds.client, ".local/attack-3");
  let msg = "";
  try { msg = `diffusée ${await rpc.broadcast(hex)}`; await mine(1); } catch (e: any) { msg = `refusée : ${e.message}`; }
  steps.push(`le client signe avec son wallet externe (tools/client-signer) et diffuse : ${msg}`);
  const ok = reach.startsWith("injoignable") && msg.startsWith("diffusée");
  return { id: "attaque-3", title: "Swissquote arrêtée : le client dépense seul", expected: "succès", outcome: msg.startsWith("diffusée") ? "succès" : "refus", ok, chainMessage: msg, steps };
}

export const ATTACKS: Record<string, () => Promise<AttackResult>> = {
  "attaque-1": attackNoGuardianKeys,
  "attaque-2": attackCollusionBeforeD,
  "attaque-3": attackSwissquoteDown,
  "invariant-1": invariant1,
};
