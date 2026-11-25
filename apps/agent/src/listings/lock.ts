// One listing check at a time, in this process (the app runs on one machine). The flag lives in
// memory, so a restart frees it: a run that died with the process never blocks the next one.
// "Check now" reserves the slot before starting the workflow, so two quick clicks can't start two
// runs; the step takes it (and refuses when the schedule or another click already did).

/** A reservation the workflow step never picked up (startAsync failed) frees itself after this. */
const RESERVATION_MS = 60_000;

let running = false;
let reservedAt: number | null = null;

const reserved = (now: number) => reservedAt !== null && now - reservedAt < RESERVATION_MS;

/** True while a check runs or "Check now" is starting one. */
export function listingCheckBusy(now = Date.now()): boolean {
  return running || reserved(now);
}

/** "Check now": reserves the slot for the run it is about to start; false when busy. */
export function reserveListingCheck(now = Date.now()): boolean {
  if (listingCheckBusy(now)) return false;
  reservedAt = now;
  return true;
}

/** Frees a reservation whose run could not be started. */
export function cancelListingCheckReservation(): void {
  reservedAt = null;
}

/**
 * The workflow step: takes the slot (a reservation counts as its own); false when another run
 * holds it. Call `releaseListingCheck` when done.
 */
export function acquireListingCheck(): boolean {
  if (running) return false;
  running = true;
  reservedAt = null;
  return true;
}

export function releaseListingCheck(): void {
  running = false;
}
