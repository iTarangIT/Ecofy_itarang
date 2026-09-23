import { z } from "zod";

export const OtpVerify = z.object({ code: z.string().regex(/^[0-9]{6}$/) });
export const Reacceptance = z.object({ decisionId: z.string().uuid() });
