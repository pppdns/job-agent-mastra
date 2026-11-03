import type { MastraDBMessage } from "@mastra/core/agent/message-list";
import { describe, expect, it } from "vitest";
import { latestUserText } from "./ingest-listing";

const message = (role: "user" | "assistant", text: string) =>
  ({
    id: text,
    role,
    createdAt: new Date(),
    content: { format: 2, parts: [{ type: "text", text }] },
  }) as MastraDBMessage;

describe("latestUserText", () => {
  it("returns the newest user message, not assistant text", () => {
    const messages = [
      message("user", "old listing"),
      message("assistant", "reply"),
      message("user", "pasted listing"),
      message("assistant", "thinking"),
    ];
    expect(latestUserText(messages)).toBe("pasted listing");
  });

  it("is empty without user messages", () => {
    expect(latestUserText([message("assistant", "hi")])).toBe("");
  });
});
