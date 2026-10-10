// Appels au backend Swissquote MOCKÉ (bank-mock). L'appli n'en dépend jamais pour dépenser :
// si bank-mock est arrêté, seules les fonctions de guardian sont indisponibles.
import { NETWORK } from "./config";

export const BANK_URL = import.meta.env.VITE_BANK_MOCK_URL ?? "http://localhost:4000";
// Session de la banque simulée (mock) : identifiant du client connecté.
export const CUSTOMER_ID = import.meta.env.VITE_CUSTOMER_ID ?? "CH-0001";

async function call(path: string, body?: unknown) {
  const r = await fetch(BANK_URL + path, body ? { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) } : undefined);
  const j = await r.json();
  if (!r.ok) throw new Error(j.error ?? `HTTP ${r.status}`);
  return j;
}

export const fetchSwissquoteKey = async (): Promise<string> => (await call(`/guardian/key?network=${NETWORK}`)).accountKey;
export const registerAccount = (a: { delay: number; client: string; tiers: string }) =>
  call("/accounts/register", { customerId: CUSTOMER_ID, network: NETWORK, ...a }) as Promise<{ accountId: number }>;
