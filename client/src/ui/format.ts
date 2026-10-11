// Formats suisses : séparateur de milliers ’ (de-CH), deux décimales par défaut.
const nfs = new Map<number, Intl.NumberFormat>();
const nf = (d: number) => nfs.get(d) ?? nfs.set(d, new Intl.NumberFormat("de-CH", { minimumFractionDigits: d, maximumFractionDigits: d })).get(d)!;
export const num = (n: number, decimals = 2) => nf(decimals).format(n);
export const signed = (n: number) => `${n >= 0 ? "+" : "−"}${nf(2).format(Math.abs(n))}`;
