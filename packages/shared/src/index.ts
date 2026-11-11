/** Single local user (see AGENTS.md: single-user local mode). */
export const LOCAL_USER_ID = "local-user";

/** Mastra agent id of the main chat agent. */
export const COPILOT_AGENT_ID = "copilot";

/** Header carrying the web → agent shared secret. */
export const AGENT_SECRET_HEADER = "x-copilot-secret";

/** Batch sizes the re-score buttons offer besides "all" (one model call per job). */
export const RESCORE_BATCH_SIZES = [25, 100, 1000] as const;

/** Batch sizes "Assess more matches" on /discovery offers (one main-model call per job). */
export const ASSESS_BATCH_SIZES = [15, 50, 200] as const;

/** Jobs one re-score batch covers when no limit is given. */
export const DEFAULT_RESCORE_LIMIT = 25;

/** How many jobs a re-score batch covers: a count, or "all" (no cap). */
export type RescoreLimit = number | "all";

export * from "./assessment";
export * from "./job-status";
export * from "./location-block";
export * from "./posted-date";
export * from "./posting";
export * from "./profile";
export * from "./screening";
export * from "./search-settings";
export * from "./sentry";
export * from "./triage";
