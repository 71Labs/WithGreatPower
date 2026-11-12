/**
 * Counts with their noun, in one place, so no screen prints "1 trades" or "2 hero".
 * Pure strings: no React.
 */
const whole = new Intl.NumberFormat("en-US");

/** The noun for `n`: "trade" for 1, "trades" otherwise. Give `many` for an irregular plural ("hero", "heroes"). */
export const noun = (n: number, one: string, many: string = `${one}s`) => (n === 1 ? one : many);

/** "1 trade", "2 trades", "1,204 heroes": the count with thousands separators, then the noun. */
export const plural = (n: number, one: string, many?: string) => `${whole.format(n)} ${noun(n, one, many)}`;
