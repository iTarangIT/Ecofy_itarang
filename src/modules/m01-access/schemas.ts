import { z } from "zod";
import { ROLES } from "@/core/auth/rbac";

export const SessionRegister = z.object({
  /** Additive to the OpenAPI `{}` body: the login page posts the Supabase tokens here and discards them. */
  accessToken: z.string().min(20).optional(),
  refreshToken: z.string().min(10).optional(),
});
export const DeviceVerify = z.object({ code: z.string().regex(/^[0-9]{6}$/) });
export const UserInvite = z.object({
  fullName: z.string().min(2).max(100),
  email: z.string().email(),
  mobile: z.string().regex(/^[6-9][0-9]{9}$/).optional(),
  role: z.enum(ROLES),
});
export const UserPatch = z.object({
  fullName: z.string().min(2).max(100).optional(),
  status: z.enum(["ACTIVE", "DEACTIVATED"]).optional(),
  reason: z.string().max(500).optional(),
});
export const SeatLimitPatch = z.object({ seatLimit: z.number().int().min(0).max(50), reason: z.string().min(3) });
export const Reason = z.object({ reason: z.string().min(3).max(500) });
export const Note = z.object({ note: z.string().max(1000).optional() });
export const PageQuery = z.object({ cursor: z.string().optional(), limit: z.coerce.number().int().min(1).max(100).optional() });

export type SessionRegisterT = z.infer<typeof SessionRegister>;
export type UserInviteT = z.infer<typeof UserInvite>;
export type UserPatchT = z.infer<typeof UserPatch>;
