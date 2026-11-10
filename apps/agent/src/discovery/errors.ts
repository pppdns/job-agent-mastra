/** How many distinct failure messages a funnel step keeps for the run row. */
export const MAX_ERRORS = 3;

/**
 * Keeps a failure's message (cut to 200 characters, each message once, at most MAX_ERRORS) so
 * /discovery can say why triage or an assessment failed. Messages come from our code or the
 * model gateway; neither carries secrets.
 */
export function noteError(errors: string[], error: unknown): void {
  const message = (error instanceof Error ? error.message : String(error)).slice(0, 200);
  if (errors.length < MAX_ERRORS && !errors.includes(message)) errors.push(message);
}
