/** Single local user (see AGENTS.md: single-user local mode). */
export const LOCAL_USER_ID = "local-user";

/** Mastra agent id of the main chat agent. */
export const COPILOT_AGENT_ID = "copilot";

/** Header carrying the web → agent shared secret. */
export const AGENT_SECRET_HEADER = "x-copilot-secret";

export * from "./assessment";
export * from "./job-status";
export * from "./profile";
