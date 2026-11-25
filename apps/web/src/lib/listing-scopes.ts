import type { ListingScope } from "@copilot/db";

/** Names of the listing check's job groups (LISTING_SCOPES in packages/db listings.ts). */
export const LISTING_SCOPE_LABELS: Record<ListingScope, string> = {
  shortlisted: "Shortlisted",
  to_apply: "To apply",
  top_new: "New, top matches",
  other_new: "New, other matches",
};
