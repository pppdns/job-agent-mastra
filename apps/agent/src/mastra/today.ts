/** Today's local date for system prompts, so agents can tell how old a source is. */
export function todayLine(now: Date = new Date()): string {
  const date = now.toLocaleDateString("en-CA"); // YYYY-MM-DD, local time
  const weekday = now.toLocaleDateString("en-US", { weekday: "long" });
  return `Today is ${date} (${weekday}). Use it to judge how old listings, news and reviews are.`;
}
