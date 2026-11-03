import { generateText, streamText } from "ai";
import { describe, expect, it } from "vitest";
import { createMockModel } from "./models";

describe("mock model", () => {
  it("echoes the latest user text when generating", async () => {
    const { text } = await generateText({ model: createMockModel(), prompt: "hello" });
    expect(text).toBe("Mock reply: hello");
  });

  it("streams the same reply", async () => {
    const result = streamText({ model: createMockModel(), prompt: "hello world" });
    expect(await result.text).toBe("Mock reply: hello world");
  });

  it("calls ingest_listing for a bare URL when the tool is offered", async () => {
    const model = createMockModel();
    const result = await model.doGenerate({
      prompt: [{ role: "user", content: [{ type: "text", text: "https://example.com/job" }] }],
      tools: [{ type: "function", name: "ingest_listing", inputSchema: {} }],
    });
    expect(result.content).toEqual([
      expect.objectContaining({ type: "tool-call", toolName: "ingest_listing" }),
    ]);
  });

  it("does not call tools when none are offered (e.g. title generation)", async () => {
    const { text } = await generateText({ model: createMockModel(), prompt: "https://x.com/j" });
    expect(text).toBe("Mock reply: https://x.com/j");
  });
});
