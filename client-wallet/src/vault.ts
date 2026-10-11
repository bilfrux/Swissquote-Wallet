// Chiffrement de la graine au repos, via node:crypto (OpenSSL), AES-256-GCM. Deux formats :
//  - biométrie, seul format des nouveaux wallets (étape 36) : secret de 32 octets rendu par la passkey du wallet
//    (extension WebAuthn « prf », hmac-secret de l'authentificateur), seulement après vérification de l'utilisateur
//    (Touch ID, Face ID…) ; clé dérivée par HKDF ;
//  - code PIN, clé dérivée par scrypt : ancien format, conservé seulement pour migrer vers la biométrie.
// Aucune cryptographie écrite ici. La graine déchiffrée ne vit qu'en mémoire, le temps d'une signature.
import { createCipheriv, createDecipheriv, hkdfSync, randomBytes, scryptSync } from "node:crypto";

type Box = { iv: string; ct: string; tag: string };
export type Sealed = { kdf: "scrypt"; N: number; r: number; p: number; salt: string } & Box;
// `credentialId` et `prfSalt` sont publics : sans l'authentificateur (et la biométrie), ils ne donnent aucun secret.
export type SealedBio = { kdf: "hkdf-sha256-prf"; credentialId: string; prfSalt: string } & Box;
const PARAMS = { N: 1 << 15, r: 8, p: 1 };
const key = (pin: string, salt: Buffer, s: { N: number; r: number; p: number }) =>
  scryptSync(pin.normalize("NFKC"), salt, 32, { ...s, maxmem: 128 * s.N * s.r * 2 });
const bioKey = (prf: string, prfSalt: string) =>
  Buffer.from(hkdfSync("sha256", Buffer.from(prf, "base64url"), Buffer.from(prfSalt, "base64url"), "sq-client-wallet seed v1", 32));

export const validPin = (pin: unknown): pin is string => typeof pin === "string" && /^\d{6,12}$/.test(pin);
// Sortie PRF : 32 octets en base64url (43 caractères).
export const validPrf = (prf: unknown): prf is string => typeof prf === "string" && /^[A-Za-z0-9_-]{43}$/.test(prf);
export const validBio = (b: any): b is { credentialId: string; prfSalt: string; prf: string } =>
  !!b && typeof b.credentialId === "string" && /^[A-Za-z0-9_-]{16,1400}$/.test(b.credentialId) && validPrf(b.prfSalt) && validPrf(b.prf);

function lock(k: Buffer, text: string): Box {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", k, iv);
  const ct = Buffer.concat([c.update(text, "utf8"), c.final()]);
  return { iv: iv.toString("hex"), ct: ct.toString("hex"), tag: c.getAuthTag().toString("hex") };
}
// Lève une erreur si la clé est fausse (l'authentification GCM échoue).
function unlockBox(k: Buffer, b: Box): string {
  const d = createDecipheriv("aes-256-gcm", k, Buffer.from(b.iv, "hex"));
  d.setAuthTag(Buffer.from(b.tag, "hex"));
  return Buffer.concat([d.update(Buffer.from(b.ct, "hex")), d.final()]).toString("utf8");
}

export function seal(mnemonic: string, pin: string): Sealed {
  const salt = randomBytes(16);
  return { kdf: "scrypt", ...PARAMS, salt: salt.toString("hex"), ...lock(key(pin, salt, PARAMS), mnemonic) };
}
export const open = (s: Sealed, pin: string): string => unlockBox(key(pin, Buffer.from(s.salt, "hex"), s), s);

export function sealBio(mnemonic: string, b: { credentialId: string; prfSalt: string; prf: string }): SealedBio {
  return { kdf: "hkdf-sha256-prf", credentialId: b.credentialId, prfSalt: b.prfSalt, ...lock(bioKey(b.prf, b.prfSalt), mnemonic) };
}
export const openBio = (s: SealedBio, prf: string): string => unlockBox(bioKey(prf, s.prfSalt), s);
