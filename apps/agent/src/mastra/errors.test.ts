import { describe, expect, it } from "vitest";
import { toClientErrorText } from "./errors";

describe("toClientErrorText", () => {
  it("keeps name, status and first message line only", () => {
    const error = Object.assign(new Error("Free tier users do not have access.\nsecond line"), {
      name: "GatewayInternalServerError",
      statusCode: 403,
      cause: new Error("secret cause"),
    });
    const text = toClientErrorText(error);
    expect(text).toBe("GatewayInternalServerError (HTTP 403): Free tier users do not have access.");
    expect(text).not.toContain("secret cause");
    expect(text).not.toContain("at ");
  });

  it("unwraps a JSON gateway body and strips local paths", () => {
    const error = new Error(
      JSON.stringify({ error: { message: "failed at /Users/me/project/node_modules/x.js" } }),
    );
    expect(toClientErrorText(error)).toBe("Error: failed at [path]");
  });

  it("keeps URLs intact", () => {
    const error = new Error(
      "Upgrade at https://vercel.com/d?to=%2Fai for access. See file:///Users/me/x.js",
    );
    expect(toClientErrorText(error)).toBe(
      "Error: Upgrade at https://vercel.com/d?to=%2Fai for access. See [path]",
    );
  });

  it("handles non-errors and caps length", () => {
    expect(toClientErrorText("boom")).toBe("Unexpected error.");
    expect(toClientErrorText(new Error("x".repeat(1000))).length).toBe(300);
  });
});
