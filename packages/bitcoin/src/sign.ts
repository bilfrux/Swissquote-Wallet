// Signature d'un PSBT par une graine importée à l'exécution. Utilisé par tools/client-signer,
// la console guardian et bank-mock. JAMAIS importé par client/.
import { btc, signers } from "@bitcoinerlab/descriptors-scure";
import { base64 } from "@scure/base";
import type { NetworkName } from "./policy.ts";
import { masterFromMnemonic } from "./keys.ts";

// Signe toutes les entrées dont une clé dérive de cette graine (chemins BIP32 du PSBT). Renvoie le PSBT signé
// et le nombre de signatures ajoutées.
export function signPsbtWithMnemonic(psbt: string, mnemonic: string, network: NetworkName) {
  const tx = btc.Transaction.fromPSBT(base64.decode(psbt.trim()));
  const count = (t: typeof tx) => Array.from({ length: t.inputsLength }, (_, i) => t.getInput(i).partialSig?.length ?? 0).reduce((a, b) => a + b, 0);
  const before = count(tx);
  signers.signBIP32({ psbt: tx, masterNode: masterFromMnemonic(mnemonic, network) });
  return { psbt: base64.encode(tx.toPSBT()), added: count(tx) - before };
}
