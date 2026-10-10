// Politique de recovery et descripteurs. Compilation par le compilateur Miniscript de référence (sipa),
// via @bitcoinerlab/miniscript-policies. Aucune clé privée ici : uniquement des clés publiques étendues.
import { compilePolicy, ready } from "@bitcoinerlab/miniscript-policies";
import { HDKey, networks } from "@bitcoinerlab/descriptors-scure";

export type NetworkName = "regtest" | "signet";
export const btcNetwork = (n: NetworkName) => (n === "regtest" ? networks.regtest : networks.testnet); // signet = préfixes testnet

// Origine BIP48 (P2WSH multi-clés) sur les testnets.
export const ACCOUNT_PATH = "m/48'/1'/0'/2'";

// `and()` n'accepte que deux arguments dans le langage de politique : forme imbriquée.
export const policyString = (delay: number) => `or(pk(@C),and(pk(@S),and(pk(@T),older(${delay}))))`;

export async function compileRecoveryPolicy(delay: number) {
  if (!Number.isInteger(delay) || delay < 1 || delay > 0xffff) throw new Error(`délai invalide : ${delay} (1 à 65535 blocs)`);
  await ready;
  const policy = policyString(delay);
  const { miniscript, issane } = compilePolicy(policy);
  if (!issane) throw new Error(`politique non compilable : ${policy} -> ${miniscript}`);
  return { policy, miniscript };
}

// Clé de compte avec origine : [empreinte/48'/1'/0'/2']tpub...
const ACCOUNT_KEY_RE = /^\[([0-9a-f]{8})((?:\/\d+['h]?)+)\]([tv]pub[1-9A-HJ-NP-Za-km-z]{100,112})$/;
export type AccountKey = { fingerprint: string; originPath: string; xpub: string; raw: string };

export function parseAccountKey(raw: string, network: NetworkName): AccountKey {
  const m = raw.trim().match(ACCOUNT_KEY_RE);
  if (!m) throw new Error("clé attendue au format [empreinte/48'/1'/0'/2']tpub…");
  HDKey.fromExtendedKey(m[3], btcNetwork(network).bip32); // vérifie le xpub (somme de contrôle, version)
  return { fingerprint: m[1], originPath: "m" + m[2].replace(/h/g, "'"), xpub: m[3], raw: raw.trim() };
}

export type WalletConfig = {
  network: NetworkName;
  delay: number;
  miniscript: string;
  client: AccountKey;
  swissquote: AccountKey;
  tiers: AccountKey;
};

export async function createWalletConfig(p: { network: NetworkName; delay: number; client: string; swissquote: string; tiers: string }): Promise<WalletConfig> {
  const { miniscript } = await compileRecoveryPolicy(p.delay);
  const keys = { client: parseAccountKey(p.client, p.network), swissquote: parseAccountKey(p.swissquote, p.network), tiers: parseAccountKey(p.tiers, p.network) };
  const xs = [keys.client.xpub, keys.swissquote.xpub, keys.tiers.xpub];
  if (new Set(xs).size !== 3) throw new Error("les trois clés doivent être distinctes");
  return { network: p.network, delay: p.delay, miniscript, ...keys };
}

// change = 0 : réception, 1 : change. Descripteur à plage (/*) pour les trois clés.
export function descriptor(cfg: WalletConfig, change: 0 | 1): string {
  const k = (a: AccountKey) => `${a.raw}/${change}/*`;
  const map: Record<string, string> = { "@C": k(cfg.client), "@S": k(cfg.swissquote), "@T": k(cfg.tiers) };
  return `wsh(${cfg.miniscript.replace(/@[CST]\b/g, (m) => map[m])})`;
}

export function pubkeyAt(a: AccountKey, network: NetworkName, change: number, index: number): Uint8Array {
  return HDKey.fromExtendedKey(a.xpub, btcNetwork(network).bip32).deriveChild(change).deriveChild(index).publicKey!;
}
