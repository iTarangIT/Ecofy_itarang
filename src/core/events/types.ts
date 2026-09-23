/** Event catalogue — BRD §8.1. Job names (worker) are prefixed `job.`. */
export const EVENT_TYPES = [
  "case.created", "case.reopened", "case.temperature_set", "case.pushed", "case.assigned", "case.returned",
  "case.stage_changed", "case.closed",
  "activity.logged", "appointment.scheduled", "appointment.completed",
  "assessment.saved", "assessment.confirmed",
  "calc.release_submitted", "calc.release_approved", "calc.release_rejected",
  "eligibility.requested", "eligibility.decided",
  "quote.uploaded", "quote.expired", "offer.composed",
  "otp.sent", "otp.verified", "otp.failed", "file.locked",
  "financing.decided", "financier.routed", "reacceptance.triggered",
  "installation.status_changed", "downpayment.recorded", "disbursement.recorded",
  "asset.activated", "emi.updated", "asset.event_recorded",
  "withdrawal.requested", "withdrawal.confirmed",
  "document.uploaded", "document.purged",
  "import.committed", "setting.changed", "list.changed", "seat.limit_changed", "export.generated",
  "user.invited", "user.deactivated", "notification.created",
  // jobs requested through the outbox (so both queue drivers share one path)
  "job.import.process", "job.email.send", "job.sms.send",
] as const;

export type EventType = (typeof EVENT_TYPES)[number];

export type OutboxEvent = {
  id: number;
  tenantId: string;
  eventType: EventType;
  aggregateId: string;
  payload: Record<string, unknown> & { tenantId: string; at: string };
  createdAt: Date;
};
