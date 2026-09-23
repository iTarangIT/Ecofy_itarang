import { z } from "zod";

export const ActivityCreate = z.object({
  type: z.enum(["CALL", "REMARK", "COMMENT", "FOLLOW_UP"]),
  callOutcome: z.enum(["CONNECTED", "NO_ANSWER", "BUSY", "SWITCHED_OFF", "WRONG_NUMBER", "CALL_BACK"]).optional(),
  note: z.string().max(2000).optional(),
  nextFollowUpAt: z.string().datetime({ offset: true }).optional(),
});
export const AppointmentCreate = z.object({
  meetingType: z.string().min(1),
  scheduledAt: z.string().datetime({ offset: true }),
  bookingRemarks: z.string().max(1000).optional(),
  epcPartnerId: z.string().uuid().optional(),
});
export const AppointmentUpdate = z.object({
  action: z.enum(["RESCHEDULE", "COMPLETE", "NO_SHOW", "CANCEL", "EPC_FEEDBACK"]),
  scheduledAt: z.string().datetime({ offset: true }).optional(),
  actualAt: z.string().datetime({ offset: true }).optional(),
  meetingRemarks: z.string().min(3).max(2000).optional(),
  outcomeReason: z.string().min(3).optional(),
  epcFeedback: z.string().max(2000).optional(),
});
