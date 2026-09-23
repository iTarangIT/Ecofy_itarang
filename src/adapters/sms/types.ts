/** Customer SMS = OTP only (acceptance, re-acceptance), on DLT templates (FR-16.3). */
export type SmsRequest = {
  to: string; // +91XXXXXXXXXX
  dltTemplateId: string;
  /** Rendered message text (template variables already substituted). */
  text: string;
  purpose: "ACCEPTANCE_OTP" | "REACCEPTANCE_OTP";
  senderId?: string | null;
};

export interface Sms {
  readonly driver: "dev" | "gupshup";
  send(req: SmsRequest): Promise<{ providerMsgId: string | null; status: "SENT" | "FAILED"; error?: string }>;
}
