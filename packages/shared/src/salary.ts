import { moneyAmounts } from "./assessment";
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
  if (n >= 1_000_000) {
    const m = n / 1_000_000;
    return `${(m >= 10 ? Math.round(m) : Number(m.toFixed(1))).toString()}M`;
  }
  if (n >= 100_000) return `${Math.round(n / 1000)}k`;
  if (n >= 1_000) return `${Number((n / 1000).toFixed(1)).toString()}k`;
  return String(Math.round(n));
};

/** "HUF 14M – 24M", "€6.5k – 9k/mo", "$140k": the listing's own figures, compact. */
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
  const figures = lo === hi ? compact(lo) : `${compact(lo)} – ${compact(hi)}`;
  return `${symbol ?? `${code} `}${figures}${PERIOD_SUFFIX[salary.period]}`;
}

export type ParsedPay = {
  min: number;
  max: number;
  currency: string;
  period: SalaryPeriod;
  /** False when the text names no period and it was guessed from the size of the figures. */
  periodStated: boolean;
};

const CURRENCY_WORDS: [RegExp, string][] = [
  [/€/, "EUR"],
  [/£/, "GBP"],
  [/\$/, "USD"],
  [/\b(?:ft|forint|huf)\b/i, "HUF"],
];
const PERIOD_WORDS: [RegExp, SalaryPeriod][] = [
  [/\/\s?(?:mo|month)\b|\b(?:monthly|per month|a month|month|havi)\b/i, "month"],
  [/\/\s?(?:h|hr|hour)\b|\b(?:hourly|per hour|an hour|hour)\b/i, "hour"],
  [/\/\s?day\b|\b(?:daily|per day|a day|day rate)\b/i, "day"],
  [/\/\s?(?:wk|week)\b|\b(?:weekly|per week)\b/i, "week"],
  [
    /\/\s?(?:yr|year)\b|\b(?:yearly|annual|annually|per year|a year|year|p\.?a\.?)(?![\p{L}])/iu,
    "year",
  ],
];
/** A yearly pay under this (in EUR) is implausible: the figures are monthly. */
const MIN_PLAUSIBLE_YEARLY_EUR = 20_000;

/**
 * Figures, currency and period from pay as free text ("14,000,000 - 24,000,000 HUF",
 * "€6,500 to €9,000 gross + equity"); null when it has no figure or no currency. Text after a
 * "+" (equity, bonus) is ignored. An unstated period is yearly unless that would be implausibly
 * low, then monthly.
 */
export function parsePayText(text: string): ParsedPay | null {
  const main = text.split("+")[0] ?? "";
  const amounts = moneyAmounts(main).filter((a) => a.value > 0);
  const first = amounts[0];
  if (!first) return null;
  const second = amounts[1];
  const code = main.match(/\b[A-Z]{3}\b/g)?.find((c) => c in EUR_PER_UNIT);
  const currency = code ?? CURRENCY_WORDS.find(([re]) => re.test(main))?.[1];
  if (!currency) return null;
  const min = Math.min(first.value, second?.value ?? first.value);
  const max = Math.max(first.value, second?.value ?? first.value);
  const stated = PERIOD_WORDS.find(([re]) => re.test(main))?.[1];
  if (stated) return { min, max, currency, period: stated, periodStated: true };
  const yearlyEur = toAnnual(max, { currency, period: "year" }, "EUR");
  const period = yearlyEur !== null && yearlyEur < MIN_PLAUSIBLE_YEARLY_EUR ? "month" : "year";
  return { min, max, currency, period, periodStated: false };
}
