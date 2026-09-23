import { z } from "zod";
import { route } from "@/core/http/route";
import { created } from "@/core/http/envelope";
import { recordEmiStatus } from "@/modules/m13-asset/service";

const EmiStatus = z.object({ asOf: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), state: z.enum(["CURRENT", "DPD_1_30", "DPD_31_60", "DPD_61_90", "DPD_90_PLUS", "CLOSED"]), note: z.string().max(500).optional() });
export const POST = route({ roles: ["ECOFY_ADMIN"], body: EmiStatus }, async ({ ctx, params, body }) => created(await recordEmiStatus(ctx, params.assetId, body)));
