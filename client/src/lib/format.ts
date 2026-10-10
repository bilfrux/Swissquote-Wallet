export const btcFmt = (sats: bigint) => {
  const neg = sats < 0n;
  const s = (neg ? -sats : sats).toString().padStart(9, "0");
  return `${neg ? "-" : ""}${s.slice(0, -8)}.${s.slice(-8)} BTC`;
};
export const parseBtc = (v: string): bigint => {
  const m = v.trim().replace(",", ".").match(/^(\d+)(?:\.(\d{1,8}))?$/);
  if (!m) throw new Error("montant invalide (BTC, 8 décimales max)");
  return BigInt(m[1]) * 100_000_000n + BigInt((m[2] ?? "").padEnd(8, "0"));
};
