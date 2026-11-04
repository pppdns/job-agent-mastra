/**
 * Why a tool call failed, or undefined if it didn't. Covers our tools' rule errors
 * (`{ ok: false, error }`) and Mastra's input-validation results (`{ error: true, message }`,
 * returned as output, not as a tool error), keeping only the validation lines of the latter.
 */
export function toolFailure(output: unknown): string | undefined {
  if (typeof output !== "object" || output === null) return;
  const o = output as { ok?: unknown; error?: unknown; message?: unknown };
  if (o.ok === false) return typeof o.error === "string" ? o.error : "The tool call failed.";
  if (o.error === true) {
    const message = typeof o.message === "string" ? o.message : "";
    const issues = message
      .split("\n\nProvided arguments")[0]
      ?.split("\n")
      .filter((l) => l.startsWith("- "))
      .map((l) => l.slice(2));
    return issues?.length ? `Invalid input: ${issues.join("; ")}` : "Invalid tool input.";
  }
}
