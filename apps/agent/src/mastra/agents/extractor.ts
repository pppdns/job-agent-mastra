import { EXTRACT_INSTRUCTIONS } from "@copilot/shared";
import { Agent } from "@mastra/core/agent";
import { CACHE_BREAKPOINT, getModel } from "../models";

export const EXTRACTOR_AGENT_ID = "extractor";

/**
 * Listing facts: one cheap structured call per listing (fast model, no tools, no memory). It
 * only copies what the listing states, with quotes; app code verifies the quotes and decides
 * what the facts mean for the person (`verifyFacts`, `decideEligibility`).
 */
export const extractorAgent = new Agent({
  id: EXTRACTOR_AGENT_ID,
  name: "Listing fact extractor",
  description: "Extracts work mode, places, pay, level, languages and focus from one listing.",
  // The prompt is all listing, so the cached prefix is the instructions (and output schema).
  instructions: {
    role: "system",
    content: EXTRACT_INSTRUCTIONS,
    providerOptions: CACHE_BREAKPOINT,
  },
  model: () => getModel("fast"),
});
