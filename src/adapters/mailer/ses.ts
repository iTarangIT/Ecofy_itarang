import { SESClient, SendEmailCommand } from "@aws-sdk/client-ses";
import { config } from "@/core/config";
import type { Mail, Mailer } from "./types";

export class SesMailer implements Mailer {
  readonly driver = "ses" as const;
  private readonly client = new SESClient({ region: config().AWS_REGION });
  async send(mail: Mail) {
    const r = await this.client.send(
      new SendEmailCommand({
        Source: config().SES_FROM,
        Destination: { ToAddresses: [mail.to] },
        Message: {
          Subject: { Data: mail.subject, Charset: "UTF-8" },
          Body: { Text: { Data: mail.text, Charset: "UTF-8" }, ...(mail.html ? { Html: { Data: mail.html, Charset: "UTF-8" } } : {}) },
        },
      }),
    );
    return { messageId: r.MessageId ?? null };
  }
}
