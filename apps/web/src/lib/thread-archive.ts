/** Archived chats carry `archivedAt` (ISO date) in their Mastra thread metadata. */
const ARCHIVED_KEY = "archivedAt";

export type ThreadMetadata = Record<string, unknown>;

export function isArchived(metadata: ThreadMetadata | null | undefined): boolean {
  return typeof metadata?.[ARCHIVED_KEY] === "string";
}

/**
 * Mastra's PATCH replaces `metadata` wholesale, so always merge into the stored object
 * instead of sending the archive key alone.
 */
export function withArchived(
  metadata: ThreadMetadata | null | undefined,
  archived: boolean,
  now = new Date(),
): ThreadMetadata {
  const { [ARCHIVED_KEY]: _previous, ...rest } = metadata ?? {};
  return archived ? { ...rest, [ARCHIVED_KEY]: now.toISOString() } : rest;
}
