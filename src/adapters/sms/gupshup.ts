import { config } from "@/core/config";
import type { Sms, SmsRequest } from "./types";

/**
 * Gupshup SMS (DLT). Env: GUPSHUP_API_KEY, GUPSHUP_APP_NAME, GUPSHUP_SOURCE (sender id / number).
 * Uses the Enterprise SMS "SendMessage" endpoint with the DLT template id.
 */
export class GupshupSms implements Sms {
  readonly driver = "gupshup" as const;
  async send(req: SmsRequest) {
    const c = config();
    if (!c.GUPSHUP_API_KEY || !c.GUPSHUP_SOURCE) return { providerMsgId: null, status: "FAILED" as const, error: "gupshup_not_configured" };
    const body = new URLSearchParams({
      method: "SendMessage",
      send_to: req.to.replace(/^\+/, ""),
      msg: req.text,
      msg_type: "TEXT",
      userid: c.GUPSHUP_APP_NAME ?? "",
      auth_scheme: "plain",
      password: c.GUPSHUP_API_KEY,
      v: "1.1",
      format: "text",
      mask: req.senderId ?? c.GUPSHUP_SOURCE,
      dltTemplateId: req.dltTemplateId,
    });
    const r = await fetch("https://enterprise.smsgupshup.com/GatewayAPI/rest", { method: "POST", body, headers: { "Content-Type": "application/x-www-form-urlencoded" } });
    const text = await r.text();
    // Response: "success | 919999999999 | <msgid>" or "error | ..."
    if (!r.ok || !text.toLowerCase().startsWith("success")) return { providerMsgId: null, status: "FAILED" as const, error: text.slice(0, 200) };
    const id = text.split("|").map((s) => s.trim())[2] ?? null;
    return { providerMsgId: id, status: "SENT" as const };
  }
}
