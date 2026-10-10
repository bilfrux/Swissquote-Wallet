// Clé du guardian Swissquote. Générée au premier lancement, stockée UNIQUEMENT dans bank-mock/data (mode 600).
// Seule la clé publique de compte sort de ce module.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { NetworkName } from "@sq/bitcoin";
import { accountKey, masterFromMnemonic, newMnemonic } from "@sq/bitcoin/keys";
import { signPsbtWithMnemonic } from "@sq/bitcoin/sign";
import { DATA_DIR } from "./db.ts";

const SEED_FILE = join(DATA_DIR, "swissquote-seed.json");

function loadSeed(): string {
  if (!existsSync(SEED_FILE)) {
    const mnemonic = newMnemonic();
    writeFileSync(SEED_FILE, JSON.stringify({ mnemonic }, null, 2) + "\n", { mode: 0o600 });
    console.log(`[bank-mock] clé du guardian Swissquote générée dans ${SEED_FILE}`);
  }
  return JSON.parse(readFileSync(SEED_FILE, "utf8")).mnemonic;
}
const MNEMONIC = loadSeed();

// Les testnets (regtest, signet) partagent les versions BIP32 : une même clé de compte pour les deux.
export const swissquoteAccountKey = (network: NetworkName) => accountKey(masterFromMnemonic(MNEMONIC, network));
export const signAsSwissquote = (psbt: string, network: NetworkName) => signPsbtWithMnemonic(psbt, MNEMONIC, network);
