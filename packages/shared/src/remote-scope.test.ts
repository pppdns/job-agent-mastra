import { describe, expect, it } from "vitest";
import { type Home, matchCommute, matchPlace, matchPlaces } from "./remote-scope";

const HOME: Home = { city: "Budapest", country: "Hungary" };

describe("matchPlace", () => {
  it.each([
    ["Worldwide", "covers"],
    ["Anywhere", "covers"],
    ["EMEA", "covers"],
    ["Europe (CET ±2)", "covers"],
    ["Remote - Poland, Hungary", "covers"],
    ["Budapest, Hungary", "covers"],
    ["United States", "excludes"],
    ["Remote (US only)", "excludes"],
    ["Remote within the United States", "excludes"],
    ["Lanham, Maryland, United States", "excludes"],
    ["Austin, TX", "excludes"],
    ["New York, NY", "excludes"],
    ["North America / United States / Canada", "excludes"],
    ["Berlin, Germany", "excludes"],
    ["UK & Ireland", "excludes"],
    ["Spain or Portugal", "excludes"],
    ["LATAM", "excludes"],
    ["Romania, the US, and Canada", "excludes"],
    ["another Eastern European country", "covers"],
    ["any large European city", "covers"],
    ["Western Europe", "excludes"],
    ["Springfield", "unknown"],
  ] as const)("%s → %s", (place, expected) => {
    expect(matchPlace(place, HOME)).toBe(expected);
  });

  it.each([
    ["Budapest, Hungary", "covers"],
    ["Törökbálint, Pest, Hungary", "covers"],
    ["Környe, Komárom-Esztergom, Hungary", "excludes"],
    ["Hungary", "unknown"],
    ["Berlin, Germany", "excludes"],
    ["Springfield", "unknown"],
  ] as const)("commute %s → %s", (place, expected) => {
    expect(matchCommute(place, HOME)).toBe(expected);
  });

  it("any covering place wins in a list", () => {
    expect(matchPlaces(["United States", "Europe"], HOME)).toBe("covers");
    expect(matchPlaces(["United States", "Canada"], HOME)).toBe("excludes");
    expect(matchPlaces([], HOME)).toBe("unknown");
  });

  it("follows home", () => {
    const austin: Home = { city: "Austin", country: "United States" };
    expect(matchPlace("Remote (US only)", austin)).toBe("covers");
    expect(matchPlace("EMEA", austin)).toBe("excludes");
    expect(matchPlace("North America", austin)).toBe("covers");
    expect(matchPlace("Berlin, Germany", { city: "Munich", country: "Germany" })).toBe("covers");
    expect(matchPlace("CEE", { city: "Lisbon", country: "Portugal" })).toBe("excludes");
  });
});
