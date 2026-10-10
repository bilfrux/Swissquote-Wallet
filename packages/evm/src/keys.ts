// Clé EVM dérivée d'une phrase BIP39 (chemin standard m/44'/60'/0'/0/0), par viem (@scure/bip32 et bip39).
// Utilisé par le Wallet du client, bank-mock et la console du tiers, JAMAIS par client/.
import { bytesToHex, type Hex } from "viem";
import { mnemonicToAccount } from "viem/accounts";

export function evmAccountFromMnemonic(mnemonic: string) {
  const account = mnemonicToAccount(mnemonic.trim().split(/\s+/).join(" "));
  const privateKey = bytesToHex(account.getHdKey().privateKey!) as Hex;
  return { account, privateKey };
}
export const evmAddressFromMnemonic = (mnemonic: string) => evmAccountFromMnemonic(mnemonic).account.address;
