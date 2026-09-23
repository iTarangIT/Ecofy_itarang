import { and, eq, lt, lte, isNull, isNotNull, sql, inArray, gte } from "drizzle-orm";
import { schema } from "@/core/db/client";
import { storage } from "@/adapters";
import { audit } from "@/core/audit/audit";
import { emit } from "@/core/events/outbox";
import { getSetting } from "@/core/settings/settingsCache";
import { istDate, addDays, daysAgo, hoursAgo } from "@/core/calendar/dates";
import { createNotifications, notificationExists } from "@/modules/m16-notifications/service";
import type { JobDef } from "./index";

/** BRD §8.2 background jobs. Every job is idempotent and reads an injectable clock through ctx.now. */
export const maintenanceJobs: JobDef[] = [
  {
    name: "otp.expire",
    schedule: "* * * * *",
    run: async (ctx) => {
      const r = await ctx.tx
        .update(schema.otpChallenges)
        .set({ status: "EXPIRED" })
        .where(and(eq(schema.otpChallenges.tenantId, ctx.tenantId), eq(schema.otpChallenges.status, "SENT"), lt(schema.otpChallenges.expiresAt, ctx.now)))
        .returning({ id: schema.otpChallenges.id });
      return { expired: r.length };
    },
  },
  {
    name: "quote.expire",
    schedule: "30 0 * * *",
    run: async (ctx) => {
      const today = istDate(ctx.now);
      const expired = await ctx.tx
        .update(schema.quotes)
        .set({ status: "EXPIRED" })
        .where(and(eq(schema.quotes.tenantId, ctx.tenantId), eq(schema.quotes.status, "ACTIVE"), lt(schema.quotes.validUntil, today)))
        .returning({ id: schema.quotes.id, caseId: schema.quotes.caseId, version: schema.quotes.version });
      for (const q of expired) {
        // an offer built on an expired quote cannot be sent any more
        await ctx.tx.update(schema.offers).set({ status: "EXPIRED" }).where(and(eq(schema.offers.quoteId, q.id), inArray(schema.offers.status, ["DRAFT", "SENT"])));
        const c = await ctx.tx.select({ assignedUserId: schema.cases.assignedUserId, caseNo: schema.cases.caseNo }).from(schema.cases).where(eq(schema.cases.id, q.caseId)).limit(1);
        await audit(ctx, { action: "quote.expire", entityType: "quote", entityId: q.id, caseId: q.caseId, after: { status: "EXPIRED" } });
        await emit(ctx, "quote.expired", q.id, {
          caseId: q.caseId, version: q.version,
          notify: c[0]?.assignedUserId ? [{ userId: c[0].assignedUserId, type: "quote.expired", title: `Quote v${q.version} expired on ${c[0].caseNo}`, caseId: q.caseId }] : [],
        });
      }
      return { expired: expired.length };
    },
  },
  {
    name: "recording.purge",
    schedule: "0 2 * * *",
    run: async (ctx) => {
      const today = istDate(ctx.now);
      const due = await ctx.tx
        .select()
        .from(schema.documents)
        .where(and(eq(schema.documents.tenantId, ctx.tenantId), eq(schema.documents.typeCode, "CALL_RECORDING"), isNull(schema.documents.deletedAt), isNotNull(schema.documents.retentionUntil), lt(schema.documents.retentionUntil, today)));
      const st = await storage();
      let purged = 0;
      for (const d of due) {
        await st.delete(d.s3Key);
        await ctx.tx.update(schema.documents).set({ deletedAt: ctx.now }).where(eq(schema.documents.id, d.id));
        await audit(ctx, { action: "document.purge", entityType: "document", entityId: d.id, caseId: d.caseId, before: { s3Key: d.s3Key, retentionUntil: d.retentionUntil }, reason: "recordings.retention_days" });
        await emit(ctx, "document.purged", d.id, { caseId: d.caseId, typeCode: d.typeCode });
        purged++;
      }
      return { purged };
    },
  },
  {
    name: "import.purge",
    schedule: "30 2 * * *",
    run: async (ctx) => {
      const days = await getSetting(ctx.tenantId, "imports.raw_retention_days", ctx.tx);
      const cutoff = daysAgo(ctx.now, Number(days));
      const batches = await ctx.tx
        .select()
        .from(schema.importBatches)
        .where(and(eq(schema.importBatches.tenantId, ctx.tenantId), isNotNull(schema.importBatches.committedAt), lt(schema.importBatches.committedAt, cutoff), isNull(schema.importBatches.filePurgedAt)));
      const st = await storage();
      for (const b of batches) {
        await st.delete(b.fileKey).catch(() => undefined);
        await ctx.tx.update(schema.importBatches).set({ filePurgedAt: ctx.now }).where(eq(schema.importBatches.id, b.id));
        await ctx.tx.update(schema.importRows).set({ raw: null, rawPurgedAt: ctx.now }).where(and(eq(schema.importRows.batchId, b.id), isNull(schema.importRows.rawPurgedAt)));
        await audit(ctx, { action: "import.purge", entityType: "import_batch", entityId: b.id, reason: "imports.raw_retention_days" });
      }
      return { purged: batches.length };
    },
  },
  {
    name: "idempotency.purge",
    schedule: "0 3 * * *",
    run: async (ctx) => {
      const ttl = await getSetting(ctx.tenantId, "idempotency.ttl_hours", ctx.tx);
      const r = await ctx.tx
        .delete(schema.idempotencyKeys)
        .where(and(eq(schema.idempotencyKeys.tenantId, ctx.tenantId), lt(schema.idempotencyKeys.createdAt, hoursAgo(ctx.now, Number(ttl)))))
        .returning({ key: schema.idempotencyKeys.key });
      return { deleted: r.length };
    },
  },
  {
    name: "ageing.rollup",
    schedule: "0 1 * * *",
    run: async (ctx) => {
      // Fills funnel_daily for yesterday (IST): entered/exited from stage history, open_at_eod from current stage.
      const day = addDays(istDate(ctx.now), -1);
      await ctx.tx.execute(sql`
        with h as (
          select to_stage as stage, actor_id, count(*) filter (where true) as entered
          from case_stage_history where tenant_id = ${ctx.tenantId}
            and (at at time zone 'Asia/Kolkata')::date = ${day}::date
          group by to_stage, actor_id
        ),
        x as (
          select from_stage as stage, count(*) as exited
          from case_stage_history where tenant_id = ${ctx.tenantId} and from_stage is not null
            and (at at time zone 'Asia/Kolkata')::date = ${day}::date
          group by from_stage
        ),
        o as (
          select stage, assigned_user_id as user_id, count(*) as open_at_eod
          from cases where tenant_id = ${ctx.tenantId} and stage <> 'CLOSED'
          group by stage, assigned_user_id
        ),
        all_rows as (
          select ${ctx.tenantId}::uuid as tenant_id, ${day}::date as day, s.stage, s.user_id,
                 coalesce((select sum(entered) from h where h.stage = s.stage and h.actor_id is not distinct from s.user_id), 0)::int as entered,
                 coalesce((select exited from x where x.stage = s.stage), 0)::int as exited,
                 coalesce((select open_at_eod from o where o.stage = s.stage and o.user_id is not distinct from s.user_id), 0)::int as open_at_eod
          from (
            select stage, actor_id as user_id from h
            union select stage, user_id from o
            union select stage, null::uuid from x
          ) s
        )
        insert into funnel_daily (tenant_id, day, user_id, stage, entered, exited, open_at_eod)
        select tenant_id, day, user_id, stage, entered, exited, open_at_eod from all_rows
        on conflict (tenant_id, day, stage, coalesce(user_id, '00000000-0000-0000-0000-000000000000'::uuid))
        do update set entered = excluded.entered, exited = excluded.exited, open_at_eod = excluded.open_at_eod
      `);
      return { day };
    },
  },
  {
    name: "price.stale",
    schedule: "0 9 * * 1",
    run: async (ctx) => {
      const days = await getSetting(ctx.tenantId, "systems.price_refresh_days", ctx.tx);
      const cutoff = addDays(istDate(ctx.now), -Number(days));
      const pub = await ctx.tx.select({ id: schema.calcReleases.id }).from(schema.calcReleases).where(and(eq(schema.calcReleases.tenantId, ctx.tenantId), eq(schema.calcReleases.status, "PUBLISHED"))).limit(1);
      if (!pub[0]) return { stale: 0 };
      const stale = await ctx.tx
        .select({ code: schema.calcSystems.systemCode, on: schema.calcSystems.priceUpdatedOn })
        .from(schema.calcSystems)
        .where(and(eq(schema.calcSystems.releaseId, pub[0].id), eq(schema.calcSystems.active, true), lte(schema.calcSystems.priceUpdatedOn, cutoff)));
      if (stale.length) {
        const type = `price.stale:${istDate(ctx.now)}`;
        const admins = await ctx.tx.select({ id: schema.users.id }).from(schema.users).where(and(eq(schema.users.tenantId, ctx.tenantId), eq(schema.users.role, "ITARANG_ADMIN"), eq(schema.users.status, "ACTIVE")));
        if (!(await notificationExists(ctx, type, admins.map((a) => a.id)))) {
          await createNotifications(ctx, [{ role: "ITARANG_ADMIN", type, title: `${stale.length} standard system price(s) older than ${days} days`, body: stale.map((s) => `${s.code} (${s.on})`).join(", ") }]);
        }
      }
      return { stale: stale.length };
    },
  },
  {
    name: "appt.reminder",
    schedule: "*/5 * * * *",
    run: async (ctx) => {
      const minutes = Number(await getSetting(ctx.tenantId, "appointments.reminder_minutes_before", ctx.tx));
      const from = new Date(ctx.now.getTime() + (minutes - 5) * 60_000);
      const to = new Date(ctx.now.getTime() + (minutes + 5) * 60_000);
      const due = await ctx.tx
        .select({ id: schema.appointments.id, caseId: schema.appointments.caseId, scheduledAt: schema.appointments.scheduledAt, meetingType: schema.appointments.meetingType, assignee: schema.cases.assignedUserId, caseNo: schema.cases.caseNo })
        .from(schema.appointments)
        .innerJoin(schema.cases, eq(schema.cases.id, schema.appointments.caseId))
        .where(and(eq(schema.appointments.tenantId, ctx.tenantId), eq(schema.appointments.status, "SCHEDULED"), gte(schema.appointments.scheduledAt, from), lte(schema.appointments.scheduledAt, to)));
      let sent = 0;
      for (const a of due) {
        if (!a.assignee) continue;
        const type = `appointment.reminder:${a.id}`;
        if (await notificationExists(ctx, type, [a.assignee])) continue;
        await createNotifications(ctx, [{ userId: a.assignee, type, title: `${a.meetingType} on ${a.caseNo} in ${minutes} minutes`, caseId: a.caseId }]);
        sent++;
      }
      return { sent };
    },
  },
  {
    name: "admin.daily_digest",
    schedule: "0 8 * * *",
    run: async (ctx) => {
      const enabled = await getSetting(ctx.tenantId, "notifications.admin_daily_digest", ctx.tx);
      if (!enabled) return { skipped: 1 };
      const counts = await ctx.tx.execute(sql`select stage, count(*)::int as n from cases where tenant_id = ${ctx.tenantId} and stage <> 'CLOSED' group by stage order by stage`);
      const lines = (counts as unknown as Array<{ stage: string; n: number }>).map((r) => `${r.stage}: ${r.n}`).join("\n");
      const admins = await ctx.tx.select({ email: schema.users.email }).from(schema.users).where(and(eq(schema.users.tenantId, ctx.tenantId), inArray(schema.users.role, ["ECOFY_ADMIN", "ITARANG_ADMIN"]), eq(schema.users.status, "ACTIVE")));
      for (const a of admins) await emit(ctx, "job.email.send", ctx.tenantId, { to: a.email, subject: "Ecofy Lead Workspace — daily digest", text: `Open cases by stage:\n${lines || "none"}` });
      return { emails: admins.length };
    },
  },
];
