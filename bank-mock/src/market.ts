// Flux de prix fourni par Swissquote (mock) : relais de l'API publique CoinGecko avec un cache partagé, pour respecter
// sa limite de débit (429 observé en développement). En cas d'échec, la dernière valeur connue est servie.
// Information seulement : aucune décision de garde ni de signature ne dépend de ces prix.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DATA_DIR } from "./db.ts";

const API = process.env.MARKET_API ?? "https://api.coingecko.com/api/v3";
const FILE = join(DATA_DIR, "market-cache.json");
type Entry = { at: number; v: unknown };
const cache: Record<string, Entry> = existsSync(FILE) ? JSON.parse(readFileSync(FILE, "utf8")) : {};
const inflight = new Map<string, Promise<unknown>>();

export const COINS = ["bitcoin", "usd-coin"] as const;
const DAYS: Record<string, number> = { "1D": 1, "1W": 7, "1M": 30, "3M": 90, "1Y": 365 };

async function cachedFetch(path: string, ttlMs: number): Promise<{ data: unknown; at: number; stale: boolean }> {
  const hit = cache[path];
  if (hit && Date.now() - hit.at < ttlMs) return { data: hit.v, at: hit.at, stale: false };
  if (!inflight.has(path))
    inflight.set(path, (async () => {
      const r = await fetch(API + path, { headers: { accept: "application/json" } });
      if (!r.ok) throw new Error(`CoinGecko HTTP ${r.status}`);
      const v = await r.json();
      cache[path] = { at: Date.now(), v };
      writeFileSync(FILE, JSON.stringify(cache));
      return v;
    })().finally(() => inflight.delete(path)));
  try {
    const v = await inflight.get(path)!;
    return { data: v, at: cache[path].at, stale: false };
  } catch (e) {
    if (hit) return { data: hit.v, at: hit.at, stale: true };
    throw e;
  }
}

export const marketPrices = () => cachedFetch(`/simple/price?ids=${COINS.join(",")}&vs_currencies=chf&include_24hr_change=true`, 60_000);
export function marketHistory(coin: string, period: string) {
  if (!(COINS as readonly string[]).includes(coin) || !DAYS[period]) throw new Error("unknown coin or period");
  return cachedFetch(`/coins/${coin}/market_chart?vs_currency=chf&days=${DAYS[period]}`, period === "1D" ? 5 * 60_000 : 30 * 60_000);
}
