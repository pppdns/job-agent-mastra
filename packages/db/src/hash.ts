import { createHash } from "node:crypto";

/** A deterministic rule was broken; the message is safe to show to the model. */
export class AssessmentError extends Error {}

/** Stable hash of a JSON value (object keys sorted), used to bind approvals to exact payloads. */
export function hashPayload(value: unknown): string {
  const canonical = (v: unknown): unknown =>
    Array.isArray(v)
      ? v.map(canonical)
      : v && typeof v === "object"
        ? Object.fromEntries(
            Object.entries(v)
              .filter(([, x]) => x !== undefined)
              .sort(([a], [b]) => (a < b ? -1 : 1))
              .map(([k, x]) => [k, canonical(x)]),
          )
        : v;
  return createHash("sha256")
    .update(JSON.stringify(canonical(value)))
    .digest("hex");
}
