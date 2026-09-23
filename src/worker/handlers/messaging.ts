import { eq } from "drizzle-orm";
import { on } from "./registry";
import { mailer, sms } from "@/adapters";
import { schema } from "@/core/db/client";
import { withSystemContext } from "@/core/db/tx";
import { logger } from "@/core/http/logger";

/**
 * job.email.send  payload: { to, subject, text, html? }
 * job.sms.send    payload: { smsMessageId, to, text, dltTemplateId, purpose, senderId? }
 * Both idempotent: an SMS row already SENT/DELIVERED is skipped; email duplicates are tolerated (staff only).
 */
export function registerMessagingHandlers() {
  on("job.email.send", async (e) => {
    const p = e.payload as unknown as { to: string; subject: string; text: string; html?: string };
    const m = await mailer();
    await m.send({ to: p.to, subject: p.subject, text: p.text, html: p.html });
  });

  on("job.sms.send", async (e) => {
    const p = e.payload as unknown as { smsMessageId: number; to: string; text: string; dltTemplateId: string; purpose: "ACCEPTANCE_OTP" | "REACCEPTANCE_OTP"; senderId?: string | null };
    await withSystemContext(e.tenantId, async (tx) => {
      const rows = await tx.select().from(schema.smsMessages).where(eq(schema.smsMessages.id, p.smsMessageId)).limit(1);
      const row = rows[0];
      if (!row) return;
      if (row.status === "SENT" || row.status === "DELIVERED") return;
      const s = await sms();
      const r = await s.send({ to: p.to, text: p.text, dltTemplateId: p.dltTemplateId, purpose: p.purpose, senderId: p.senderId ?? null });
      await tx
        .update(schema.smsMessages)
        .set({ status: r.status, providerMsgId: r.providerMsgId, sentAt: r.status === "SENT" ? new Date() : null })
        .where(eq(schema.smsMessages.id, p.smsMessageId));
      if (r.status === "FAILED") logger.error({ smsMessageId: p.smsMessageId, error: r.error }, "sms send failed");
    });
  });
}
