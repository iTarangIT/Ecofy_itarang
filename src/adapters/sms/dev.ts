import fs from "node:fs/promises";
import path from "node:path";
import { config } from "@/core/config";
import { logger } from "@/core/http/logger";
import type { Sms, SmsRequest } from "./types";

/** Writes each SMS to .data/sms/<timestamp>-<mobile>.json (the OTP is readable there in development). */
export class DevSms implements Sms {
  readonly driver = "dev" as const;
  async send(req: SmsRequest) {
    const dir = path.resolve(process.cwd(), config().DEV_SMS_DIR);
    await fs.mkdir(dir, { recursive: true });
    const id = `${Date.now()}-${req.to.replace(/\D/g, "")}`;
    await fs.writeFile(path.join(dir, `${id}.json`), JSON.stringify({ ...req, sentAt: new Date().toISOString() }, null, 2));
    logger.info({ to: req.to, purpose: req.purpose, file: `${config().DEV_SMS_DIR}/${id}.json` }, "[dev-sms] sent");
    return { providerMsgId: id, status: "SENT" as const };
  }
}
