import fs from "node:fs/promises";
import path from "node:path";
import { config } from "@/core/config";
import { logger } from "@/core/http/logger";
import type { Mail, Mailer } from "./types";

/** Writes each mail to .data/mail/<timestamp>-<to>.json and logs the subject. Codes/links are readable there. */
export class DevMailer implements Mailer {
  readonly driver = "dev" as const;
  async send(mail: Mail) {
    const dir = path.resolve(process.cwd(), config().DEV_MAIL_DIR);
    await fs.mkdir(dir, { recursive: true });
    const id = `${Date.now()}-${mail.to.replace(/[^a-z0-9]/gi, "_")}`;
    await fs.writeFile(path.join(dir, `${id}.json`), JSON.stringify({ ...mail, sentAt: new Date().toISOString() }, null, 2));
    logger.info({ to: mail.to, subject: mail.subject, file: `${config().DEV_MAIL_DIR}/${id}.json` }, "[dev-mail] sent");
    return { messageId: id };
  }
}
