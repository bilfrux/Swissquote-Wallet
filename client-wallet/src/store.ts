// Stockage propre du Wallet du client (fichier en mode 600 dans client-wallet/data/, ignoré par git).
// Représente le stockage sécurisé d'un wallet matériel ou d'une appli téléphone. Jamais lu par l'appli de la banque.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Sealed } from "./vault.ts";

export const DATA_DIR = process.env.CLIENT_WALLET_DATA ?? new URL("../data/", import.meta.url).pathname;
mkdirSync(DATA_DIR, { recursive: true });
const FILE = join(DATA_DIR, "wallets.json");

export type Policy = { network: "regtest" | "signet"; delay: number; swissquote: string; tiers: string; tiersName?: string };
// `evmAddress` : adresse Ethereum dérivée de la même phrase (m/44'/60'/0'/0/0), donnée publique.
// `sealed` : graine chiffrée par le code PIN. `mnemonic` en clair : ancien format, avant l'étape 8 (« non protégé »).
export type StoredWallet = { id: string; label: string; mnemonic?: string; sealed?: Sealed; accountKey: string; createdAt: string; policy?: Policy; evmAddress?: string };

export const load = (): StoredWallet[] => (existsSync(FILE) ? JSON.parse(readFileSync(FILE, "utf8")) : []);
export const save = (w: StoredWallet[]) => writeFileSync(FILE, JSON.stringify(w, null, 2) + "\n", { mode: 0o600 });

// Vue publique d'un wallet : ni la phrase, ni sa version chiffrée.
export const publicView = ({ mnemonic, sealed, ...rest }: StoredWallet) => ({ ...rest, protected: !!sealed && !mnemonic });
