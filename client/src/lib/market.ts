// Prix du MARCHÉ (CoinGecko, API publique sans clé) : BTC et USDC en CHF, variation 24 h, historique.
// Information seulement : les coins du wallet sont sur des réseaux de TEST (signet, Sepolia) et n'ont aucune valeur.
// Mis en cache (l'API publique limite le nombre d'appels) ; en cas d'échec, cours SIMULÉ signalé comme tel.
import { useEffect, useState } from "react";
import { BTC_CHF, USDC_CHF } from "./config";

// Fourni par Swissquote (bank-mock relaie CoinGecko avec un cache partagé : la limite de débit publique est vite atteinte).
import { BANK_URL } from "./bank";
export type Coin = "bitcoin" | "usd-coin";
export type Price = { chf: number; change24h: number; source: "CoinGecko" | "simulated" };
export type Period = "1D" | "1W" | "1M" | "3M" | "1Y";
export const PERIODS: Period[] = ["1D", "1W", "1M", "3M", "1Y"];
const FALLBACK: Record<Coin, number> = { bitcoin: BTC_CHF, "usd-coin": USDC_CHF };

async function cached<T>(key: string, ttlMs: number, load: () => Promise<T>): Promise<T> {
  const hit = JSON.parse(localStorage.getItem(key) ?? "null");
  if (hit && Date.now() - hit.at < ttlMs) return hit.v;
  try {
    const v = await load();
    localStorage.setItem(key, JSON.stringify({ at: Date.now(), v }));
    return v;
  } catch (e) {
    if (hit) return hit.v; // dernière valeur connue plutôt que rien
    throw e;
  }
}
const get = async (path: string) => {
  const r = await fetch(BANK_URL + path);
  const j = await r.json();
  if (!r.ok) throw new Error(j.error ?? `market data: HTTP ${r.status}`);
  return j.data;
};

export async function prices(): Promise<Record<Coin, Price>> {
  try {
    const j = await cached("sq-market:prices", 5 * 60_000, () => get("/market/prices"));
    return {
      bitcoin: { chf: j.bitcoin.chf, change24h: j.bitcoin.chf_24h_change ?? 0, source: "CoinGecko" },
      "usd-coin": { chf: j["usd-coin"].chf, change24h: j["usd-coin"].chf_24h_change ?? 0, source: "CoinGecko" },
    };
  } catch {
    return { bitcoin: { chf: FALLBACK.bitcoin, change24h: 0, source: "simulated" }, "usd-coin": { chf: FALLBACK["usd-coin"], change24h: 0, source: "simulated" } };
  }
}
// Historique [horodatage ms, prix CHF]. Pas de repli simulé : sans données, pas de courbe (l'appelant l'affiche).
export const history = (coin: Coin, period: Period): Promise<[number, number][]> =>
  cached(`sq-market:hist:${coin}:${period}`, period === "1D" ? 5 * 60_000 : 30 * 60_000, async () => (await get(`/market/history?coin=${coin}&period=${period}`)).prices);

// Prix courants partagés par toute l'appli (rafraîchis toutes les 5 minutes).
let current: Record<Coin, Price> | null = null;
const subs = new Set<(p: Record<Coin, Price>) => void>();
async function refreshPrices() { current = await prices(); subs.forEach((f) => f(current!)); }
export function usePrices(): Record<Coin, Price> | null {
  const [p, setP] = useState(current);
  useEffect(() => {
    subs.add(setP);
    if (subs.size === 1) { refreshPrices(); }
    const t = setInterval(refreshPrices, 5 * 60_000);
    return () => { subs.delete(setP); clearInterval(t); };
  }, []);
  return p;
}
export const priceOf = (p: Record<Coin, Price> | null, coin: Coin) => p?.[coin].chf ?? FALLBACK[coin];
