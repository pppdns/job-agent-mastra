import { describe, expect, it } from "vitest";
import { sanitizeChunk } from "./chat";

describe("sanitizeChunk", () => {
  it("turns an input-less tool-input-available into tool-input-error", () => {
    expect(
      sanitizeChunk({
        type: "tool-input-available",
        toolCallId: "t1",
        toolName: "save_job_draft",
      } as never),
    ).toMatchObject({
      type: "tool-input-error",
      toolCallId: "t1",
      input: {},
      errorText: expect.any(String),
    });
  });

  it("passes other chunks through", () => {
    const chunk = {
      type: "tool-input-available",
      toolCallId: "t1",
      toolName: "x",
      input: { a: 1 },
    } as const;
    expect(sanitizeChunk(chunk)).toBe(chunk);
  });
});
