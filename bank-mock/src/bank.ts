// Banque SIMULÉE : clients de test, connexion, comptes CHF et opérations fictives. Aucune donnée réelle.
import { randomBytes } from "node:crypto";
import { db } from "./db.ts";

export type Customer = { firstName: string; lastName: string; password: string; accounts: { iban: string; label: string; currency: string; balance: number; transactions: { date: string; label: string; amount: number }[] }[] };

export const CUSTOMERS: Record<string, Customer> = {
  "CH-0001": {
    firstName: "Anna", lastName: "Muster", password: "demo1234",
    accounts: [
      { iban: "CH93 0076 2011 6238 5295 7", label: "Compte privé", currency: "CHF", balance: 12840.55, transactions: [
        { date: "2026-10-08", label: "Salaire octobre", amount: 6450 },
        { date: "2026-10-07", label: "Migros Lausanne", amount: -84.3 },
        { date: "2026-10-05", label: "CFF abonnement", amount: -340 },
        { date: "2026-10-01", label: "Loyer", amount: -1950 },
      ] },
      { iban: "CH56 0483 5012 3456 7800 9", label: "Compte épargne", currency: "CHF", balance: 35200, transactions: [
        { date: "2026-09-30", label: "Intérêts", amount: 52.1 },
      ] },
    ],
  },
  "CH-0002": {
    firstName: "Paul", lastName: "Exemple", password: "demo5678",
    accounts: [{ iban: "CH12 0900 0000 1234 5678 9", label: "Compte privé", currency: "CHF", balance: 2310.4, transactions: [{ date: "2026-10-02", label: "Virement reçu", amount: 500 }] }],
  },
};

db.exec("create table if not exists bank_sessions (token text primary key, customer_id text not null, expires_at integer not null)");
const TTL_MS = 8 * 60 * 60 * 1000;

export function login(customerId: unknown, password: unknown) {
  if (typeof customerId !== "string") return null;
  const c = CUSTOMERS[customerId];
  if (!c || c.password !== password) return null;
  const token = randomBytes(32).toString("hex");
  db.prepare("insert into bank_sessions (token, customer_id, expires_at) values (?, ?, ?)").run(token, customerId, Date.now() + TTL_MS);
  return { token, customer: { id: customerId, firstName: c.firstName, lastName: c.lastName } };
}

export function customerFromSession(authorization: unknown): string | null {
  const token = typeof authorization === "string" ? authorization.replace(/^Bearer /, "") : null;
  if (!token) return null;
  const row = db.prepare("select customer_id, expires_at from bank_sessions where token = ?").get(token) as any;
  return row && row.expires_at > Date.now() ? row.customer_id : null;
}
