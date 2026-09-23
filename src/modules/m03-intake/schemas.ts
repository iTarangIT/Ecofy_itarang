import { z } from "zod";

export const ImportStart = z.object({ fileName: z.string().regex(/\.(xlsx|csv)$/i, "fileName must end with .xlsx or .csv"), sizeBytes: z.number().int().min(1).max(10_485_760) });
export const ImportMapping = z.object({ mapping: z.record(z.string(), z.string()), saveAs: z.string().max(60).optional() });
export const ImportCommit = z.object({ consentAttested: z.literal(true), attestationText: z.string().min(10) });

export const CustomerIn = z.object({
  fullName: z.string().min(2).max(100),
  mobile: z.string().regex(/^[6-9][0-9]{9}$/),
  altMobile: z.string().regex(/^[6-9][0-9]{9}$/).optional(),
  email: z.string().email().optional(),
  customerType: z.enum(["INDIVIDUAL", "BUSINESS"]),
  businessName: z.string().optional(),
  address: z.string().min(3).max(250),
  city: z.string().min(1),
  state: z.string().min(1),
  pincode: z.string().regex(/^[1-9][0-9]{5}$/),
  preferredLanguage: z.string().optional(),
  propertyType: z.string().optional(),
  consentObtained: z.literal(true),
  consentDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  consentSource: z.string().min(1),
});

export const CaseCreate = z.object({
  customer: CustomerIn,
  segment: z.enum(["RESI", "ESS", "CI"]),
  productInterest: z.string().optional(),
  avgMonthlyBillInr: z.number().int().min(0).optional(),
  sanctionedLoadKw: z.number().min(0).optional(),
  existingBackup: z.string().optional(),
  preferredCallTime: z.string().optional(),
  fromEstimateId: z.string().optional(),
});

export type CaseCreateT = z.infer<typeof CaseCreate>;
export type CustomerInT = z.infer<typeof CustomerIn>;
