// Preuve de propriété d'une adresse du compte : défi Swissquote -> signature dans le Wallet du client (après confirmation)
// -> vérification par Swissquote. Utilisée par le panneau Recevoir et, automatiquement, avant un retrait (Travel Rule).
import type { WalletConfig } from "@sq/bitcoin";
import { ownershipChallenge, ownershipVerify } from "./bank";
import { walletRequest } from "./walletBridge";

export async function proveOwnership(cfg: WalletConfig, index: number) {
  const ch = await ownershipChallenge(cfg.client.raw, 0, index);
  const sig = await walletRequest<{ signature: string }>("prove", { accountKey: cfg.client.raw, change: 0, index, message: ch.message });
  return ownershipVerify(ch.challengeId, sig.signature);
}
