import { defineConfig } from "drizzle-kit";
import { resolveDatabaseUrl } from "./src/paths";

export default defineConfig({
  dialect: "sqlite",
  schema: "./src/schema.ts",
  out: "./drizzle",
  dbCredentials: { url: resolveDatabaseUrl() },
  // Mastra owns the non-prefixed tables in the same database file.
  tablesFilter: ["app_*"],
});
