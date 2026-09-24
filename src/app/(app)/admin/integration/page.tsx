"use client";

import { useState, type ReactNode } from "react";
import { clsx } from "clsx";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { get, post, ApiError } from "@/lib/api";
import { Banner, Card, Kpi, When } from "@/components/ui/primitives";
import * as S from "./snippets";

type Status = {
  ecofyApiBase: string;
  ecofyEventsUrl: string;
  crmUrl: string | null;
  secretConfigured: boolean;
  outboundEnabled: boolean;
  inboundEnabled: boolean;
  actor: { email: string; fullName: string; active: boolean; role: string } | null;
  maxAttempts: number;
  deliveries: { pending: number; sent: number; dead: number; lastSentAt: string | null };
  linkedLeads: number;
  recentDeliveries: Array<{ id: number; eventId: string | null; eventType: string; caseId: string | null; caseNo: string | null; status: string; attempts: number; lastStatus: number | null; lastError: string | null; createdAt: string; sentAt: string | null; nextAttemptAt: string }>;
  recentInbound: Array<{ eventId: string; eventType: string; caseId: string | null; status: string; httpStatus: number; receivedAt: string; error: string | null }>;
};
type TestResult = { ok: boolean; status: number | null; ms: number; response: string | null; error: string | null; request: Record<string, unknown> };

const TABS = ["Setup guide", "Traffic"] as const;

/** Admin › Integration — connect another platform (sandbox.itarang.com) to this workspace. docs/ITARANG_CRM_SYNC.md */
export default function IntegrationPage() {
  const [tab, setTab] = useState<(typeof TABS)[number]>("Setup guide");
  const q = useQuery({ queryKey: ["integration", "status"], queryFn: () => get<Status>("/integrations/itarang/status"), refetchInterval: 15_000 });
  const s = q.data?.data;
  const origin = s ? s.ecofyApiBase.replace(/\/api\/v1$/, "") : "https://sandbox-ecofy.itarang.com";
  const fill = (code: string) =>
    code
      .replaceAll("__ECOFY_ORIGIN__", origin)
      .replaceAll("__ECOFY_EVENTS_URL__", s?.ecofyEventsUrl ?? `${origin}/api/v1/integrations/itarang/events`)
      .replaceAll("__CRM_URL__", s?.crmUrl ?? "https://sandbox.itarang.com/api/integrations/ecofy/events");

  return (
    <div className="space-y-4">
      <Banner>
        <b>Integration.</b> Ecofy and the iTarang platform (<span className="mono">sandbox.itarang.com</span>) keep separate code and separate databases.
        They exchange <b>signed HTTPS events</b>, and the iTarang platform can call this workspace&apos;s API as an iTarang user. Neither side reads the other&apos;s database.
      </Banner>
      <StatusPanel s={s} loading={q.isLoading} error={q.error} />
      <div className="flex gap-1 border-b border-line">
        {TABS.map((t) => (
          <button key={t} type="button" onClick={() => setTab(t)} className={clsx("-mb-px border-b-2 px-3.5 py-2 text-[13px] font-semibold", tab === t ? "border-sky text-sky" : "border-transparent text-muted hover:text-ink")}>{t}</button>
        ))}
      </div>
      {tab === "Setup guide" ? <Guide s={s} fill={fill} /> : <Traffic s={s} />}
    </div>
  );
}

// ------------------------------------------------------------------ status + test ping

function StatusPanel({ s, loading, error }: { s?: Status; loading: boolean; error: unknown }) {
  const [test, setTest] = useState<TestResult | null>(null);
  const ping = useMutation({ mutationFn: () => post<TestResult>("/integrations/itarang/test"), onSuccess: (r) => setTest(r.data) });
  if (error) return <Banner kind="red">Could not load the integration status: {(error as Error).message}</Banner>;
  if (loading || !s) return <Card title="Connection status"><div className="text-[12.5px] text-muted">Loading…</div></Card>;
  const actorOk = Boolean(s.actor?.active && s.actor.role === "ITARANG_ADMIN");
  return (
    <>
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <Kpi label="Ecofy → iTarang" value={<OnOff on={s.outboundEnabled} />} sub={s.outboundEnabled ? "leads are sent" : "set URL + secret"} />
        <Kpi label="iTarang → Ecofy" value={<OnOff on={s.inboundEnabled} />} sub={s.inboundEnabled ? "events and API accepted" : "set secret + integration user"} />
        <Kpi label="Deliveries" value={`${s.deliveries.sent} sent`} sub={`${s.deliveries.pending} waiting · ${s.deliveries.dead} failed`} />
        <Kpi label="Linked leads" value={s.linkedLeads} sub={s.deliveries.lastSentAt ? <>last sent <When v={s.deliveries.lastSentAt} /></> : "nothing sent yet"} />
      </div>
      <Card title="Connection details" right={<button className="btn btn-sm btn-primary" type="button" disabled={!s.outboundEnabled || ping.isPending} onClick={() => ping.mutate()}>{ping.isPending ? "Sending…" : "Send test event"}</button>}>
        <table className="w-full">
          <tbody>
            <Row k="Ecofy API base (give to iTarang)" v={<Copyable text={s.ecofyApiBase} />} />
            <Row k="Ecofy events URL (iTarang posts here)" v={<Copyable text={s.ecofyEventsUrl} />} />
            <Row k="iTarang receive URL (Ecofy posts here)" v={s.crmUrl ? <Copyable text={s.crmUrl} /> : <Missing>ITARANG_CRM_URL is not set</Missing>} />
            <Row k="Shared secret" v={s.secretConfigured ? <span className="chip bg-ecofy-soft text-ecofy">configured (hidden)</span> : <Missing>ITARANG_CRM_SECRET is not set</Missing>} />
            <Row k="Integration user (acts in Ecofy)" v={s.actor ? <span>{s.actor.fullName || "—"} <span className="mono text-muted">{s.actor.email}</span> {actorOk ? <span className="chip bg-ecofy-soft text-ecofy">active iTarang Admin</span> : <span className="chip bg-bad/10 text-bad">must be an ACTIVE iTarang Admin</span>}</span> : <Missing>ITARANG_CRM_ACTOR_EMAIL is not set</Missing>} />
          </tbody>
        </table>
        {ping.error && <p className="mt-3 text-[12.5px] text-bad">{(ping.error as ApiError).message}</p>}
        {test && (
          <div className={clsx("mt-3 rounded-lg border p-3 text-[12.5px]", test.ok ? "border-ecofy/40 bg-ecofy-soft" : "border-bad/40 bg-bad/5")}>
            <div className="font-semibold">{test.ok ? "✓ The iTarang platform answered" : "✗ Test failed"} — {test.status ?? "no response"} in {test.ms} ms</div>
            {test.error && <div className="mono mt-1 break-all">{test.error}</div>}
            {test.response && <pre className="mono mt-1 max-h-40 overflow-auto whitespace-pre-wrap break-all">{test.response}</pre>}
            {!test.ok && <div className="mt-1 text-muted">401 → the secret or signature check differs (Step 2). 404 → the receive route is not deployed yet (Step 3). No response → URL, DNS or firewall.</div>}
          </div>
        )}
      </Card>
    </>
  );
}

// ------------------------------------------------------------------ guide

const STEPS = [
  "How it works",
  "1 · Agree the settings",
  "2 · Signing helper",
  "3 · Create the receive API",
  "3b · Already have an API?",
  "4 · Sales Head › Ecofy Leads",
  "5 · Send updates back",
  "6 · Everything the iTarang Admin does",
  "7 · Test on sandbox",
  "Troubleshooting",
] as const;

function Guide({ s, fill }: { s?: Status; fill: (c: string) => string }) {
  const [step, setStep] = useState<(typeof STEPS)[number]>(STEPS[0]);
  const i = STEPS.indexOf(step);
  return (
    <div className="grid gap-4 md:grid-cols-[230px_1fr]">
      <nav className="card h-fit p-2 md:sticky md:top-0">
        {STEPS.map((t) => (
          <button key={t} type="button" onClick={() => setStep(t)} className={clsx("block w-full rounded-lg px-2.5 py-2 text-left text-[12.5px]", step === t ? "bg-sky text-white" : "hover:bg-page")}>{t}</button>
        ))}
      </nav>
      <div className="space-y-4">
        {step === "How it works" && <Overview s={s} />}
        {step === "1 · Agree the settings" && <StepSettings fill={fill} />}
        {step === "2 · Signing helper" && <StepSign fill={fill} />}
        {step === "3 · Create the receive API" && <StepReceiveNew fill={fill} />}
        {step === "3b · Already have an API?" && <StepReceiveExisting fill={fill} />}
        {step === "4 · Sales Head › Ecofy Leads" && <StepSalesHead fill={fill} />}
        {step === "5 · Send updates back" && <StepEvents fill={fill} />}
        {step === "6 · Everything the iTarang Admin does" && <StepFullApi fill={fill} />}
        {step === "7 · Test on sandbox" && <StepTest fill={fill} />}
        {step === "Troubleshooting" && <StepTrouble />}
        <div className="flex justify-between">
          <button className="btn btn-sm" type="button" disabled={i === 0} onClick={() => setStep(STEPS[i - 1])}>← Previous</button>
          <button className="btn btn-sm btn-primary" type="button" disabled={i === STEPS.length - 1} onClick={() => setStep(STEPS[i + 1])}>Next →</button>
        </div>
      </div>
    </div>
  );
}

function Overview({ s }: { s?: Status }) {
  return (
    <Card title="How it works">
      <P>Two platforms, two databases. They stay in sync through small, signed HTTPS messages (&quot;events&quot;). Each side stores what it receives in its own database.</P>
      <div className="my-4 grid gap-3 md:grid-cols-[1fr_auto_1fr] md:items-center">
        <Box title="Ecofy workspace" sub="sandbox-ecofy.itarang.com" lines={["Ecofy user pushes a Warm lead or marks it Hot", "Stage changes (returned, closed, …)", "Accepts updates + full API calls"]} />
        <div className="text-center text-[12px] text-muted">
          <div>lead.pushed / lead.stage_changed →</div>
          <div className="my-1 text-[18px]">⇄</div>
          <div>← lead.assigned / activity / returned / closed</div>
          <div>← any /api/v1 call (as an iTarang user)</div>
        </div>
        <Box title="iTarang platform" sub="sandbox.itarang.com" lines={["Receives the lead, stores it", "Sales Head › Ecofy Leads", "Sends what the Sales Head does back"]} />
      </div>
      <H>The four things the iTarang platform builds</H>
      <ol className="ml-5 list-decimal space-y-1 text-[13px]">
        <li>A <b>signing helper</b> (10 lines) so both sides can prove a message is genuine. <i>Step 2</i></li>
        <li>A <b>receive API</b> that stores leads Ecofy sends. A new one or an adapter on an existing one. <i>Steps 3 / 3b</i></li>
        <li>The <b>Ecofy Leads</b> page in the Sales Head dashboard. <i>Step 4</i></li>
        <li><b>Sending back</b> what the Sales Head does, as simple events or through the full API. <i>Steps 5 / 6</i></li>
      </ol>
      <H>Words used here</H>
      <table className="w-full text-[12.5px]"><tbody>
        <Row k="Event" v="A JSON message with a unique eventId, e.g. lead.pushed. The receiver must process each eventId only once." />
        <Row k="Shared secret" v="A long random string that both servers know. Never sent over the wire: it is used to compute the signature." />
        <Row k="Signature" v={<>Header <code className="mono">X-Itarang-Signature: t=&lt;time&gt;,v1=&lt;HMAC&gt;</code>. It proves who sent the message and that nobody changed it. It expires after 5 minutes.</>} />
        <Row k="Integration user" v={`The iTarang Admin in Ecofy that incoming changes are recorded as${s?.actor ? ` (${s.actor.email})` : ""}. The real person's name is added to each change.`} />
        <Row k="Case / lead" v="Ecofy's case (ECF-…) = the iTarang lead. ecofyCaseId links them; crmLeadId is the iTarang side's id." />
      </tbody></table>
    </Card>
  );
}

function StepSettings({ fill }: { fill: (c: string) => string }) {
  return (
    <Card title="Step 1 — Agree the settings (both teams, once per environment)">
      <Ol items={[
        <>Generate one shared secret. Use a different one for sandbox and for production.</>,
        <>Ecofy technical team: set the three values below on the Ecofy server and restart it. Run <code className="mono">npm run db:migrate</code> once so the sync tables exist.</>,
        <>Ecofy admin: in <b>Users &amp; seats</b>, create an <b>iTarang Admin</b> user for the integration (e.g. <span className="mono">crm-sync@itarang.com</span>). Its email is <span className="mono">ITARANG_CRM_ACTOR_EMAIL</span>.</>,
        <>iTarang platform: store the same secret and the Ecofy address in its server environment.</>,
        <>Check the <b>Connection details</b> panel above: both directions should show <b>On</b>.</>,
      ]} />
      <Code title="Generate the secret" code={S.GEN_SECRET} />
      <Code title="Ecofy server" code={fill(S.ENV_ECOFY)} />
      <Code title="sandbox.itarang.com server" code={fill(S.ENV_CRM)} />
      <Note>The secret is a password for machines. Keep it in server environment files or a secrets manager only. Never put it in browser code, a Git repository, email or chat.</Note>
    </Card>
  );
}

function StepSign({ fill }: { fill: (c: string) => string }) {
  return (
    <Card title="Step 2 — Signing helper on sandbox.itarang.com">
      <P>Every message in both directions carries <code className="mono">X-Itarang-Signature</code>. The HMAC-SHA256 is computed over <code className="mono">&lt;unix time&gt;.&lt;payload&gt;</code>:</P>
      <ul className="ml-5 list-disc space-y-1 text-[13px]">
        <li><b>Events</b> (Steps 3 and 5): the payload is the <b>raw JSON body</b>, byte for byte.</li>
        <li><b>API calls</b> (Step 6): the payload is <code className="mono">METHOD + &quot;\n&quot; + path?query + &quot;\n&quot; + raw body</code>.</li>
      </ul>
      <Code title="lib/ecofySign.ts" code={fill(S.SIGN_HELPER)} />
      <Note>Always verify the raw text you received (<code className="mono">await req.text()</code>), not a re-serialised <code className="mono">JSON.stringify(JSON.parse(…))</code>: spacing or key order would change and the check would fail.</Note>
    </Card>
  );
}

function StepReceiveNew({ fill }: { fill: (c: string) => string }) {
  return (
    <Card title="Step 3 — Create the receive API (no existing lead API)">
      <P>Ecofy posts each lead to one URL on sandbox.itarang.com. Build it like this:</P>
      <Ol items={[
        <>Create two tables: the leads, and the event ids already processed.</>,
        <>Add the route <code className="mono">POST /api/integrations/ecofy/events</code>. It checks the signature, skips repeats, saves the lead and answers <code className="mono">{"{ crmLeadId }"}</code>.</>,
        <>Answer <b>2xx only after</b> the data is saved. Anything else makes Ecofy retry: 10 s, 20 s, 40 s … up to 1 h, about 6 hours in total.</>,
        <>Answer <code className="mono">{"{ ok: true }"}</code> to <code className="mono">type: &quot;ping&quot;</code> (the <b>Send test event</b> button).</>,
        <>Give the full URL to the Ecofy team for <span className="mono">ITARANG_CRM_URL</span>.</>,
      ]} />
      <Code title="SQL" code={S.SQL_TABLES} />
      <Code title="app/api/integrations/ecofy/events/route.ts" code={fill(S.RECEIVER_NEW)} />
      <H>What Ecofy sends</H>
      <table className="w-full text-[12.5px]"><tbody>
        <Row k="lead.pushed" v="A new lead for the Sales Head: an Ecofy user pushed a Warm lead or marked it Hot. It is sent again if the lead is re-pushed after a return, so upsert by ecofyCaseId." />
        <Row k="lead.stage_changed" v={<>Later changes of a lead already sent, with <code className="mono">change: {"{ from, to, reason }"}</code>. <code className="mono">to = S0</code> means returned to Ecofy; <code className="mono">CLOSED</code> means closed.</>} />
        <Row k="ping" v="Test only. Reply 2xx." />
      </tbody></table>
      <Note>Financing amounts are never included. The <code className="mono">lead</code> object has the case, customer, segment, temperature and a link back (<code className="mono">ecofyUrl</code>). The full field list is in docs/ITARANG_CRM_SYNC.md §3.</Note>
    </Card>
  );
}

function StepReceiveExisting({ fill }: { fill: (c: string) => string }) {
  return (
    <Card title="Step 3b — The platform already has a lead API">
      <P>Don&apos;t point Ecofy at the existing API directly: it expects a login and its own body format. Add a <b>small adapter route</b> that checks the signature and calls your existing lead service.</P>
      <Ol items={[
        <>Add two columns to your leads table: <code className="mono">source</code> (&apos;ECOFY&apos;) and <code className="mono">external_id</code> (the ecofyCaseId), unique together.</>,
        <>Add a table (or reuse one) that remembers processed <code className="mono">eventId</code>s.</>,
        <>Create the adapter route below. It maps Ecofy&apos;s fields to yours and calls your service&apos;s create/update (upsert) function.</>,
        <>Return <b>your</b> lead id as <code className="mono">crmLeadId</code>. Ecofy stores it, and you send it back in Step 5.</>,
        <>On <code className="mono">lead.stage_changed</code>, update the status only. Ignore a <code className="mono">lead.version</code> lower than the one you stored.</>,
      ]} />
      <H>Field mapping</H>
      <table className="w-full text-[12.5px]">
        <thead><tr><th className="th">Ecofy sends (lead.…)</th><th className="th">Typical field on your side</th></tr></thead>
        <tbody>
          {[
            ["ecofyCaseId", "external_id (unique, source = ECOFY)"], ["caseNo", "reference number (ECF-…)"], ["customer.fullName / businessName", "name / company"],
            ["customer.mobile · altMobile (+91…)", "phone · alternate phone"], ["customer.email · address · city · state · pincode", "contact + address"],
            ["temperature (HOT / WARM)", "priority: HOT first"], ["segment (RESI / ESS / C&I) · productInterest", "product line / interest"],
            ["avgMonthlyBillInr · sanctionedLoadKw · existingBackup · preferredCallTime", "requirement notes"], ["stage · subStatus", "status"],
            ["qualifiedByName", "referred by (Ecofy user)"], ["ecofyUrl", "external link (\"Open in Ecofy\")"], ["version", "last applied version (ignore older)"],
          ].map(([a, b]) => <tr key={a}><td className="td mono text-[12px]">{a}</td><td className="td">{b}</td></tr>)}
        </tbody>
      </table>
      <Code title="Adapter route (Next.js)" code={fill(S.RECEIVER_EXISTING)} />
    </Card>
  );
}

function StepSalesHead({ fill }: { fill: (c: string) => string }) {
  return (
    <Card title="Step 4 — Show the leads in the Sales Head dashboard">
      <Ol items={[
        <>Add a navigation item <b>Ecofy Leads</b> to <span className="mono">sandbox.itarang.com/sales-head</span>, visible to the sales_head role.</>,
        <>List page: Hot first, then the oldest in the queue. Show case no., customer, mobile, city, segment, stage, time in queue and assignee.</>,
        <>Detail page: the customer and requirement, the stage, and an <b>Open in Ecofy</b> button (<code className="mono">ecofyUrl</code>) for the full history.</>,
        <>Actions on the page (assign, log call, return, close) call Step 5 or Step 6, so Ecofy stays in step.</>,
      ]} />
      <Code title="Navigation + list query" code={fill(S.SALES_HEAD_NAV)} />
    </Card>
  );
}

function StepEvents({ fill }: { fill: (c: string) => string }) {
  return (
    <Card title="Step 5 — Send the Sales Head's work back to Ecofy (simple events)">
      <P>POST a signed event to the <b>Ecofy events URL</b> shown above. Ecofy applies it through its normal rules and records it in the case history.</P>
      <table className="w-full text-[12.5px]">
        <thead><tr><th className="th">type</th><th className="th">data</th><th className="th">What happens in Ecofy</th></tr></thead>
        <tbody>
          <tr><td className="td mono">lead.accepted</td><td className="td mono">{"{}"}</td><td className="td">Links your crmLeadId (optional if you replied with it in Step 3).</td></tr>
          <tr><td className="td mono">lead.assigned</td><td className="td mono">{"{ assigneeName, reason? }"}</td><td className="td">At S1 the case moves to <b>S2 Follow-up</b>. The history names your person.</td></tr>
          <tr><td className="td mono">lead.activity</td><td className="td mono">{"{ type: CALL|REMARK|COMMENT|FOLLOW_UP, callOutcome?, note?, nextFollowUpAt? }"}</td><td className="td">Adds the call or note to the case. CALL needs callOutcome; FOLLOW_UP needs nextFollowUpAt.</td></tr>
          <tr><td className="td mono">lead.returned</td><td className="td mono">{"{ reasonCode, note? }"}</td><td className="td">Back to the Ecofy user (S1/S2 only). WRONG_NUMBER, NOT_INTERESTED, WANTS_LATER, DUPLICATE, OUT_OF_AREA, REQUALIFY.</td></tr>
          <tr><td className="td mono">lead.closed</td><td className="td mono">{"{ closureReason, note? }"}</td><td className="td">Closes the case (S1–S4). NOT_INTERESTED, UNREACHABLE, DUPLICATE, OUT_OF_AREA, …</td></tr>
        </tbody>
      </table>
      <Code title="lib/ecofyEvents.ts" code={fill(S.SEND_EVENTS)} />
      <H>Replies</H>
      <table className="w-full text-[12.5px]"><tbody>
        <Row k="200" v="Applied. A repeat of the same eventId returns the first answer with the header X-Itarang-Duplicate: true." />
        <Row k="409 GATE_NOT_MET" v="Not allowed now, e.g. gate stage (already closed) or crm_lead (this case was never sent to you). Don't retry." />
        <Row k="422 / 401" v="Invalid body or code / bad signature. Fix it; don't retry." />
        <Row k="5xx or timeout" v="Retry later with the same eventId." />
      </tbody></table>
    </Card>
  );
}

function StepFullApi({ fill }: { fill: (c: string) => string }) {
  return (
    <Card title="Step 6 — Do everything the iTarang Admin does in Ecofy, from sandbox.itarang.com">
      <P>Every button the iTarang Admin uses in this workspace is a call to Ecofy&apos;s REST API. The iTarang server can call <b>the same endpoints</b>, signed instead of logged in. The call runs as a real Ecofy user, and Ecofy&apos;s normal rules and audit log still apply to it.</P>
      <Ol items={[
        <>Choose who the call acts as: header <code className="mono">X-Itarang-Act-As</code> = the Ecofy email of an <b>iTarang Admin or Caller</b>. Without it, the integration user is used. Ecofy users are refused.</>,
        <>Send <code className="mono">X-Itarang-Actor-Name</code> with the real person&apos;s name. Ecofy&apos;s audit log shows it.</>,
        <>Sign <code className="mono">METHOD\npath?query\nbody</code> (Step 2) and call <code className="mono">{"<Ecofy API base><path>"}</code>.</>,
        <>Send <code className="mono">If-Match</code> (the case <code className="mono">version</code>) where the API asks for it, and <code className="mono">Idempotency-Key</code> on create/OTP calls. A 409 VERSION_CONFLICT means reload the case and retry.</>,
      ]} />
      <Code title="lib/ecofyApi.ts" code={fill(S.FULL_API)} />
      <H>Common endpoints (full list: docs/ecofy_openapi_v1.0.1.yaml)</H>
      <table className="w-full text-[12.5px]"><tbody>
        {[
          ["GET /queue", "Pickup queue: Hot first, then Warm"], ["GET /cases?stage=S2 · GET /cases/{id} · GET /cases/{id}/timeline", "Lists, one case, full history"],
          ["POST /cases/{id}/assign", "Assign / reassign (If-Match)"], ["POST /cases/{id}/activities", "Call, remark, follow-up"],
          ["POST /cases/{id}/appointments · PATCH /appointments/{id}", "Book and complete meetings / EPC visits"], ["POST /cases/{id}/advance", "Move to the next stage when its gate is met"],
          ["POST /cases/{id}/return · /close · /reopen", "Return to Ecofy, close, reopen"], ["POST /cases/{id}/assessments · /eligibility · /quote-requests · /offers", "Assessment, eligibility, EPC quotes, offers"],
          ["POST /offers/{id}/otp · POST /otp/{id}/verify", "Customer acceptance → File"], ["POST /cases (Idempotency-Key)", "Create an iTarang-sourced lead (starts at S1)"],
          ["GET /users · GET /epc-partners · GET /lists/{code}/items", "Ids and codes the other calls need"],
        ].map(([a, b]) => <tr key={a}><td className="td mono text-[12px]">{a}</td><td className="td">{b}</td></tr>)}
      </tbody></table>
      <Note>Signed calls see exactly what that Ecofy user sees. An iTarang Admin also sees other financiers&apos; amounts, as in the Ecofy screens. Keep this code and the secret on the server only.</Note>
    </Card>
  );
}

function StepTest({ fill }: { fill: (c: string) => string }) {
  return (
    <Card title="Step 7 — Test on sandbox, end to end">
      <Ol items={[
        <><b>Connection:</b> click <b>Send test event</b> above. Expect <i>✓ answered 200</i>. A 401 means the secrets differ; a 404 means the route is not deployed.</>,
        <><b>Your signature against Ecofy:</b> run the curl below from the iTarang server. Expect <code className="mono">{"{ data: [...] }"}</code>, not a 401.</>,
        <><b>Lead arrives:</b> in <b>Leads &amp; cases</b>, create a test lead, set it <b>Warm</b> and click <b>Push to iTarang</b>. Within about 10 seconds the <b>Traffic</b> tab shows <i>lead.pushed · SENT</i>, and the lead appears under Sales Head › Ecofy Leads.</>,
        <><b>Update comes back:</b> assign it in the Sales Head dashboard. The Ecofy case moves to <b>S2 Follow-up</b>, and the Traffic tab shows the incoming event as APPLIED.</>,
        <><b>Call and close:</b> log a call and close the lead. Both appear in the Ecofy case history, and Ecofy sends back <i>lead.stage_changed → CLOSED</i>.</>,
        <><b>Resilience:</b> stop the iTarang receive route and push another lead. Traffic shows <i>waiting</i> with attempts. Start it again and the lead arrives by itself.</>,
      ]} />
      <Code title="curl — check your API signing" code={fill(S.CURL_TEST)} />
    </Card>
  );
}

function StepTrouble() {
  return (
    <Card title="Troubleshooting">
      <table className="w-full text-[12.5px]">
        <thead><tr><th className="th">You see</th><th className="th">Likely cause</th><th className="th">Fix</th></tr></thead>
        <tbody>
          {[
            ["401 Bad or expired X-Itarang-Signature", "Different secret; body re-serialised before signing/verifying; server clock off by > 5 min; path signed without /api/v1 or without the ?query", "Same secret both sides; sign the exact bytes you send; sync the clock (NTP); sign /api/v1/… with the query"],
            ["403 on an API call", "Act-as user is an Ecofy user, or that role can't use the endpoint (e.g. a Caller on /queue)", "Act as an iTarang Admin or pick the right user"],
            ["404 Integration", "Ecofy has no secret or no integration user", "Step 1"],
            ["409 GATE_NOT_MET crm_lead", "The case was never pushed to iTarang", "Only act on leads Ecofy sent you"],
            ["409 GATE_NOT_MET stage", "Not allowed at the current stage (e.g. already closed)", "Reload the lead; don't retry"],
            ["409 VERSION_CONFLICT", "Someone changed the case after you read it", "GET the case again and retry with the new version"],
            ["Deliveries stuck at waiting / failed", "Receive route down, non-2xx answer, or timeout (> 10 s)", "Check Traffic → last error; fix, then Retry"],
            ["Lead appears twice", "The receiver doesn't dedupe on eventId or upsert on ecofyCaseId", "Step 3: inbox table + upsert"],
          ].map(([a, b, c]) => <tr key={a}><td className="td mono text-[12px]">{a}</td><td className="td">{b}</td><td className="td">{c}</td></tr>)}
        </tbody>
      </table>
    </Card>
  );
}

// ------------------------------------------------------------------ traffic

function Traffic({ s }: { s?: Status }) {
  const qc = useQueryClient();
  const retry = useMutation({ mutationFn: (id: number) => post(`/integrations/itarang/deliveries/${id}/retry`), onSuccess: () => qc.invalidateQueries({ queryKey: ["integration"] }) });
  if (!s) return null;
  const chip = (st: string) => <span className={clsx("chip", st === "SENT" || st === "APPLIED" ? "bg-ecofy-soft text-ecofy" : st === "PENDING" ? "bg-amber-100 text-amber-800" : "bg-bad/10 text-bad")}>{st === "PENDING" ? "waiting" : st === "DEAD" ? "failed" : st.toLowerCase()}</span>;
  return (
    <div className="space-y-4">
      <Card title="Ecofy → iTarang (last 15)" pad={false}>
        <table className="w-full">
          <thead><tr><th className="th">Event</th><th className="th">Case</th><th className="th">Status</th><th className="th">Attempts</th><th className="th">Last answer</th><th className="th">Created</th><th className="th" /></tr></thead>
          <tbody>
            {s.recentDeliveries.length === 0 && <tr><td className="td text-muted" colSpan={7}>Nothing sent yet. Push a Warm lead to try it.</td></tr>}
            {s.recentDeliveries.map((d) => (
              <tr key={d.id}>
                <td className="td mono text-[12px]">{d.eventType}</td>
                <td className="td">{d.caseId ? <a className="text-sky" href={`/cases/${d.caseId}`}>{d.caseNo ?? "open"}</a> : "—"}</td>
                <td className="td">{chip(d.status)}</td>
                <td className="td mono">{d.attempts}/{s.maxAttempts}</td>
                <td className="td text-[12px]">{d.lastStatus ?? (d.lastError ? "no response" : "—")}{d.lastError && <div className="mono max-w-[320px] truncate text-muted" title={d.lastError}>{d.lastError}</div>}{d.status === "PENDING" && d.attempts > 0 && <div className="text-muted">next <When v={d.nextAttemptAt} /></div>}</td>
                <td className="td text-[12px]"><When v={d.createdAt} /></td>
                <td className="td">{d.status !== "SENT" && <button className="btn btn-sm" type="button" disabled={retry.isPending} onClick={() => retry.mutate(d.id)}>Retry now</button>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
      <Card title="iTarang → Ecofy (last 15)" pad={false}>
        <table className="w-full">
          <thead><tr><th className="th">Event</th><th className="th">Event id</th><th className="th">Case</th><th className="th">Result</th><th className="th">Received</th></tr></thead>
          <tbody>
            {s.recentInbound.length === 0 && <tr><td className="td text-muted" colSpan={5}>No events received yet.</td></tr>}
            {s.recentInbound.map((e) => (
              <tr key={e.eventId}>
                <td className="td mono text-[12px]">{e.eventType}</td>
                <td className="td mono max-w-[200px] truncate text-[12px]" title={e.eventId}>{e.eventId}</td>
                <td className="td">{e.caseId ? <a className="text-sky" href={`/cases/${e.caseId}`}>open</a> : "—"}</td>
                <td className="td">{chip(e.status)} <span className="mono text-[12px] text-muted">{e.httpStatus}</span>{e.error && <div className="text-[12px] text-muted">{e.error}</div>}</td>
                <td className="td text-[12px]"><When v={e.receivedAt} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
      <p className="text-[11.5px] text-muted">Direct API calls from the iTarang platform (Step 6) don&apos;t appear here. They show in the <b>Audit log</b> with user agent <span className="mono">itarang-crm (…)</span>.</p>
    </div>
  );
}

// ------------------------------------------------------------------ small pieces

function OnOff({ on }: { on: boolean }) {
  return <span className={on ? "text-ecofy" : "text-muted"}>{on ? "On" : "Off"}</span>;
}
function Row({ k, v }: { k: ReactNode; v: ReactNode }) {
  return <tr><td className="td w-[260px] text-muted">{k}</td><td className="td">{v}</td></tr>;
}
function Missing({ children }: { children: ReactNode }) {
  return <span className="chip bg-bad/10 text-bad">{children}</span>;
}
function P({ children }: { children: ReactNode }) {
  return <p className="mb-3 text-[13px] leading-relaxed">{children}</p>;
}
function H({ children }: { children: ReactNode }) {
  return <h3 className="mb-2 mt-5 text-[13px] font-semibold">{children}</h3>;
}
function Note({ children }: { children: ReactNode }) {
  return <div className="mt-4 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-[12.5px]">{children}</div>;
}
function Ol({ items }: { items: ReactNode[] }) {
  return (
    <ol className="mb-3 space-y-2">
      {items.map((it, n) => (
        <li key={n} className="flex gap-2.5 text-[13px] leading-relaxed">
          <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-sky text-[11px] font-bold text-white">{n + 1}</span>
          <span>{it}</span>
        </li>
      ))}
    </ol>
  );
}
function Box({ title, sub, lines }: { title: string; sub: string; lines: string[] }) {
  return (
    <div className="rounded-lg border border-line p-3">
      <div className="text-[13px] font-semibold">{title}</div>
      <div className="mono text-[11.5px] text-muted">{sub}</div>
      <ul className="mt-2 ml-4 list-disc text-[12.5px]">{lines.map((l) => <li key={l}>{l}</li>)}</ul>
    </div>
  );
}
function useCopy() {
  const [done, setDone] = useState(false);
  const copy = async (text: string) => {
    try { await navigator.clipboard.writeText(text); setDone(true); setTimeout(() => setDone(false), 1500); } catch { /* clipboard blocked */ }
  };
  return { done, copy };
}
function Copyable({ text }: { text: string }) {
  const { done, copy } = useCopy();
  return <span className="inline-flex items-center gap-2"><code className="mono break-all text-[12.5px]">{text}</code><button className="btn btn-sm" type="button" onClick={() => copy(text)}>{done ? "Copied" : "Copy"}</button></span>;
}
function Code({ title, code }: { title: string; code: string }) {
  const { done, copy } = useCopy();
  return (
    <div className="mt-3 overflow-hidden rounded-lg border border-line">
      <div className="flex items-center justify-between border-b border-line bg-page px-3 py-1.5 text-[12px] font-semibold">
        <span>{title}</span>
        <button className="btn btn-sm" type="button" onClick={() => copy(code)}>{done ? "Copied" : "Copy"}</button>
      </div>
      <pre className="mono max-h-[420px] overflow-auto bg-[#0f2436] p-3 text-[12px] leading-[1.55] text-[#dbe9f3]">{code}</pre>
    </div>
  );
}
