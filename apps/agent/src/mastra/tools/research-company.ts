import { RESEARCH_TOPICS } from "@copilot/shared";
import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { runResearch } from "../../research/run";
import { webProviders, webResolver } from "../../web/active";
import { getAppDb } from "../app-db";

export const researchCompanyTool = createTool({
  id: "research_company",
  description:
    "Research the company behind a saved job on 1–3 topics, within a fixed time/cost/tool " +
    "budget. Only when the user asks for deeper research. Returns recorded claims with " +
    "evidence class, sources and dates; partial results if the budget ran out.",
  inputSchema: z.object({
    jobId: z.string().min(1).max(64),
    topics: z.array(z.enum(RESEARCH_TOPICS)).min(1).max(3),
    questions: z.array(z.string().trim().min(3).max(200)).max(5).default([]),
  }),
  execute: async (input, context) =>
    runResearch(input, {
      db: await getAppDb(),
      web: webProviders(),
      resolve: webResolver(),
      threadId: context?.agent?.threadId,
      signal: context?.abortSignal,
      emit: (data) => context?.writer?.custom({ type: "data-research-progress", data }),
    }),
});
