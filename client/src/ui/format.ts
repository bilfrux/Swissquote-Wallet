// Formats suisses : séparateur de milliers ’ (de-CH), deux décimales.
const nf = new Intl.NumberFormat("de-CH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export const num = (n: number) => nf.format(n);
export const signed = (n: number) => `${n >= 0 ? "+" : "−"}${nf.format(Math.abs(n))}`;
