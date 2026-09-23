import { config } from "@/core/config";
import type { Storage } from "./storage/types";
import type { Mailer } from "./mailer/types";
import type { Sms } from "./sms/types";
import type { Queue } from "./queue/types";

/** Driver selection by environment. Each adapter is constructed lazily and once per process. */
let storageInst: Storage | undefined;
let mailerInst: Mailer | undefined;
let smsInst: Sms | undefined;
let queueInst: Queue | undefined;

export async function storage(): Promise<Storage> {
  if (storageInst) return storageInst;
  if (config().STORAGE_DRIVER === "s3") storageInst = new (await import("./storage/s3")).S3Storage();
  else storageInst = new (await import("./storage/localFs")).LocalFsStorage();
  return storageInst;
}

export async function mailer(): Promise<Mailer> {
  if (mailerInst) return mailerInst;
  if (config().MAIL_DRIVER === "ses") mailerInst = new (await import("./mailer/ses")).SesMailer();
  else mailerInst = new (await import("./mailer/dev")).DevMailer();
  return mailerInst;
}

export async function sms(): Promise<Sms> {
  if (smsInst) return smsInst;
  if (config().SMS_DRIVER === "gupshup") smsInst = new (await import("./sms/gupshup")).GupshupSms();
  else smsInst = new (await import("./sms/dev")).DevSms();
  return smsInst;
}

export async function queue(): Promise<Queue> {
  if (queueInst) return queueInst;
  if (config().QUEUE_DRIVER === "bullmq") queueInst = new (await import("./queue/bullmq")).BullMqQueue();
  else queueInst = new (await import("./queue/inline")).InlineQueue();
  return queueInst;
}

/** Test helper */
export function resetAdapters() {
  storageInst = undefined; mailerInst = undefined; smsInst = undefined; queueInst = undefined;
}
