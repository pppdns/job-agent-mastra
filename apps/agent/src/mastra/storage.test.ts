import { describe, expect, it } from "vitest";
import { createStorage } from "./storage";

describe("createStorage", () => {
  it("keeps memory in libSQL and puts observability in DuckDB", async () => {
    const storage = createStorage({ DATABASE_URL: ":memory:" });
    await storage.init();
    const observability = await storage.getStore("observability");
    expect(observability?.constructor.name).toMatch(/DuckDB/);
    expect((await storage.getStore("memory"))?.constructor.name).toMatch(/LibSQL/);
  });
});
