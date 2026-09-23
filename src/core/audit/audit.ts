import { schema } from "@/core/db/client";
import { actorOf, tenantOf, isRequestContext, type ActorContext } from "@/core/http/context";

export type AuditInput = {
  action: string; // e.g. case.assign, export.generate
  entityType: string;
  entityId: string;
  caseId?: string | null;
  before?: unknown;
  after?: unknown;
  reason?: string | null;
};

/** FR-18.1: every state change, assignment, value, setting, export and login — in the same transaction. */
export async function audit(ctx: ActorContext, input: AuditInput) {
  const actor = actorOf(ctx);
  await ctx.tx.insert(schema.auditLog).values({
    tenantId: tenantOf(ctx),
    actorId: actor.id,
    actorRole: actor.role,
    action: input.action,
    entityType: input.entityType,
    entityId: String(input.entityId),
    caseId: input.caseId ?? null,
    before: input.before === undefined ? null : (input.before as object),
    after: input.after === undefined ? null : (input.after as object),
    reason: input.reason ?? null,
    ip: isRequestContext(ctx) ? ctx.ip : null,
    userAgent: isRequestContext(ctx) ? ctx.userAgent : null,
  });
}
