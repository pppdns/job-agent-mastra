import { EXTRACT_INSTRUCTIONS } from "@copilot/shared";
import { Agent } from "@mastra/core/agent";
import { getModel } from "../models";

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
  instructions: EXTRACT_INSTRUCTIONS,
  model: () => getModel("fast"),
});
