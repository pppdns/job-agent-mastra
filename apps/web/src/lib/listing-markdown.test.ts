import { describe, expect, it } from "vitest";
import { withoutImages } from "./listing-markdown";

describe("withoutImages", () => {
  it("drops images, including ones wrapped in links, and keeps other links", () => {
    const md =
      "![Logo](https://x.test/a.png)\n[![Flex]()](https://x.test/c) [Apply](https://x.test/apply)";
    expect(withoutImages(md)).toBe("\n [Apply](https://x.test/apply)");
  });
});
