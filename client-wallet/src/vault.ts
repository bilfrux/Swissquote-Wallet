// Chiffrement de la graine au repos par un code PIN : scrypt (dérivation de clé) + AES-256-GCM, via node:crypto (OpenSSL).
// Aucune cryptographie écrite ici. La graine déchiffrée ne vit qu'en mémoire, le temps d'une signature.
import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "node:crypto";

export type Sealed = { kdf: "scrypt"; N: number; r: number; p: number; salt: string; iv: string; ct: string; tag: string };
const PARAMS = { N: 1 << 15, r: 8, p: 1 };
const key = (pin: string, salt: Buffer, s: { N: number; r: number; p: number }) =>
  scryptSync(pin.normalize("NFKC"), salt, 32, { ...s, maxmem: 128 * s.N * s.r * 2 });

export const validPin = (pin: unknown): pin is string => typeof pin === "string" && /^\d{6,12}$/.test(pin);

export function seal(mnemonic: string, pin: string): Sealed {
  const salt = randomBytes(16), iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", key(pin, salt, PARAMS), iv);
  const ct = Buffer.concat([c.update(mnemonic, "utf8"), c.final()]);
  return { kdf: "scrypt", ...PARAMS, salt: salt.toString("hex"), iv: iv.toString("hex"), ct: ct.toString("hex"), tag: c.getAuthTag().toString("hex") };
}

// Lève une erreur si le PIN est faux (l'authentification GCM échoue).
export function open(s: Sealed, pin: string): string {
  const d = createDecipheriv("aes-256-gcm", key(pin, Buffer.from(s.salt, "hex"), s), Buffer.from(s.iv, "hex"));
  d.setAuthTag(Buffer.from(s.tag, "hex"));
  return Buffer.concat([d.update(Buffer.from(s.ct, "hex")), d.final()]).toString("utf8");
}
