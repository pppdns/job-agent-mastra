import type { HttpJson } from "./discovery/sources/http";
import { env } from "./env";

// Emails to the user via Resend (RESEND_API_KEY, DIGEST_TO, DIGEST_FROM): the discovery digest
// and the daily closed-listings email. Callers build subject, text and HTML; every value put
// into the HTML goes through escapeHtml.

const RESEND_URL = "https://api.resend.com/emails";

export const escapeHtml = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] ?? c,
  );

export type Email = { subject: string; text: string; html: string };

export type EmailConfig = { apiKey?: string; to?: string; from: string; baseUrl: string };

/** The email settings from the environment. */
export const emailConfig = (): EmailConfig => ({
  apiKey: env.RESEND_API_KEY,
  to: env.DIGEST_TO,
  from: env.DIGEST_FROM,
  baseUrl: env.APP_BASE_URL,
});

/** Why email can't be sent, or null when it is configured. */
export function emailNotConfigured(config: EmailConfig): string | null {
  if (config.apiKey && config.to) return null;
  return `email not configured (${config.apiKey ? "DIGEST_TO" : "RESEND_API_KEY"} is not set)`;
}

/** Sends one email to `config.to` (comma-separated). Throws on failure; check config first. */
export async function sendEmail(http: HttpJson, config: EmailConfig, email: Email): Promise<void> {
  await http(new URL(RESEND_URL), {
    method: "POST",
    headers: { authorization: `Bearer ${config.apiKey}` },
    body: {
      from: config.from,
      to: (config.to ?? "").split(",").map((s) => s.trim()),
      subject: email.subject,
      text: email.text,
      html: email.html,
    },
  });
}
