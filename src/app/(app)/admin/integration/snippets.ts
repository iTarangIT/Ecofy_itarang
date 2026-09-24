/**
 * Copy-ready code for Admin › Integration (docs/ITARANG_CRM_SYNC.md). Written for a Node / Next.js platform
 * such as sandbox.itarang.com; any language works as long as the signature is computed the same way.
 * `__ECOFY_ORIGIN__`, `__ECOFY_EVENTS_URL__` and `__CRM_URL__` are replaced with this environment's values.
 */

export const ENV_ECOFY = `# Ecofy server (.env / STAGING_ENV_FILE) — then restart web + worker
ITARANG_CRM_URL=__CRM_URL__
ITARANG_CRM_SECRET=<same random value as on the other platform>
ITARANG_CRM_ACTOR_EMAIL=<email of an ACTIVE iTarang Admin user in Ecofy>`;

export const ENV_CRM = `# sandbox.itarang.com server (never in browser code)
ECOFY_ORIGIN=__ECOFY_ORIGIN__
ECOFY_SHARED_SECRET=<same value as ITARANG_CRM_SECRET in Ecofy>`;

export const GEN_SECRET = `# run once, anywhere; share the output through a password manager, not chat or email
openssl rand -hex 32
# or: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`;

export const SIGN_HELPER = `// lib/ecofySign.ts — on sandbox.itarang.com
import { createHmac, timingSafeEqual } from "node:crypto";

const SECRET = process.env.ECOFY_SHARED_SECRET!;

/** X-Itarang-Signature value for a payload (event body, or "METHOD\\npath\\nbody" for API calls). */
export function sign(payload: string, t = Math.floor(Date.now() / 1000)) {
  const mac = createHmac("sha256", SECRET).update(\`\${t}.\${payload}\`).digest("hex");
  return \`t=\${t},v1=\${mac}\`;
}

/** true when the header matches the RAW body and is less than 5 minutes old. */
export function verify(header: string | null, rawBody: string) {
  const m = /^t=(\\d+),v1=([0-9a-f]{64})$/.exec(header ?? "");
  if (!m || Math.abs(Date.now() / 1000 - Number(m[1])) > 300) return false;
  const mac = createHmac("sha256", SECRET).update(\`\${m[1]}.\${rawBody}\`).digest("hex");
  return timingSafeEqual(Buffer.from(m[2], "hex"), Buffer.from(mac, "hex"));
}`;

export const SQL_TABLES = `-- on the sandbox.itarang.com database
create table ecofy_leads (
  ecofy_case_id    uuid primary key,          -- Ecofy's id; also returned as crmLeadId
  case_no          text not null,             -- ECF-1042
  version          int  not null,             -- ignore snapshots older than this
  stage            text not null,             -- S1 … S8 / CLOSED
  temperature      text,                      -- HOT first, then WARM
  segment          text,                      -- RESI / ESS / CI
  customer_name    text not null,
  customer_mobile  text not null,
  city text, state text, pincode text,
  assigned_to      text,                      -- your sales user
  payload          jsonb not null,            -- the full lead as received
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create table ecofy_inbox (                    -- every eventId once (Ecofy retries until 2xx)
  event_id    text primary key,
  received_at timestamptz not null default now()
);`;

export const RECEIVER_NEW = `// app/api/integrations/ecofy/events/route.ts — on sandbox.itarang.com (Next.js + pg)
import { NextResponse } from "next/server";
import { verify } from "@/lib/ecofySign";
import { pool } from "@/lib/db";                         // your pg Pool

export async function POST(req: Request) {
  const raw = await req.text();                          // RAW body, before JSON.parse
  if (!verify(req.headers.get("x-itarang-signature"), raw)) {
    return NextResponse.json({ error: "bad signature" }, { status: 401 });
  }
  const evt = JSON.parse(raw);
  if (evt.type === "ping") return NextResponse.json({ ok: true });   // "Send test event" button

  const l = evt.lead;
  const db = await pool.connect();
  try {
    await db.query("begin");
    // 1. each eventId once
    const fresh = await db.query("insert into ecofy_inbox(event_id) values ($1) on conflict do nothing", [evt.eventId]);
    if (fresh.rowCount === 1) {
      // 2. upsert the lead; an older snapshot never overwrites a newer one
      await db.query(
        \`insert into ecofy_leads (ecofy_case_id, case_no, version, stage, temperature, segment,
                                  customer_name, customer_mobile, city, state, pincode, payload)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
         on conflict (ecofy_case_id) do update set
           version = excluded.version, stage = excluded.stage, temperature = excluded.temperature,
           payload = excluded.payload, updated_at = now()
         where ecofy_leads.version < excluded.version\`,
        [l.ecofyCaseId, l.caseNo, l.version, l.stage, l.temperature, l.segment,
         l.customer?.fullName, l.customer?.mobile, l.customer?.city, l.customer?.state, l.customer?.pincode, l],
      );
    }
    await db.query("commit");
  } catch (e) {
    await db.query("rollback");
    throw e;                                             // 500 → Ecofy retries later
  } finally {
    db.release();
  }
  // 3. tell Ecofy which id you use for this lead
  return NextResponse.json({ crmLeadId: l.ecofyCaseId });
}`;

export const RECEIVER_EXISTING = `// app/api/integrations/ecofy/events/route.ts — a thin adapter in front of what you already have
import { verify } from "@/lib/ecofySign";
import { leadsService } from "@/services/leads";        // YOUR existing lead service
import { inbox } from "@/services/inbox";               // any table keyed by eventId

export async function POST(req: Request) {
  const raw = await req.text();
  if (!verify(req.headers.get("x-itarang-signature"), raw)) return new Response("bad signature", { status: 401 });
  const evt = JSON.parse(raw);
  if (evt.type === "ping") return Response.json({ ok: true });
  if (await inbox.seen(evt.eventId)) return Response.json({ ok: true, duplicate: true });

  const l = evt.lead;
  // call your service directly (not your own HTTP API) so its validation and hooks still run
  const lead = await leadsService.upsertByExternalId("ECOFY", l.ecofyCaseId, {
    name: l.customer.fullName,
    phone: l.customer.mobile,                             // +91XXXXXXXXXX
    email: l.customer.email,
    address: l.customer.address, city: l.customer.city, state: l.customer.state, pincode: l.customer.pincode,
    priority: l.temperature === "HOT" ? "high" : "normal",
    status: l.stage,
    reference: l.caseNo,
    notes: [l.productInterest, l.avgMonthlyBillInr && \`bill ₹\${l.avgMonthlyBillInr}/month\`, l.preferredCallTime].filter(Boolean).join(" · "),
    ownerTeam: "sales_head",
    externalUrl: l.ecofyUrl,
  }, { onlyIfNewerThan: l.version });
  await inbox.markSeen(evt.eventId);
  return Response.json({ crmLeadId: String(lead.id) }); // your own id → Ecofy links it
}`;

export const SALES_HEAD_NAV = `// 1. sidebar of the sales_head dashboard (sandbox.itarang.com/sales-head)
{ href: "/sales-head/ecofy-leads", label: "Ecofy Leads", icon: Zap, roles: ["sales_head"] },

// 2. the list page query — Hot first, then oldest in the queue
select ecofy_case_id, case_no, stage, temperature, segment, customer_name, customer_mobile, city,
       payload->>'queueEnteredAt' as queued_at, payload->>'ecofyUrl' as ecofy_url, assigned_to
from ecofy_leads
where stage <> 'CLOSED'
order by (temperature = 'HOT') desc, payload->>'queueEnteredAt' asc;`;

export const SEND_EVENTS = `// lib/ecofyEvents.ts — tell Ecofy what the Sales Head did
import { randomUUID } from "node:crypto";
import { sign } from "@/lib/ecofySign";

const URL = "__ECOFY_EVENTS_URL__";

/** Store eventId with your change; on a 5xx / timeout retry with the SAME eventId (Ecofy applies it once). */
export async function sendToEcofy(type: string, lead: { ecofyCaseId: string; crmLeadId: string },
                                  actorName: string, data: object = {}, eventId = randomUUID()) {
  const body = JSON.stringify({ eventId, type, occurredAt: new Date().toISOString(),
                                ecofyCaseId: lead.ecofyCaseId, crmLeadId: lead.crmLeadId, actorName, data });
  const res = await fetch(URL, { method: "POST", body,
    headers: { "content-type": "application/json", "x-itarang-signature": sign(body) } });
  const json = await res.json();
  if (res.status >= 500) throw new Error("Ecofy unavailable — retry with the same eventId");
  return { status: res.status, ...json };             // 200 applied · 409 gate · 422 invalid
}

// examples
await sendToEcofy("lead.accepted", lead, "Priya (Sales Head)");
await sendToEcofy("lead.assigned", lead, "Priya (Sales Head)", { assigneeName: "Rahul" });
await sendToEcofy("lead.activity", lead, "Rahul", { type: "CALL", callOutcome: "CONNECTED", note: "Wants 5 kW" });
await sendToEcofy("lead.activity", lead, "Rahul", { type: "FOLLOW_UP", nextFollowUpAt: "2026-09-30T11:00:00+05:30" });
await sendToEcofy("lead.returned", lead, "Priya (Sales Head)", { reasonCode: "WANTS_LATER", note: "Call in October" });
await sendToEcofy("lead.closed",   lead, "Priya (Sales Head)", { closureReason: "NOT_INTERESTED" });`;

export const FULL_API = `// lib/ecofyApi.ts — call any Ecofy endpoint as an iTarang user (same rules as the Ecofy screens)
import { sign } from "@/lib/ecofySign";

type Opts = { actAs?: string; actorName?: string; ifMatch?: number; idempotencyKey?: string };

export async function ecofyApi<T = any>(method: string, path: string, body?: unknown, o: Opts = {}): Promise<T> {
  const raw = body === undefined ? "" : JSON.stringify(body);
  const fullPath = "/api/v1" + path;                      // include ?query exactly as sent
  const headers: Record<string, string> = { "x-itarang-signature": sign(\`\${method}\\n\${fullPath}\\n\${raw}\`) };
  if (raw) headers["content-type"] = "application/json";
  if (o.actAs) headers["x-itarang-act-as"] = o.actAs;     // Ecofy email of an iTarang Admin / Caller
  if (o.actorName) headers["x-itarang-actor-name"] = o.actorName;   // shown in Ecofy's audit log
  if (o.ifMatch !== undefined) headers["if-match"] = String(o.ifMatch);
  if (o.idempotencyKey) headers["idempotency-key"] = o.idempotencyKey;
  const res = await fetch(process.env.ECOFY_ORIGIN + fullPath, { method, headers, body: raw || undefined });
  const json = await res.json();
  if (!res.ok) throw Object.assign(new Error(json.error?.message ?? res.statusText), json.error);
  return json.data;
}

// examples
const queue = await ecofyApi("GET", "/queue");                         // Hot first, then Warm
const c     = await ecofyApi("GET", \`/cases/\${caseId}\`);
const users = await ecofyApi("GET", "/users");                         // Ecofy user ids for assign
await ecofyApi("POST", \`/cases/\${caseId}/assign\`, { userId }, { ifMatch: c.version, actorName: "Priya" });
await ecofyApi("POST", \`/cases/\${caseId}/activities\`, { type: "CALL", callOutcome: "CONNECTED", note: "ok" });
await ecofyApi("POST", \`/cases/\${caseId}/appointments\`, { meetingType: "EPC_VISIT", scheduledAt, epcPartnerId });
const timeline = await ecofyApi("GET", \`/cases/\${caseId}/timeline\`);`;

export const CURL_TEST = `# from the sandbox.itarang.com server: prove your signing matches Ecofy's (expects HTTP 200 + the queue)
BODY=""
PATH_Q="/api/v1/queue"
T=$(date +%s)
SIG=$(printf '%s' "$T.GET
$PATH_Q
$BODY" | openssl dgst -sha256 -hmac "$ECOFY_SHARED_SECRET" | sed 's/^.* //')
curl -s "__ECOFY_ORIGIN__$PATH_Q" -H "x-itarang-signature: t=$T,v1=$SIG"`;
