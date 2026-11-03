import { z } from "zod";

/** Chat ids are also Mastra thread ids; new ones are UUIDs created in the browser. */
export const threadIdSchema = z.string().regex(/^[A-Za-z0-9_-]{1,128}$/);

export const MAX_MESSAGE_CHARS = 50_000;
export const MAX_TITLE_CHARS = 120;

/**
 * Body the browser may send to /api/chat: one new user text message for one thread.
 * Everything else the agent receives (memory, resource) is set server-side.
 */
export const chatRequestSchema = z.object({
  threadId: threadIdSchema,
  message: z.object({
    id: z.string().min(1).max(128),
    role: z.literal("user"),
    parts: z
      .array(z.object({ type: z.literal("text"), text: z.string().min(1).max(MAX_MESSAGE_CHARS) }))
      .length(1),
  }),
});

export type ChatRequest = z.infer<typeof chatRequestSchema>;

export const threadTitleSchema = z.string().trim().min(1).max(MAX_TITLE_CHARS);

/** Approval "thread" for changes proposed from the profile page rather than a chat. */
export const PROFILE_PAGE_THREAD = "profile-page";

/** Approval "thread" for drafts approved from a job page rather than a chat. */
export const JOB_PAGE_THREAD = "job-page";
