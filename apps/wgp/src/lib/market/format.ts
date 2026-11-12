/**
 * How the market writes its numbers, shared by the screens and by Gwei's reasoning
 * (./reasoning.ts). Pure strings: no React.
 */
const bits = new Intl.NumberFormat("en-US");

/** A price in Bits from milli-Bits: 2 decimals under 10, 1 under 100, whole above. */
export function formatPrice(milli: number): string {
  const v = milli / 1000;
  const digits = v < 10 ? 2 : v < 100 ? 1 : 0;
  return v.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

export const formatBits = (n: number) => bits.format(n);

/** "1 Bit", "39 Bits". */
export const bitsText = (n: number) => `${bits.format(n)} ${n === 1 ? "Bit" : "Bits"}`;

/** "+12%", "−3%", "0%" with a real minus sign. */
export function formatChange(change: number): string {
  const pct = Math.round(change * 100);
  if (pct > 0) return `+${pct}%`;
  if (pct < 0) return `−${Math.abs(pct)}%`;
  return "0%";
}
