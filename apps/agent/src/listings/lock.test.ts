import { beforeEach, describe, expect, it } from "vitest";
import {
  acquireListingCheck,
  cancelListingCheckReservation,
  listingCheckBusy,
  releaseListingCheck,
  reserveListingCheck,
} from "./lock";

beforeEach(() => {
  releaseListingCheck();
  cancelListingCheckReservation();
});

describe("listing check lock", () => {
  it("lets one click reserve and its run take the slot; a second click or run is refused", () => {
    expect(reserveListingCheck(0)).toBe(true);
    expect(reserveListingCheck(1)).toBe(false);
    expect(acquireListingCheck()).toBe(true);
    expect(listingCheckBusy(2)).toBe(true);
    expect(acquireListingCheck()).toBe(false);
    releaseListingCheck();
    expect(listingCheckBusy(3)).toBe(false);
  });

  it("frees a reservation whose run never started", () => {
    expect(reserveListingCheck(0)).toBe(true);
    expect(listingCheckBusy(59_999)).toBe(true);
    expect(listingCheckBusy(60_000)).toBe(false);
  });

  it("refuses a click while the scheduled run holds the slot", () => {
    expect(acquireListingCheck()).toBe(true);
    expect(reserveListingCheck()).toBe(false);
  });
});
