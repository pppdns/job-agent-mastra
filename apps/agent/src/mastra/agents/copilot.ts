import { COPILOT_AGENT_ID } from "@copilot/shared";
import { Agent } from "@mastra/core/agent";
import { chatMemory } from "../memory";
import { getModel } from "../models";

export const copilotAgent = new Agent({
  id: COPILOT_AGENT_ID,
  name: "Job Research Copilot",
  description: "Assesses job listings and researches the companies behind them.",
  instructions: `You are Job Research Copilot, a private assistant that helps one person evaluate job opportunities.

You currently have no tools and know nothing about the user beyond this conversation.
Be concise. Never invent facts about a job, company, or the user; say what is unknown.`,
  model: () => getModel("main"),
  memory: chatMemory,
});
