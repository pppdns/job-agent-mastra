import { gateway } from "@ai-sdk/gateway";
import type {
  LanguageModelV4,
  LanguageModelV4Prompt,
  SharedV4ProviderOptions,
} from "@ai-sdk/provider";
import { EXTRACT_MARKER, RESEARCH_TOPIC_LABELS, RESEARCH_TOPICS } from "@copilot/shared";
import { type ModelMessage, simulateReadableStream, wrapLanguageModel } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { env, type ReasoningLevel } from "../env";

export type ModelRole = "main" | "fast";

/** Starts every triage prompt (the mock model answers it with a triage, not an assessment). */
export const TRIAGE_MARKER = "Triage this job posting.";

/**
 * Native AI Gateway provider (not the `vercel/` router string), so provider-specific
 * usage such as cache and reasoning tokens is preserved.
 */
export function getModel(role: ModelRole): LanguageModelV4 {
  const modelId = role === "main" ? env.COPILOT_MODEL : env.COPILOT_FAST_MODEL;
  return env.LLM_MODE === "mock" ? createMockModel(modelId) : gateway(modelId);
}

/** A gateway model, optionally with a fixed reasoning effort on every call. */
export function gatewayModel(modelId: string, reasoning?: ReasoningLevel): LanguageModelV4 {
  const model = gateway(modelId);
  if (!reasoning) return model;
  return wrapLanguageModel({
    model,
    middleware: {
      specificationVersion: "v4",
      transformParams: async ({ params }) => ({
        ...params,
        reasoning: params.reasoning ?? reasoning,
      }),
    },
  });
}

/**
 * Anthropic prompt-cache breakpoint (5-minute TTL). Anthropic caches only up to an explicit
 * marker and AI Gateway adds none by default; other providers ignore it (OpenAI caches
 * implicitly).
 */
export const CACHE_BREAKPOINT = {
  anthropic: { cacheControl: { type: "ephemeral" } },
} satisfies SharedV4ProviderOptions;

/**
 * For agent loops (copilot, researcher): AI Gateway marks the last message and the one before
 * the last user message, so each step reads what the previous step wrote.
 */
export const GATEWAY_AUTO_CACHE = {
  gateway: { caching: "auto" },
} satisfies SharedV4ProviderOptions;

/** A batch prompt: `prefix` is identical for every job in the batch (profile, criteria). */
export type CachedPrompt = { prefix: string; rest: string };

/**
 * One user message with a cache breakpoint after the shared prefix, so every call in a batch
 * after the first reads system prompt + prefix from cache and pays full price only for the job.
 * (Not GATEWAY_AUTO_CACHE: its last-message marker would write each job's unique tail to the
 * cache at 1.25× input price, never to be read.)
 */
export function cachedUserMessage({ prefix, rest }: CachedPrompt): ModelMessage[] {
  return [
    {
      role: "user",
      content: [
        { type: "text", text: prefix, providerOptions: CACHE_BREAKPOINT },
        { type: "text", text: rest },
      ],
    },
  ];
}

/** Model for batch re-scoring and discovery's full assessments (RESCORE_MODEL, default main). */
export const rescoreModelId = () => env.RESCORE_MODEL ?? env.COPILOT_MODEL;

export function getRescoreModel(): LanguageModelV4 {
  const modelId = rescoreModelId();
  return env.LLM_MODE === "mock"
    ? createMockModel(modelId)
    : gatewayModel(modelId, env.RESCORE_REASONING);
}

/**
 * Deterministic model for tests and offline dev. Echoes the latest user text, except:
 * a bare URL or a message starting with "Listing:" calls ingest_listing (when the tool is
 * offered), and a tool result is answered with its status.
 */
export function createMockModel(modelId = "mock"): LanguageModelV4 {
  const usage = (outputTokens: number) => ({
    inputTokens: { total: 10, noCache: 10, cacheRead: 0, cacheWrite: 0 },
    outputTokens: { total: outputTokens, text: outputTokens, reasoning: 0 },
  });
  return new MockLanguageModelV4({
    provider: "mock",
    modelId,
    doGenerate: async (options) => {
      const turn = mockTurn(options);
      return {
        content:
          turn.kind === "tool"
            ? [
                {
                  type: "tool-call",
                  toolCallId: turn.toolCallId,
                  toolName: turn.toolName,
                  input: turn.input,
                },
              ]
            : [{ type: "text", text: turn.text }],
        finishReason:
          turn.kind === "tool"
            ? { unified: "tool-calls", raw: "tool_use" }
            : { unified: "stop", raw: "stop" },
        usage: usage(turn.kind === "text" ? turn.text.split(" ").length : 1),
        warnings: [],
      };
    },
    doStream: async (options) => {
      const turn = mockTurn(options);
      if (turn.kind === "tool") {
        return {
          stream: simulateReadableStream({
            chunks: [
              { type: "stream-start", warnings: [] },
              {
                type: "tool-call",
                toolCallId: turn.toolCallId,
                toolName: turn.toolName,
                input: turn.input,
              },
              {
                type: "finish",
                finishReason: { unified: "tool-calls", raw: "tool_use" },
                usage: usage(1),
              },
            ],
            chunkDelayInMs: 5,
          }),
        };
      }
      const words = turn.text.split(/(?<= )/);
      // "Slow:" replies take ~4.5 s, so e2e can refresh or stop mid-stream.
      const slow = turn.text.startsWith("Mock reply: Slow:");
      return {
        stream: simulateReadableStream({
          chunks: [
            { type: "stream-start", warnings: [] },
            { type: "text-start", id: "t1" },
            ...words.map((delta) => ({ type: "text-delta" as const, id: "t1", delta })),
            { type: "text-end", id: "t1" },
            {
              type: "finish",
              finishReason: { unified: "stop", raw: "stop" },
              usage: usage(words.length),
            },
          ],
          chunkDelayInMs: slow ? 150 : 5,
        }),
      };
    },
  });
}

type MockTurn =
  | { kind: "text"; text: string }
  | { kind: "tool"; toolName: string; input: string; toolCallId: string };

type ToolResultValue = {
  status?: string;
  ok?: boolean;
  error?: string;
  jobId?: string;
  version?: number;
  source?: { id?: string };
  results?: { url: string }[];
  sourceId?: string;
  url?: string;
  claims?: unknown[];
};

/** JSON value of a tool-result part, if any. */
function toolResultValue(part: unknown): ToolResultValue {
  const output = (part as { output?: { type?: string; value?: unknown } } | undefined)?.output;
  return output?.type === "json" && output.value && typeof output.value === "object"
    ? (output.value as ToolResultValue)
    : {};
}

/** Pay copied from a pasted listing ("EUR 70,000 – 80,000"), like a real model would. */
const mockSalary = (text: string) => text.match(/EUR \d[\d,]*(?: – \d[\d,]*)?/)?.[0];

/** Listing facts the mock extractor finds: work mode, location line, EUR/USD pay, languages. */
function mockFacts(prompt: string) {
  const listing = prompt.split("\n\n").slice(3).join("\n\n");
  const line = (re: RegExp) =>
    listing
      .split("\n")
      .find((l) => re.test(l))
      ?.trim() ?? null;
  const remote = line(/\bremote\b/i);
  const hybrid = line(/\bhybrid\b/i);
  const location = listing.match(/^Location: (.+)$/m);
  const client = line(/\bour client\b/i);
  const pay = listing.match(/(EUR|USD) ([\d,]+) – ([\d,]+)/);
  const amount = (s: string | undefined) => Number((s ?? "").replaceAll(",", ""));
  return {
    workMode: hybrid ? "hybrid" : remote ? "remote" : "unclear",
    workModeQuote: hybrid ?? remote,
    remoteScope: /\banywhere\b|\bworldwide\b/i.test(remote ?? "") ? "worldwide" : "unspecified",
    scopeQuote: /\banywhere\b|\bworldwide\b/i.test(remote ?? "") ? remote : null,
    places: location
      ? [{ place: location[1], basis: hybrid ? "office" : "listed", quote: location[0] }]
      : [],
    signals: [],
    openSignals: [],
    officeDays: null,
    salary: pay
      ? {
          min: amount(pay[2]),
          max: amount(pay[3]),
          currency: pay[1],
          period: "year",
          quote: pay[0],
        }
      : null,
    level: null,
    languages: ["TypeScript", "Python", "Go"]
      .filter((name) => new RegExp(`\\b${name}\\b`).test(listing))
      .map((name) => ({ name, required: true, quote: name })),
    roleFocus: [],
    travel: null,
    employmentType: null,
    timezone: null,
    // "Our client" posts: a recruiter with the employer unnamed.
    recruiter: client ? { employer: null, quote: client } : null,
  };
}

const MOCK_ASSESSMENT = (sourceId: string, salary?: string) => ({
  headline: "Mock headline: listing read, pay unknown",
  overview: "Mock assessment of the pasted listing.",
  ...(salary && { salary }),
  fitBasis: "role_only",
  strengths: [
    {
      label: "Listing provided",
      text: "The listing text was provided.",
      evidence: "official",
      sourceIds: [sourceId],
      quote: "Listing",
    },
  ],
  weaknesses: [
    { label: "On-call likely", text: "Mock weakness: on-call is likely.", evidence: "inference" },
  ],
  unknowns: [{ question: "What is the salary?", whyItMatters: "Not stated." }],
  researchTopics: ["business", "business_health"],
  recommendation: { verdict: "investigate_further", rationale: "Mock rationale." },
});

function mockTurn({
  prompt,
  tools,
  responseFormat,
}: {
  prompt: LanguageModelV4Prompt;
  tools?: { name: string }[];
  responseFormat?: { type: string };
}): MockTurn {
  const offered = (name: string) => tools?.some((t) => t.name === name) ?? false;
  const call = (toolName: string, input: unknown): MockTurn => ({
    kind: "tool",
    toolName,
    input: JSON.stringify(input),
    // Unique per turn: AI SDK matches tool results to calls by id.
    toolCallId: `mock-${toolName}-${prompt.length}`,
  });

  // Extractor (structured output): facts read from the listing's own lines.
  if (responseFormat?.type === "json" && lastUserText(prompt).includes(EXTRACT_MARKER)) {
    return { kind: "text", text: JSON.stringify(mockFacts(lastUserText(prompt))) };
  }

  // Triager (structured output): a deterministic score from the posting's title.
  if (responseFormat?.type === "json" && lastUserText(prompt).includes(TRIAGE_MARKER)) {
    const title = lastUserText(prompt).match(/^Title: (.+)$/m)?.[1] ?? "";
    const score = /intern/i.test(title) ? 35 : /founding/i.test(title) ? 88 : 70;
    return {
      kind: "text",
      text: JSON.stringify({
        score,
        reason: `Mock triage of ${title}.`,
        hardConflict: null,
      }),
    };
  }

  // Rescorer (structured output): a with_profile assessment citing the listing source.
  if (responseFormat?.type === "json") {
    const sourceId = lastUserText(prompt).match(/Listing \(source id ([^,)]+)/)?.[1] ?? "";
    // with_profile drafts must cite a profile fact in a fit point (inference).
    const factId = lastUserText(prompt).match(/\[fact:([^\]]+)\]/)?.[1];
    const base = MOCK_ASSESSMENT(sourceId);
    // Without profile facts, fit can't be judged: a role_only assessment (as the rules demand).
    if (!factId) {
      return {
        kind: "text",
        text: JSON.stringify({ ...base, headline: "Mock assessment without a profile" }),
      };
    }
    return {
      kind: "text",
      text: JSON.stringify({
        ...base,
        strengths: [
          ...base.strengths,
          ...(factId
            ? [
                {
                  text: "Mock fit with the profile.",
                  evidence: "inference",
                  profileFactIds: [factId],
                },
              ]
            : []),
        ],
        headline: "Mock re-score against the current profile",
        fitBasis: "with_profile",
        fitLevel: "good",
        recommendation: { verdict: "pursue", rationale: "Mock re-score rationale." },
      }),
    };
  }

  const last = prompt.at(-1);
  if (last?.role === "tool") {
    const part = last.content.find((p) => p.type === "tool-result");
    const value = toolResultValue(part);
    const name = part?.type === "tool-result" ? part.toolName : "tool";
    if (name === "ingest_listing" && value.status === "saved" && value.jobId && value.source?.id) {
      if (offered("save_job_draft")) {
        return call("save_job_draft", {
          jobId: value.jobId,
          assessment: MOCK_ASSESSMENT(value.source.id, mockSalary(lastUserText(prompt))),
        });
      }
    }
    if (name === "web_search" && value.results?.[0]) {
      return call("extract_page", { url: value.results[0].url });
    }
    if (name === "extract_page" && value.sourceId) {
      return call("record_claim", {
        topic: "business",
        text: `Mock finding read from ${value.url}`,
        evidence: "official",
        sourceIds: [value.sourceId],
      });
    }
    if (name === "record_claim" || name === "web_search" || name === "extract_page") {
      return {
        kind: "text",
        text: `Mock research summary (${name} ${value.ok === false ? "failed" : "done"})`,
      };
    }
    if (name === "rescore_jobs") {
      // Small batches come back in full, big ones as counts (the tool's toModelOutput).
      const out = value as { results?: { status: string }[]; saved?: number };
      const saved = out.saved ?? out.results?.filter((r) => r.status === "saved").length ?? 0;
      return { kind: "text", text: `Mock reply: rescore_jobs ${saved} saved` };
    }
    if (name === "research_company") {
      return {
        kind: "text",
        text: `Mock reply: research_company ${value.status} ${value.claims?.length ?? 0} claims`,
      };
    }
    const outcome =
      value.status ??
      (value.ok === false ? `error ${value.error}` : value.version ? `v${value.version}` : "done");
    return { kind: "text", text: `Mock reply: ${name} ${outcome}` };
  }

  // Observational Memory's Observer/Reflector: reply in the format OM parses.
  if (systemText(prompt).startsWith("You are the memory consciousness")) {
    return {
      kind: "text",
      text: "<observations>\n* 🔴 (mock) The user and assistant discussed earlier messages in this chat.\n</observations>",
    };
  }
  const text = lastUserText(prompt);
  if (offered("ingest_listing") && /^https?:\/\/\S+$/.test(text)) {
    return call("ingest_listing", { url: text });
  }
  if (offered("ingest_listing") && text.startsWith("Listing:")) {
    const named = text.match(/^Listing: (.+?) at ([^,.]+)/);
    return call("ingest_listing", {
      fromLatestUserMessage: true,
      ...(named ? { title: named[1], company: named[2]?.trim() } : {}),
    });
  }
  // Researcher run (see research_company): start with one search for the company.
  if (offered("web_search") && text.startsWith("Company:")) {
    const company = text.match(/^Company: (.+)$/m)?.[1] ?? "";
    return call("web_search", { query: `${company} company` });
  }
  if (offered("research_company") && text.startsWith("Research:")) {
    const jobId = latestJobId(prompt);
    const topics = text.slice(9).trim().split(/[ ,]+/).filter(Boolean);
    if (jobId)
      return call("research_company", { jobId, topics: topics.length ? topics : ["business"] });
  }
  // A research button's message (researchRequestText): "Research the company for job <id>: engineering."
  const button = text.match(/^Research the company for job (\S+): (.+)\.$/);
  if (offered("research_company") && button?.[1] && button[2]) {
    const labels = button[2].split(", ");
    const topics = RESEARCH_TOPICS.filter((t) =>
      labels.includes(RESEARCH_TOPIC_LABELS[t].toLowerCase()),
    );
    return call("research_company", { jobId: button[1], topics });
  }
  if (offered("propose_profile_change") && text.startsWith("Remember:")) {
    return call("propose_profile_change", {
      changes: [{ op: "add", kind: "soft_preference", text: text.slice(9).trim() }],
      reason: "The user asked me to remember this.",
    });
  }
  if (offered("updateWorkingMemory") && text.startsWith("For this chat:")) {
    return call("updateWorkingMemory", {
      memory: `# This chat only\n- Local assumptions and exceptions: ${text.slice(14).trim()}\n`,
    });
  }
  // Report what the system prompt carries, so e2e can check what a chat can see.
  if (text === "Profile?") {
    const system = systemText(prompt);
    const version = system.match(/Approved profile \(version (\d+)\)/)?.[1] ?? "?";
    const facts = [...system.matchAll(/^- \[fact:[^\]]+\] (.+)$/gm)].map((m) => m[1]);
    return { kind: "text", text: `Mock reply: profile v${version}: ${facts.join("; ") || "none"}` };
  }
  if (text === "Local?") {
    const local = systemText(prompt).match(
      /Local assumptions and exceptions:[ \t]*(\S[^\n]*)/,
    )?.[1];
    return { kind: "text", text: `Mock reply: local ${local?.trim() || "none"}` };
  }
  if (offered("rescore_jobs") && text.startsWith("Re-score")) {
    const limit = text.match(/limit: "?(\d+|all)"?/)?.[1];
    return call("rescore_jobs", {
      ...(text.startsWith("Re-score all") && { all: true }),
      ...(limit && { limit: limit === "all" ? "all" : Number(limit) }),
    });
  }
  if (text.startsWith("Slow:")) {
    const words = Array.from({ length: 30 }, (_, i) => `w${i + 1}`).join(" ");
    return { kind: "text", text: `Mock reply: Slow: ${words} end.` };
  }
  return { kind: "text", text: `Mock reply: ${text}` };
}

function systemText(prompt: LanguageModelV4Prompt): string {
  return prompt.flatMap((m) => (m.role === "system" ? [m.content] : [])).join("\n");
}

/** jobId from the most recent tool result in the conversation that carries one. */
function latestJobId(prompt: LanguageModelV4Prompt): string | undefined {
  for (const message of [...prompt].reverse()) {
    if (message.role !== "tool") continue;
    for (const part of message.content) {
      const jobId = toolResultValue(part).jobId;
      if (jobId) return jobId;
    }
  }
  return undefined;
}

function lastUserText(prompt: LanguageModelV4Prompt): string {
  const user = prompt.findLast((m) => m.role === "user");
  if (!user || typeof user.content === "string") return "";
  return user.content
    .flatMap((part) => (part.type === "text" ? [part.text] : []))
    .join(" ")
    .trim();
}
