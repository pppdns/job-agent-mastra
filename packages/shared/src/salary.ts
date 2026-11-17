import type { SalaryPeriod } from "./posting";

// Pay in one comparable unit: yearly, in a chosen currency. The rates are rough and set by hand
// (they drift slowly): good enough to color a chip against a floor, never to quote a figure.

const PER_YEAR: Record<SalaryPeriod, number> = {
  hour: 2_080,
  day: 260,
  week: 52,
  month: 12,
  year: 1,
};

/** Rough value of one unit in EUR. */
const EUR_PER_UNIT: Record<string, number> = {
  EUR: 1,
  USD: 0.87,
  GBP: 1.17,
  CHF: 1.07,
  CAD: 0.63,
  AUD: 0.57,
  SEK: 0.09,
  NOK: 0.085,
  DKK: 0.134,
  PLN: 0.235,
  CZK: 0.04,
  HUF: 0.0025,
  RON: 0.2,
  INR: 0.0103,
  SGD: 0.67,
};

const SYMBOLS: Record<string, string> = { EUR: "€", USD: "$", GBP: "£" };
const PERIOD_SUFFIX: Record<SalaryPeriod, string> = {
  hour: "/h",
  day: "/day",
  week: "/wk",
  month: "/mo",
  year: "",
};

/** Normalizes a currency as listings write it ("€", "usd") to an ISO code, or null. */
export function currencyCode(currency: string): string | null {
  const c = currency.trim().toUpperCase();
  if (c === "€") return "EUR";
  if (c === "$") return "USD";
  if (c === "£") return "GBP";
  return /^[A-Z]{3}$/.test(c) ? c : null;
}

/** A yearly amount converted to `to` (null when a currency isn't in the table). */
export function toAnnual(
  amount: number,
  from: { currency: string; period: SalaryPeriod },
  to: string,
): number | null {
  const a = EUR_PER_UNIT[currencyCode(from.currency) ?? ""];
  const b = EUR_PER_UNIT[to.toUpperCase()];
  if (!a || !b) return null;
  return (amount * PER_YEAR[from.period] * a) / b;
}

const compact = (n: number) => {
  if (n >= 1_000_000)
    return `${(n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 1).replace(/\.0$/, "")}M`;
  if (n >= 10_000) return `${Math.round(n / 1000)}k`;
  if (n >= 1_000) return `${(n / 1000).toFixed(1).replace(/\.0$/, "")}k`;
  return String(Math.round(n));
};

/** "€120–150k", "$140k", "HUF 1.4–1.8M/mo": the listing's own figures, compact. */
export function formatPay(salary: {
  min: number | null;
  max: number | null;
  currency: string;
  period: SalaryPeriod;
}): string {
  const code = currencyCode(salary.currency) ?? salary.currency;
  const symbol = SYMBOLS[code];
  const { min, max } = salary;
  const lo = min ?? max ?? 0;
  const hi = max ?? min ?? 0;
  let figures: string;
  if (lo === hi) figures = compact(lo);
  else {
    // "120–150k": one unit suffix when both ends share it.
    const a = compact(lo);
    const b = compact(hi);
    const unit = (s: string) => s.match(/[kM]$/)?.[0] ?? "";
    figures = unit(a) && unit(a) === unit(b) ? `${a.slice(0, -1)}–${b}` : `${a}–${b}`;
  }
  return `${symbol ?? `${code} `}${figures}${PERIOD_SUFFIX[salary.period]}`;
}
