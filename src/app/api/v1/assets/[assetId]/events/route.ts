import { z } from "zod";
import { route } from "@/core/http/route";
import { created } from "@/core/http/envelope";
import { recordAssetEvent } from "@/modules/m13-asset/service";

const AssetEvent = z.object({ type: z.enum(["BUYBACK", "REDEPLOYED", "CLOSED"]), onDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), note: z.string().max(500).optional() });
export const POST = route({ roles: ["ECOFY_ADMIN"], body: AssetEvent }, async ({ ctx, params, body }) => created(await recordAssetEvent(ctx, params.assetId, body)));
