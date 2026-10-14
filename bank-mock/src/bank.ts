// Banque SIMULÉE : clients de test, connexion, comptes CHF et opérations fictives. Aucune donnée réelle.
import { randomBytes } from "node:crypto";
import { db } from "./db.ts";

export type Customer = { firstName: string; lastName: string; password: string; accounts: { iban: string; label: string; currency: string; balance: number; transactions: { date: string; label: string; amount: number }[] }[] };

export const CUSTOMERS: Record<string, Customer> = {
  "CH-0001": {
    firstName: "Anna", lastName: "Muster", password: "demo1234",
    accounts: [
      { iban: "CH93 0076 2011 6238 5295 7", label: "Private account", currency: "CHF", balance: 12840.55, transactions: [
        { date: "2026-10-08", label: "October salary", amount: 6450 },
        { date: "2026-10-07", label: "Migros Lausanne", amount: -84.3 },
        { date: "2026-10-05", label: "SBB subscription", amount: -340 },
        { date: "2026-10-01", label: "Rent", amount: -1950 },
      ] },
      { iban: "CH56 0483 5012 3456 7800 9", label: "Savings account", currency: "CHF", balance: 35200, transactions: [
        { date: "2026-09-30", label: "Interest", amount: 52.1 },
      ] },
    ],
  },
  // Client de démo VIERGE : aucun compte Bitcoin, pour montrer une création de wallet depuis zéro.
  "CH-0003": {
    firstName: "Léa", lastName: "Martin", password: "demo0003",
    accounts: [
      { iban: "CH44 0076 2011 6238 0003 1", label: "Private account", currency: "CHF", balance: 8420.15, transactions: [
        { date: "2026-10-09", label: "October salary", amount: 5200 },
        { date: "2026-10-06", label: "Coop Geneva", amount: -63.45 },
        { date: "2026-10-01", label: "Rent", amount: -1680 },
      ] },
      { iban: "CH72 0483 5012 3456 0003 2", label: "Savings account", currency: "CHF", balance: 15000, transactions: [{ date: "2026-09-30", label: "Interest", amount: 21.4 }] },
    ],
  },
  // Second client de démo VIERGE, réservé à la présentation (jamais utilisé pour tester l'appli).
  "CH-0004": {
    firstName: "Sofia", lastName: "Keller", password: "pitch0004",
    accounts: [
      { iban: "CH61 0076 2011 6238 0004 3", label: "Private account", currency: "CHF", balance: 9615.8, transactions: [
        { date: "2026-10-09", label: "October salary", amount: 5800 },
        { date: "2026-10-05", label: "Migros Zurich", amount: -92.7 },
        { date: "2026-10-01", label: "Rent", amount: -1750 },
      ] },
      { iban: "CH88 0483 5012 3456 0004 4", label: "Savings account", currency: "CHF", balance: 22000, transactions: [{ date: "2026-09-30", label: "Interest", amount: 30.6 }] },
    ],
  },
  // Troisième client de démo VIERGE, réservé à l'enregistrement de la vidéo.
  "CH-0005": {
    firstName: "Noah", lastName: "Berger", password: "video0005",
    accounts: [
      { iban: "CH29 0076 2011 6238 0005 5", label: "Private account", currency: "CHF", balance: 7340.2, transactions: [
        { date: "2026-10-09", label: "October salary", amount: 4900 },
        { date: "2026-10-04", label: "Coop Bern", amount: -57.9 },
        { date: "2026-10-01", label: "Rent", amount: -1590 },
      ] },
      { iban: "CH37 0483 5012 3456 0005 6", label: "Savings account", currency: "CHF", balance: 18500, transactions: [{ date: "2026-09-30", label: "Interest", amount: 25.3 }] },
    ],
  },
  // Quatrième client de démo VIERGE, réservé au deuxième passage devant le jury.
  "CH-0006": {
    firstName: "Elena", lastName: "Rossi", password: "second0006",
    accounts: [
      { iban: "CH15 0076 2011 6238 0006 7", label: "Private account", currency: "CHF", balance: 11280.35, transactions: [
        { date: "2026-10-09", label: "October salary", amount: 6100 },
        { date: "2026-10-06", label: "Denner Lugano", amount: -48.6 },
        { date: "2026-10-01", label: "Rent", amount: -1840 },
      ] },
      { iban: "CH43 0483 5012 3456 0006 8", label: "Savings account", currency: "CHF", balance: 24000, transactions: [{ date: "2026-09-30", label: "Interest", amount: 33.7 }] },
    ],
  },
  "CH-0002": {
    firstName: "Paul", lastName: "Exemple", password: "demo5678",
    accounts: [{ iban: "CH12 0900 0000 1234 5678 9", label: "Private account", currency: "CHF", balance: 2310.4, transactions: [{ date: "2026-10-02", label: "Transfer received", amount: 500 }] }],
  },
};

db.exec("create table if not exists bank_sessions (token text primary key, customer_id text not null, expires_at integer not null)");
const TTL_MS = 8 * 60 * 60 * 1000;

// Session bancaire (après mot de passe ou passkey).
export function createSession(customerId: string) {
  const c = CUSTOMERS[customerId];
  const token = randomBytes(32).toString("hex");
  db.prepare("insert into bank_sessions (token, customer_id, expires_at) values (?, ?, ?)").run(token, customerId, Date.now() + TTL_MS);
  return { token, customer: { id: customerId, firstName: c.firstName, lastName: c.lastName } };
}

export function login(customerId: unknown, password: unknown) {
  if (typeof customerId !== "string") return null;
  const c = CUSTOMERS[customerId];
  if (!c || c.password !== password) return null;
  return createSession(customerId);
}

export function customerFromSession(authorization: unknown): string | null {
  const token = typeof authorization === "string" ? authorization.replace(/^Bearer /, "") : null;
  if (!token) return null;
  const row = db.prepare("select customer_id, expires_at from bank_sessions where token = ?").get(token) as any;
  return row && row.expires_at > Date.now() ? row.customer_id : null;
}
