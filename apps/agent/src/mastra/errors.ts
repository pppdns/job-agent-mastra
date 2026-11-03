const MAX_LENGTH = 300;

/**
 * Client-safe error summary for streamed responses: name, HTTP status and the first line
 * of the message only. Stacks, causes, request bodies and local paths stay server-side.
 */
export function toClientErrorText(error: unknown): string {
  if (!(error instanceof Error)) return "Unexpected error.";
  const status = (error as { statusCode?: unknown }).statusCode;
  const firstLine = (parseGatewayMessage(error.message) ?? error.message).split("\n")[0] ?? "";
  const withoutPaths = firstLine
    .replace(/file:\/\/\S+/g, "[path]")
    .replace(/(?<![\w:/])\/(?:[\w.@+-]+\/)+[\w.@+-]*/g, "[path]");
  const prefix = typeof status === "number" ? `${error.name} (HTTP ${status})` : error.name;
  return `${prefix}: ${withoutPaths}`.slice(0, MAX_LENGTH);
}

/** Gateway errors sometimes wrap a JSON body as their message. */
function parseGatewayMessage(message: string): string | undefined {
  try {
    const body = JSON.parse(message) as { error?: { message?: unknown } };
    return typeof body.error?.message === "string" ? body.error.message : undefined;
  } catch {
    return undefined;
  }
}
