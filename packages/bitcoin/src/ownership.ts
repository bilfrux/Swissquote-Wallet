// Preuve de propriété : adresse P2WPKH de la clé CLIENT à un index (clé publique seulement).
// Le défi est signé (BIP-322 « simple ») pour cette adresse, car bip322-js ne gère pas P2WSH :
// la preuve porte sur la clé client, pas sur l'adresse P2WSH du compte elle-même.
import { btc } from "@bitcoinerlab/descriptors-scure";
import { type NetworkName, type WalletConfig, btcNetwork, pubkeyAt } from "./policy.ts";

export const keyAddressOf = (pubkey: Uint8Array, network: NetworkName) => btc.p2wpkh(pubkey, btcNetwork(network)).address!;
export const clientKeyAddress = (cfg: WalletConfig, change: number, index: number) => keyAddressOf(pubkeyAt(cfg.client, cfg.network, change, index), cfg.network);
