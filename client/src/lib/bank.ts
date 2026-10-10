// Appels au backend Swissquote MOCKÉ (bank-mock) : session bancaire simulée, comptes, guardian.
// L'appli n'en dépend jamais pour dépenser : si bank-mock est arrêté, seules les fonctions bancaires et de guardian manquent.
import { startAuthentication, startRegistration } from "@simplewebauthn/browser";
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

// --- Preuve de propriété ---
export const ownershipChallenge = (client: string, change: number, index: number) =>
  call("/ownership/challenge", { network: NETWORK, client, change, index }) as Promise<{ challengeId: string; message: string; address: string; change: number; index: number }>;
export const ownershipVerify = (challengeId: string, signature: string) =>
  call("/ownership/verify", { challengeId, signature }) as Promise<{ verified: boolean; address: string; keyAddress: string; proves: string }>;

// --- Alertes (information ; dépendent de Swissquote) ---
export type Notification = { id: number; accountId: number | null; kind: string; title: string; body: string; createdAt: string; readAt: string | null };
export const notifications = () => call("/notifications") as Promise<{ unread: number; items: Notification[] }>;
export const markNotificationsRead = () => call("/notifications/read", {}) as Promise<{ ok: boolean }>;

// --- Passkeys (WebAuthn) : connexion et ré-authentification « step-up » ---
export const passkeyStatus = () => call("/auth/passkey") as Promise<{ count: number }>;
export async function registerPasskey() {
  const optionsJSON = await call("/auth/passkey/register/options", {});
  return call("/auth/passkey/register/verify", { response: await startRegistration({ optionsJSON }) }) as Promise<{ registered: boolean; count: number }>;
}
export async function loginWithPasskey(customerId: string): Promise<Session> {
  const optionsJSON = await call("/auth/passkey/login/options", { customerId });
  const s = await call("/auth/passkey/login/verify", { customerId, response: await startAuthentication({ optionsJSON }) });
  sessionStorage.setItem(SESSION, JSON.stringify(s));
  return s;
}
// Seuil « montant élevé » (sats) : ré-authentification par passkey avant de faire signer le wallet.
export const HIGH_VALUE_SATS = BigInt(import.meta.env.VITE_HIGH_VALUE_SATS ?? 20_000_000);
export type StepUp = { status: "approuvé" } | { status: "swissquote-injoignable" };
export async function stepUp(amountSats: bigint, destination: string, network: string): Promise<StepUp> {
  let opts;
  try {
    if ((await passkeyStatus()).count === 0) await registerPasskey(); // première fois : activation sur place
    opts = await call("/auth/stepup/options", {});
  } catch (e: any) {
    // Swissquote injoignable : l'envoi n'est pas bloqué (le client dépense seul) ; le wallet applique seul ses contrôles.
    if (e instanceof TypeError) return { status: "swissquote-injoignable" };
    throw e;
  }
  await call("/auth/stepup/verify", { response: await startAuthentication({ optionsJSON: opts }), amountSats: Number(amountSats), destination, network });
  return { status: "approuvé" };
}

// --- Compte crypto Swissquote (custodial) et transferts sous la Travel Rule ---
export type TravelRuleRecord = { id: number; direction: "sortant" | "entrant"; status: string; amount_sats: number; address: string; txid: string | null; originator: string; beneficiary: string; verification: string; created_at: string };
export const custody = () => call(`/custody?network=${NETWORK}`) as Promise<{ balanceSats: number }>;
export const depositAddress = async (): Promise<string> => (await call(`/custody/deposit-address?network=${NETWORK}`)).address;
export const syncDeposits = () => call("/custody/sync", { network: NETWORK }) as Promise<{ credited: number; held: number }>;
export const travelRule = async (): Promise<TravelRuleRecord[]> => (await call(`/custody/travel-rule?network=${NETWORK}`)).records;
export class NeedProof extends Error {}
export async function withdrawToWallet(address: string, amountSats: number) {
  try { return (await call("/custody/withdraw", { network: NETWORK, address, amountSats })) as { txid: string; balanceSats: number; recordId: number }; }
  catch (e: any) { if (/proof of ownership required/.test(e.message)) throw new NeedProof(e.message); throw e; }
}
export const ownershipStatus = async (address: string): Promise<boolean> => (await call(`/ownership/status?address=${encodeURIComponent(address)}`)).verified;
// Relais vers le tiers (A3) : dépôt du PSBT signé par Swissquote, puis lecture de la signature du tiers.
export const relayCreate = async (psbt: string): Promise<string> => (await call("/relay", { psbt })).id;
export const relayGet = async (id: string): Promise<{ psbt: string; signed: string | null }> => call(`/relay?id=${id}`);

// --- Ethereum (Sepolia) : Safe du client, Swissquote est l'un des deux gardiens ---
export type EvmAccount = { id: number; owner: `0x${string}`; safe: `0x${string}`; tiers: `0x${string}`; tiersName: string | null; createdAt?: string };
export const evmAccounts = () => call("/evm/accounts") as Promise<{ swissquote: `0x${string}`; accounts: EvmAccount[] }>;
export const registerEvm = (owner: string, tiers: string, tiersName?: string | null) =>
  call("/evm/accounts/register", { owner, tiers, tiersName }) as Promise<EvmAccount & { swissquote: `0x${string}` }>;
