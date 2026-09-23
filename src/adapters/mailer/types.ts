/** Staff-only email (M16): invites, resets, device codes, alerts, optional digest. Never to customers. */
export type Mail = { to: string; subject: string; text: string; html?: string; tags?: Record<string, string> };

export interface Mailer {
  readonly driver: "dev" | "ses";
  send(mail: Mail): Promise<{ messageId: string | null }>;
}
