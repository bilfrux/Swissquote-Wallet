// Verrou de la partie crypto : la session bancaire (identifiant + mot de passe) ne suffit plus pour y accéder.
// Il faut une assertion de passkey WebAuthn (vérification de l'utilisateur exigée : biométrie de l'appareil), vérifiée
// ici par @simplewebauthn/server (passkeys.ts), pas seulement par l'interface. Aucune crypto maison.
// Deux niveaux, attachés au jeton de session :
//  - "full"     : passkey vérifiée → toutes les routes crypto (retrait du compte crypto, preuve de propriété…) ;
//  - "recovery" : re-KYC réussi (appareil ou passkey perdus) → seulement les routes dont une recovery a besoin.
// Le verrou expire après une durée d'inactivité ; chaque requête crypto autorisée la repousse.
// Limite : bank-mock est le serveur de Swissquote. Ce verrou protège contre un détenteur de la session (mot de passe volé,
// session détournée) ; il ne peut pas empêcher Swissquote d'agir sur ses propres données. Pour les fonds en self-custody,
// la protection est la biométrie du Client Wallet et la politique on-chain.
import { db } from "./db.ts";

export type Scope = "full" | "recovery";
export const LOCK_ENABLED = process.env.BANK_MOCK_CRYPTO_LOCK !== "off"; // "off" : tests automatisés des étapes < 38 uniquement
const IDLE_MS = Number(process.env.BANK_MOCK_CRYPTO_IDLE_MS ?? 10 * 60 * 1000);

db.exec("create table if not exists crypto_unlocks (token text primary key, customer_id text not null, scope text not null, expires_at integer not null)");

export const tokenOf = (authorization: unknown): string | null =>
  typeof authorization === "string" && /^Bearer \S+$/.test(authorization) ? authorization.slice(7) : null;

export function grantUnlock(authorization: unknown, customerId: string, scope: Scope) {
  const token = tokenOf(authorization);
  if (!token) return;
  db.prepare("insert or replace into crypto_unlocks (token, customer_id, scope, expires_at) values (?, ?, ?, ?)").run(token, customerId, scope, Date.now() + IDLE_MS);
}
export const revokeUnlock = (authorization: unknown) => {
  const token = tokenOf(authorization);
  if (token) db.prepare("delete from crypto_unlocks where token = ?").run(token);
};

// Niveau actuel de la session (sans repousser l'expiration).
export function unlockState(authorization: unknown, customerId: string): { scope: Scope | null; expiresAt: number | null } {
  const token = tokenOf(authorization);
  const row = token ? (db.prepare("select scope, expires_at from crypto_unlocks where token = ? and customer_id = ?").get(token, customerId) as any) : undefined;
  return row && row.expires_at > Date.now() ? { scope: row.scope, expiresAt: row.expires_at } : { scope: null, expiresAt: null };
}

// Vrai si la session a au moins le niveau demandé ; repousse alors l'expiration.
export function allows(authorization: unknown, customerId: string, need: Scope): boolean {
  if (!LOCK_ENABLED) return true;
  const { scope } = unlockState(authorization, customerId);
  if (!scope || (need === "full" && scope !== "full")) return false;
  grantUnlock(authorization, customerId, scope);
  return true;
}
