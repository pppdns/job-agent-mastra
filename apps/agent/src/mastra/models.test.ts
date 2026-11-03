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
});
