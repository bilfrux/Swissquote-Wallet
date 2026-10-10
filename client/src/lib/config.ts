// Configuration du compte : uniquement des clés PUBLIQUES (aucune clé privée n'entre jamais dans l'appli).
import type { NetworkName } from "@sq/bitcoin";

export const NETWORK = (import.meta.env.VITE_BTC_NETWORK ?? "signet") as NetworkName;
export const DELAY = Number(import.meta.env.VITE_RECOVERY_DELAY ?? 6);
export const ESPLORA_URL = import.meta.env.VITE_ESPLORA_URL ?? "https://blockstream.info/signet/api";
export const EXPLORER_URL = import.meta.env.VITE_EXPLORER_URL ?? "https://blockstream.info/signet";

export type AccountInput = { client: string; swissquote: string; tiers: string };
const KEY = `sq-wallet:btc-account:${NETWORK}`;
export const loadAccountInput = (): AccountInput | null => JSON.parse(localStorage.getItem(KEY) ?? "null");
export const saveAccountInput = (a: AccountInput) => localStorage.setItem(KEY, JSON.stringify(a));
export const clearAccountInput = () => localStorage.removeItem(KEY);
