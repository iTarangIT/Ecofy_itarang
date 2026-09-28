import { z } from "zod";

const DATE = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

/** GET /emi-tracker filters (CONFLICTS #32). All apply to the asset's latest EMI status. */
export const EmiTrackerQuery = z.object({
  q: z.string().max(100).optional(),
  /** comma list of emi_state values; `NONE` = assets with no EMI status yet */
  state: z.string().max(120).optional(),
  /** comma list of asset lifecycle values */
  status: z.string().max(60).optional(),
  asOfFrom: DATE.optional(),
  asOfTo: DATE.optional(),
  city: z.string().max(60).optional(),
  limit: z.coerce.number().int().min(1).max(5000).optional(),
});

/** POST /emi-tracker/upload: small sheets (≤ 5,000 rows) travel inline as base64; no presigned upload needed. */
export const EmiUpload = z.object({
  fileName: z.string().regex(/\.(xlsx|csv)$/i, "fileName must end with .xlsx or .csv"),
  contentBase64: z.string().min(1).max(6_000_000),
});
