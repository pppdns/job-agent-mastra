import { describe, expect, it } from "vitest";
import { formatPay, parsePayText } from "./salary";

describe("formatPay", () => {
  it("puts the currency first and shortens both ends", () => {
    const pay = (min: number, max: number, currency: string, period = "year" as const) =>
      formatPay({ min, max, currency, period });
    expect(pay(14_000_000, 24_000_000, "HUF")).toBe("HUF 14M – 24M");
    expect(formatPay({ min: 1_800_000, max: 2_100_000, currency: "HUF", period: "month" })).toBe(
      "HUF 1.8M – 2.1M/mo",
    );
    expect(formatPay({ min: 6_500, max: 9_000, currency: "€", period: "month" })).toBe(
      "€6.5k – 9k/mo",
    );
    expect(pay(140_000, 140_000, "USD")).toBe("$140k");
    expect(pay(120_000, 150_000, "EUR")).toBe("€120k – 150k");
  });
});

describe("parsePayText", () => {
  it("reads figures, currency and a stated period", () => {
    expect(parsePayText("HUF 1,800,000.00/mo - HUF 2,100,000.00/mo")).toEqual({
      min: 1_800_000,
      max: 2_100_000,
      currency: "HUF",
      period: "month",
      periodStated: true,
    });
    expect(parsePayText("EUR 75,000 – 90,000 / year + equity")).toMatchObject({
      min: 75_000,
      max: 90_000,
      currency: "EUR",
      period: "year",
      periodStated: true,
    });
    expect(parsePayText("$140k")).toMatchObject({ min: 140_000, max: 140_000, currency: "USD" });
    expect(parsePayText("bruttó 900 000 Ft havi")).toMatchObject({
      max: 900_000,
      currency: "HUF",
      period: "month",
    });
  });

  it("guesses an unstated period from the size of the figures", () => {
    expect(parsePayText("14,000,000 - 24,000,000 HUF")).toMatchObject({
      min: 14_000_000,
      max: 24_000_000,
      period: "year",
      periodStated: false,
    });
    expect(
      parsePayText(
        "€6,500 to €9,000 gross, depending on the level of experience (period not stated) + equity options",
      ),
    ).toMatchObject({
      min: 6_500,
      max: 9_000,
      currency: "EUR",
      period: "month",
      periodStated: false,
    });
  });

  it("returns null without a figure or a currency", () => {
    expect(parsePayText("Competitive")).toBeNull();
    expect(parsePayText("70,000 - 90,000")).toBeNull();
  });
});
