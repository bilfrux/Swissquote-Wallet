// Stockage propre du Wallet du client (fichier en mode 600 dans client-wallet/data/, ignoré par git).
// Représente le stockage sécurisé d'un wallet matériel ou d'une appli téléphone. Jamais lu par l'appli de la banque.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export const DATA_DIR = process.env.CLIENT_WALLET_DATA ?? new URL("../data/", import.meta.url).pathname;
mkdirSync(DATA_DIR, { recursive: true });
const FILE = join(DATA_DIR, "wallets.json");

export type Policy = { network: "regtest" | "signet"; delay: number; swissquote: string; tiers: string; tiersName?: string };
export type StoredWallet = { id: string; label: string; mnemonic: string; accountKey: string; createdAt: string; policy?: Policy };

export const load = (): StoredWallet[] => (existsSync(FILE) ? JSON.parse(readFileSync(FILE, "utf8")) : []);
export const save = (w: StoredWallet[]) => writeFileSync(FILE, JSON.stringify(w, null, 2) + "\n", { mode: 0o600 });

// Vue publique d'un wallet : tout sauf la phrase.
export const publicView = ({ mnemonic: _m, ...rest }: StoredWallet) => rest;
