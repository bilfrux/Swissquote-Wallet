// Re-KYC MOCKÉ : un seul dossier de test par client est accepté. Ce contrôle n'est qu'une couche en plus :
// la défense réelle est on-chain (deux guardians + délai D appliqués par le consensus).
import { randomBytes } from "node:crypto";
import { db } from "./db.ts";

// Dossiers de test (mock) : identifiant client de la banque simulée et réponses attendues.
export const TEST_CUSTOMERS: Record<string, { lastName: string; birthDate: string; otp: string }> = {
  "CH-0001": { lastName: "Muster", birthDate: "1990-01-01", otp: "123456" },
  "CH-0002": { lastName: "Exemple", birthDate: "1985-06-15", otp: "654321" },
  "CH-0003": { lastName: "Martin", birthDate: "1992-03-21", otp: "246810" },
  "CH-0004": { lastName: "Keller", birthDate: "1994-07-12", otp: "135790" },
  "CH-0005": { lastName: "Berger", birthDate: "1991-11-02", otp: "975310" },
  "CH-0006": { lastName: "Rossi", birthDate: "1993-04-18", otp: "864209" },
};
const TTL_MS = 10 * 60 * 1000;

// Échecs de re-KYC par client (en mémoire) : le code SMS a 6 chiffres, sans limite il se devine. Au-delà de MAX_FAILS
// échecs, le dossier est bloqué LOCK_MS. (Mock : un vrai re-KYC serait un prestataire d'identité.)
const MAX_FAILS = Number(process.env.BANK_MOCK_KYC_MAX_FAILS ?? 5);
const LOCK_MS = 15 * 60 * 1000;
const fails = new Map<string, { n: number; until: number }>();
export const kycLockedFor = (customerId: unknown) => {
  const f = typeof customerId === "string" ? fails.get(customerId) : undefined;
  return f && f.until > Date.now() ? Math.ceil((f.until - Date.now()) / 1000) : 0;
};

export function verifyIdentity(b: { customerId?: string; lastName?: string; birthDate?: string; otp?: string }) {
  const c = b.customerId ? TEST_CUSTOMERS[b.customerId] : undefined;
  if (!c || c.lastName !== b.lastName || c.birthDate !== b.birthDate || c.otp !== b.otp) {
    if (c) {
      const f = fails.get(b.customerId!) ?? { n: 0, until: 0 };
      f.n += 1;
      if (f.n >= MAX_FAILS) { f.n = 0; f.until = Date.now() + LOCK_MS; }
      fails.set(b.customerId!, f);
    }
    return null;
  }
  fails.delete(b.customerId!);
  const token = randomBytes(32).toString("hex");
  const expires = Date.now() + TTL_MS;
  db.prepare("insert into kyc_sessions (token, customer_id, expires_at) values (?, ?, ?)").run(token, b.customerId!, expires);
  return { token, expiresAt: new Date(expires).toISOString() };
}

export function customerFromToken(token: unknown): string | null {
  if (typeof token !== "string") return null;
  const row = db.prepare("select customer_id, expires_at from kyc_sessions where token = ?").get(token) as any;
  return row && row.expires_at > Date.now() ? row.customer_id : null;
}
