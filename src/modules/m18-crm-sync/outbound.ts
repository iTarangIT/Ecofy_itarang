import { and, eq, lte, sql } from "drizzle-orm";
import { schema } from "@/core/db/client";
import { config } from "@/core/config";
import { withSystemContext } from "@/core/db/tx";
import { logger } from "@/core/http/logger";
import type { OutboxEvent } from "@/core/events/types";
import { caseOut, loadCase } from "@/modules/m04-qualify/caseView";
import { sign, SIGNATURE_HEADER, EVENT_ID_HEADER } from "@/core/auth/hmac";
import { SYSTEM, crmEventFor } from "./events";

/**
 * Ecofy → iTarang CRM (docs/CONFLICTS.md #24, contract in docs/ITARANG_CRM_SYNC.md).
 * The outbox handler only writes an `integration_deliveries` row (no network), so a slow or down CRM
 * never blocks the outbox relay; `deliverDue` sends due rows with back-off, oldest first per case.
 */
export const MAX_ATTEMPTS = 12; // ~ 10 s … 1 h back-off, roughly 6 hours in total
const TIMEOUT_MS = 10_000;

export function outboundEnabled() {
  const c = config();
  return Boolean(c.ITARANG_CRM_URL && c.ITARANG_CRM_SECRET);
}

type CaseView = Awaited<ReturnType<typeof caseOut>>[number];

/** The lead as the CRM sees it: case + customer, no money (financing values never leave their tables). */
function leadPayload(c: CaseView, crmLeadId: string | null) {
  const cu = c.customer;
  return {
    ecofyCaseId: c.id,
    caseNo: c.caseNo,
    version: c.version,
    stage: c.stage,
    subStatus: c.subStatus,
    segment: c.segment,
    temperature: c.temperature,
    source: c.source,
    owner: c.owner,
    qualifiedByName: c.qualifiedByName,
    queueEnteredAt: c.queueEnteredAt,
    productInterest: c.productInterest,
    avgMonthlyBillInr: c.avgMonthlyBillInr,
    sanctionedLoadKw: c.sanctionedLoadKw,
    existingBackup: c.existingBackup,
    preferredCallTime: c.preferredCallTime,
    closureReason: c.closureReason,
    customer: cu
      ? { fullName: cu.fullName, mobile: cu.mobile, altMobile: cu.altMobile, email: cu.email ?? null, customerType: cu.customerType, businessName: cu.businessName, address: cu.address ?? null, city: cu.city, state: cu.state, pincode: cu.pincode, preferredLanguage: cu.preferredLanguage, propertyType: cu.propertyType }
      : null,
    ecofyUrl: `${config().APP_BASE_URL.replace(/\/$/, "")}/cases/${c.id}`,
    crmLeadId,
  };
}

/** Outbox handler body: turns one Ecofy event into one pending delivery (idempotent per outbox id). */
export async function enqueueFromEvent(e: OutboxEvent, now: Date): Promise<boolean> {
  const type = crmEventFor(e);
  if (!type || !outboundEnabled()) return false;
  return withSystemContext(e.tenantId, async (tx) => {
    const d = schema.integrationDeliveries;
    if (type === "lead.stage_changed") {
      // only cases that were handed to iTarang are CRM leads
      const pushed = await tx.select({ id: d.id }).from(d).where(and(eq(d.tenantId, e.tenantId), eq(d.system, SYSTEM), eq(d.caseId, e.aggregateId), eq(d.eventType, "lead.pushed"))).limit(1);
      if (!pushed[0]) return false;
    }
    const row = await loadCase(tx, e.tenantId, e.aggregateId);
    if (!row) return false;
    const [view] = await caseOut(tx, e.tenantId, "ITARANG_ADMIN", [row], { now });
    const l = schema.integrationLinks;
    const link = (await tx.select({ externalId: l.externalId }).from(l).where(and(eq(l.tenantId, e.tenantId), eq(l.system, SYSTEM), eq(l.caseId, row.id))).limit(1))[0];
    const tenant = (await tx.select({ code: schema.tenants.code }).from(schema.tenants).where(eq(schema.tenants.id, e.tenantId)).limit(1))[0];
    const p = e.payload;
    const body = {
      eventId: `ecofy:${tenant?.code ?? e.tenantId}:${e.id}`,
      type,
      occurredAt: p.at,
      source: "ECOFY",
      tenant: tenant?.code ?? null,
      ...(type === "lead.stage_changed"
        ? { change: { from: p.from ?? null, to: p.to ?? null, subStatus: p.subStatus ?? null, reason: (p.closureReason ?? p.reasonCode ?? null) as string | null } }
        : {}),
      lead: leadPayload(view, link?.externalId ?? null),
    };
    const ins = await tx.insert(d).values({ tenantId: e.tenantId, system: SYSTEM, outboxEventId: e.id, eventType: type, caseId: row.id, body }).onConflictDoNothing().returning({ id: d.id });
    return ins.length > 0;
  });
}

function backoffMs(attempts: number) {
  return Math.min(10_000 * 2 ** (attempts - 1), 3600_000);
}

export type DeliverResult = { sent: number; retried: number; dead: number };

/**
 * Sends due PENDING rows. A row waits while an older PENDING row of the same case exists, so the CRM
 * sees each lead's events in order. 2xx → SENT (and `crmLeadId` from the response is linked);
 * anything else → retry with back-off, DEAD after MAX_ATTEMPTS (re-queue by setting status = 'PENDING').
 */
export async function deliverDue(tenantId: string, opts: { now?: () => Date; fetchImpl?: typeof fetch; batch?: number } = {}): Promise<DeliverResult> {
  const res: DeliverResult = { sent: 0, retried: 0, dead: 0 };
  if (!outboundEnabled()) return res;
  const { ITARANG_CRM_URL: url, ITARANG_CRM_SECRET: secret } = config() as { ITARANG_CRM_URL: string; ITARANG_CRM_SECRET: string };
  const now = opts.now ?? (() => new Date());
  const doFetch = opts.fetchImpl ?? fetch;
  const d = schema.integrationDeliveries;
  return withSystemContext(tenantId, async (tx) => {
    const rows = await tx
      .select()
      .from(d)
      .where(and(
        eq(d.tenantId, tenantId), eq(d.system, SYSTEM), eq(d.status, "PENDING"), lte(d.nextAttemptAt, now()),
        sql`not exists (select 1 from integration_deliveries p where p.tenant_id = ${d.tenantId} and p.system = ${d.system} and p.case_id = ${d.caseId} and p.status = 'PENDING' and p.id < ${d.id})`,
      ))
      .orderBy(d.id)
      .limit(opts.batch ?? 10)
      .for("update", { skipLocked: true });
    for (const r of rows) {
      const raw = JSON.stringify(r.body);
      const eventId = (r.body as { eventId: string }).eventId;
      let status: number | null = null;
      let error: string | null = null;
      let reply: { crmLeadId?: unknown } | null = null;
      try {
        const resp = await doFetch(url, {
          method: "POST",
          headers: { "content-type": "application/json", [SIGNATURE_HEADER]: sign(secret, raw, now()), [EVENT_ID_HEADER]: eventId },
          body: raw,
          signal: AbortSignal.timeout(TIMEOUT_MS),
        });
        status = resp.status;
        const text = await resp.text();
        if (resp.ok) {
          try { reply = JSON.parse(text); } catch { reply = null; }
        } else error = text.slice(0, 500);
      } catch (err) {
        error = String(err).slice(0, 500);
      }
      const attempts = r.attempts + 1;
      if (status !== null && status >= 200 && status < 300) {
        await tx.update(d).set({ status: "SENT", attempts, lastStatus: status, lastError: null, sentAt: now() }).where(eq(d.id, r.id));
        const crmLeadId = reply?.crmLeadId;
        if (r.caseId && (typeof crmLeadId === "string" || typeof crmLeadId === "number") && String(crmLeadId).length) {
          await tx.insert(schema.integrationLinks).values({ tenantId, system: SYSTEM, caseId: r.caseId, externalId: String(crmLeadId), linkedAt: now() }).onConflictDoNothing();
        }
        res.sent++;
      } else {
        const dead = attempts >= MAX_ATTEMPTS;
        await tx.update(d).set({ status: dead ? "DEAD" : "PENDING", attempts, lastStatus: status, lastError: error, nextAttemptAt: new Date(now().getTime() + backoffMs(attempts)) }).where(eq(d.id, r.id));
        logger.warn({ deliveryId: r.id, eventId, status, attempts, dead }, "crm delivery failed");
        if (dead) res.dead++;
        else res.retried++;
      }
    }
    return res;
  });
}
