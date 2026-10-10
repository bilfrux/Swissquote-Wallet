import { BitcoindBackend, EsploraBackend, type ChainBackend } from "@sq/bitcoin";
import { ESPLORA_URL, EXPLORER_URL, NETWORK } from "./config";

// signet : API Esplora publique ; regtest : bitcoind local via le proxy du serveur de dev.
export const chain: ChainBackend = NETWORK === "regtest" ? new BitcoindBackend("/regtest-rpc/") : new EsploraBackend(ESPLORA_URL);
export const txLink = (txid: string) => (NETWORK === "signet" ? `${EXPLORER_URL}/tx/${txid}` : null);
export const addrLink = (a: string) => (NETWORK === "signet" ? `${EXPLORER_URL}/address/${a}` : null);
