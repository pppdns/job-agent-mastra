import { resolve } from "node:path";
import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  resolve: { alias: { "@": resolve(import.meta.dirname, "src") } },
  test: {
    // Playwright owns e2e/; Vitest runs unit tests only.
    exclude: [...configDefaults.exclude, "e2e/**"],
  },
});
