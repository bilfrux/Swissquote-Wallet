// Génération et dérivation de clés (BIP39 / BIP32) par bibliothèques établies.
// Utilisé par les outils (keygen, client-signer) et par bank-mock, JAMAIS par client/.
import { generateMnemonic, mnemonicToSeedSync, validateMnemonic } from "@scure/bip39";
import { wordlist } from "@scure/bip39/wordlists/english.js";
import { HDKey } from "@bitcoinerlab/descriptors-scure";
import { ACCOUNT_PATH, type NetworkName, btcNetwork } from "./policy.ts";

export const newMnemonic = () => generateMnemonic(wordlist, 256);

export function masterFromMnemonic(mnemonic: string, network: NetworkName): HDKey {
  const m = mnemonic.trim().split(/\s+/).join(" ");
  if (!validateMnemonic(m, wordlist)) throw new Error("invalid BIP39 phrase");
  return HDKey.fromMasterSeed(mnemonicToSeedSync(m), btcNetwork(network).bip32);
}

const fp = (master: HDKey) => master.fingerprint.toString(16).padStart(8, "0");
const origin = (master: HDKey) => `[${fp(master)}${ACCOUNT_PATH.slice(1)}]`;

// Clé publique de compte avec origine, à transmettre à l'appli : [empreinte/48'/1'/0'/2']tpub…
export const accountKey = (master: HDKey) => origin(master) + master.derive(ACCOUNT_PATH).publicExtendedKey;
// Clé privée de compte avec origine : uniquement pour l'importer dans un signataire externe (Bitcoin Core).
export const accountPrivateKey = (master: HDKey) => origin(master) + master.derive(ACCOUNT_PATH).privateExtendedKey;
