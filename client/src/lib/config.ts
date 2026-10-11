// Configuration de l'appli. Le compte Bitcoin n'est décrit que par des clés PUBLIQUES :
// aucune clé privée n'entre jamais dans l'appli de la banque.
import type { NetworkName } from "@sq/bitcoin";

export const NETWORK = (import.meta.env.VITE_BTC_NETWORK ?? "signet") as NetworkName;
export const DELAY = Number(import.meta.env.VITE_RECOVERY_DELAY ?? 6);
export const ESPLORA_URL = import.meta.env.VITE_ESPLORA_URL ?? "https://blockstream.info/signet/api";
export const EXPLORER_URL = import.meta.env.VITE_EXPLORER_URL ?? "https://blockstream.info/signet";
// Cours indicatif SIMULÉ, pour l'affichage en CHF uniquement.
export const BTC_CHF = Number(import.meta.env.VITE_BTC_CHF ?? 85000);
export const USDC_CHF = Number(import.meta.env.VITE_USDC_CHF ?? 0.8);

// Compte Bitcoin actif (données publiques), mis en cache localement : l'appli peut dépenser même si Swissquote est arrêtée.
export type BtcAccount = { id?: number; client: string; swissquote: string; tiers: string; tiersName?: string | null; delay: number; walletId?: string };
const key = (customerId: string) => `sq-wallet:btc:${NETWORK}:${customerId}`;
export const loadActiveAccount = (customerId: string): BtcAccount | null => JSON.parse(localStorage.getItem(key(customerId)) ?? "null");
export const saveActiveAccount = (customerId: string, a: BtcAccount) => localStorage.setItem(key(customerId), JSON.stringify(a));
