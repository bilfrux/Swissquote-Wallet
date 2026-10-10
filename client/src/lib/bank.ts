// Appels au backend Swissquote MOCKÉ (bank-mock) : session bancaire simulée, comptes, guardian.
// L'appli n'en dépend jamais pour dépenser : si bank-mock est arrêté, seules les fonctions bancaires et de guardian manquent.
import { NETWORK } from "./config";

export const BANK_URL = import.meta.env.VITE_BANK_MOCK_URL ?? "http://localhost:4000";
const SESSION = "sq-bank:session";
export type Session = { token: string; customer: { id: string; firstName: string; lastName: string } };
export const loadSession = (): Session | null => JSON.parse(sessionStorage.getItem(SESSION) ?? "null");
export const clearSession = () => sessionStorage.removeItem(SESSION);

async function call(path: string, body?: unknown) {
  const s = loadSession();
  const r = await fetch(BANK_URL + path, {
    method: body ? "POST" : "GET",
    headers: { ...(body ? { "content-type": "application/json" } : {}), ...(s ? { authorization: `Bearer ${s.token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const j = await r.json();
  if (!r.ok) throw new Error(j.error ?? `HTTP ${r.status}`);
  return j;
}

export async function login(customerId: string, password: string): Promise<Session> {
  const s = await call("/auth/login", { customerId, password });
  sessionStorage.setItem(SESSION, JSON.stringify(s));
  return s;
}
export type BankAccount = { iban: string; label: string; currency: string; balance: number; transactions: { date: string; label: string; amount: number }[] };
export const me = () => call("/me") as Promise<{ id: string; firstName: string; lastName: string; accounts: BankAccount[] }>;

export type RegisteredAccount = { id: number; delay: number; client: string; tiers: string; tiersName: string | null; swissquote: string; createdAt: string };
export const walletAccounts = async (): Promise<RegisteredAccount[]> => (await call(`/wallet/accounts?network=${NETWORK}`)).accounts;
export const fetchSwissquoteKey = async (): Promise<string> => (await call(`/guardian/key?network=${NETWORK}`)).accountKey;
export const registerAccount = (a: { delay: number; client: string; tiers: string; tiersName?: string | null }) =>
  call("/accounts/register", { network: NETWORK, ...a }) as Promise<{ accountId: number }>;

// --- Recovery ---
export type KycForm = { lastName: string; birthDate: string; otp: string };
export const verifyIdentity = (f: KycForm) => call("/identity/verify", { customerId: loadSession()?.customer.id, ...f }) as Promise<{ token: string; expiresAt: string }>;
export const listAccounts = async (token: string): Promise<RegisteredAccount[]> => (await call("/accounts/list", { token, network: NETWORK })).accounts;
export const guardianSign = (token: string, psbt: string) => call("/guardian/sign", { token, network: NETWORK, psbt }) as Promise<{ psbt: string; added: number }>;
