"use client";

import { useState } from "react";
import Link from "next/link";
import { post, errorMessage } from "@/lib/api";
import { useList, useUsers, useFinanciers, type CaseSummary } from "@/lib/hooks";
import { useSession } from "@/components/shell/Shell";
import { Field } from "@/components/ui/primitives";
import { toast } from "@/components/ui/toast";

/**
 * The action panel for the case's current stage, driven by stage × role × sub-status (BRD §4.2).
 * Gates are shown as explanations; the API answers GATE_NOT_MET when a rule is not met.
 */
export function StepPanel({ c, onChange }: { c: CaseSummary; onChange: () => void }) {
  const s = useSession();
  const role = s.role;
  const closure = useList("closure_reason");
  const users = useUsers(role === "ECOFY_ADMIN" || role === "ITARANG_ADMIN");
  const financiers = useFinanciers(role === "ITARANG_ADMIN");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const [reason, setReason] = useState("");
  const [assignee, setAssignee] = useState("");
  const [financier, setFinancier] = useState("");

  async function run(label: string, fn: () => Promise<unknown>) {
    setBusy(true);
    try { await fn(); toast(label); onChange(); } catch (e) { toast(errorMessage(e), "bad"); } finally { setBusy(false); }
  }
  const temp = (t: string) => run(`Temperature set: ${t}`, () => post(`/cases/${c.id}/temperature`, { temperature: t, note: note || undefined, closureReason: t === "NOT_INTERESTED" ? reason || closure.data?.data[0]?.code : undefined }, { ifMatch: c.version }));
  const ecofy = role === "ECOFY_ADMIN" || role === "ECOFY_USER";
  const itarang = role === "ITARANG_ADMIN" || role === "ITARANG_CALLER";
  const readonly = (who: string) => <p className="rounded-lg bg-[#f7f9fa] p-3 text-[12.5px] text-muted">Read-only for your role at this stage — {who} executes this step.</p>;

  if (c.stage === "CLOSED") {
    return (
      <div className="space-y-3">
        <p className="text-[12.5px] text-muted">The case is closed ({c.closureReason}). {role === "ITARANG_ADMIN" ? "iTarang Admin can reopen a case that never reached a File." : ""}</p>
        {role === "ITARANG_ADMIN" && (
          <div className="flex items-end gap-2">
            <Field label="Reopen reason"><input className="input" value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
            <button className="btn" disabled={busy || reason.length < 3} type="button" onClick={() => run("Case reopened at S0", () => post(`/cases/${c.id}/reopen`, { reason }, { ifMatch: c.version }))}>Reopen</button>
          </div>
        )}
      </div>
    );
  }

  if (c.stage === "S0") {
    if (!ecofy) return readonly("Ecofy (qualification)");
    return (
      <div className="space-y-3">
        <p className="text-[12.5px] text-muted">Set the temperature. <b>Hot</b> moves the case to the iTarang queue at once; <b>Warm</b> stays with Ecofy until pushed; <b>Not interested</b> closes with a reason.</p>
        <Field label="Note (optional)"><textarea className="input" rows={2} value={note} onChange={(e) => setNote(e.target.value)} /></Field>
        <div className="flex flex-wrap gap-2">
          <button className="btn" disabled={busy} type="button" onClick={() => temp("COLD")}>Mark Cold</button>
          <button className="btn border-warn text-warn" disabled={busy} type="button" onClick={() => temp("WARM")}>Mark Warm</button>
          <button className="btn border-bad text-bad" disabled={busy} type="button" onClick={() => temp("HOT")}>Mark Hot → queue</button>
          {c.temperature === "WARM" && <button className="btn btn-primary" disabled={busy} type="button" onClick={() => run("Pushed to iTarang (S1)", () => post(`/cases/${c.id}/push`, { note: note || undefined }, { ifMatch: c.version }))}>Push to iTarang</button>}
        </div>
        <div className="flex items-end gap-2 border-t border-line pt-3">
          <Field label="Closure reason"><select className="input" value={reason} onChange={(e) => setReason(e.target.value)}><option value="">—</option>{(closure.data?.data ?? []).map((r) => <option key={r.code} value={r.code}>{r.label}</option>)}</select></Field>
          <button className="btn btn-danger" disabled={busy || !reason} type="button" onClick={() => temp("NOT_INTERESTED")}>Not interested — close</button>
        </div>
        {role === "ECOFY_ADMIN" && (
          <div className="flex items-end gap-2 border-t border-line pt-3">
            <Field label="Assign to Ecofy User"><select className="input" value={assignee} onChange={(e) => setAssignee(e.target.value)}><option value="">—</option>{(users.data?.data ?? []).filter((u) => u.role === "ECOFY_USER" && u.status === "ACTIVE").map((u) => <option key={u.id} value={u.id}>{u.fullName}</option>)}</select></Field>
            <Field label="Reason (when reassigning)"><input className="input" value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
            <button className="btn" disabled={busy || !assignee} type="button" onClick={() => run("Assigned", () => post(`/cases/${c.id}/assign`, { userId: assignee, reason: reason || undefined }, { ifMatch: c.version }))}>Assign</button>
          </div>
        )}
      </div>
    );
  }

  if (c.stage === "S1") {
    if (role !== "ITARANG_ADMIN") return readonly("iTarang Admin (pickup queue)");
    return (
      <div className="space-y-3">
        <p className="text-[12.5px] text-muted">Assign a caller (moves the case to S2) or return the lead to Ecofy with a reason. Use the <Link className="text-sky" href="/queue">pickup queue</Link> for the full list.</p>
        <div className="flex items-end gap-2">
          <Field label="Assign to"><select className="input" value={assignee} onChange={(e) => setAssignee(e.target.value)}><option value="">—</option>{(users.data?.data ?? []).filter((u) => (u.role === "ITARANG_CALLER" || u.role === "ITARANG_ADMIN") && u.status === "ACTIVE").map((u) => <option key={u.id} value={u.id}>{u.fullName}</option>)}</select></Field>
          <button className="btn btn-primary" disabled={busy || !assignee} type="button" onClick={() => run("Assigned — case at S2", () => post(`/cases/${c.id}/assign`, { userId: assignee }, { ifMatch: c.version }))}>Pick up & assign</button>
        </div>
      </div>
    );
  }

  if (c.stage === "S2") {
    if (!itarang) return readonly("iTarang (follow-up)");
    return (
      <div className="space-y-3">
        <p className="text-[12.5px] text-muted">Log calls and remarks, book meetings or an EPC visit (tabs above). <b>Gate to S3:</b> at least one completed meeting or EPC visit (setting).</p>
        <button className="btn btn-primary" disabled={busy} type="button" onClick={() => run("Advanced to assessment (S3)", () => post(`/cases/${c.id}/advance`, undefined, { ifMatch: c.version }))}>Advance to assessment →</button>
        {role === "ITARANG_ADMIN" && <ReassignRow c={c} busy={busy} run={run} />}
        {role === "ITARANG_ADMIN" && c.owner === "ECOFY" && <ReturnRow c={c} busy={busy} run={run} />}
        <CloseRow c={c} busy={busy} run={run} />
      </div>
    );
  }

  if (c.stage === "S3") {
    if (!itarang) return readonly("iTarang (assessment)");
    return (
      <div className="space-y-3">
        <p className="text-[12.5px] text-muted">{c.segment === "CI" ? "C&I: the calculator is off — record a manual or EPC assessment (EPC quote required)." : "Run the calculator or record a manual/external assessment in the Assessment tab, then confirm it to close S3."}</p>
        <p className="text-[12.5px]">Open the <b>Assessment</b> tab to save and confirm an assessment (S3 → S4).</p>
        {role === "ITARANG_ADMIN" && <ReassignRow c={c} busy={busy} run={run} />}
        <CloseRow c={c} busy={busy} run={run} />
      </div>
    );
  }

  if (c.stage === "S4") {
    return (
      <div className="space-y-3">
        <p className="text-[12.5px] text-muted">Order: eligibility, then the EPC quote (setting <span className="mono">gates.s4_order</span>). The caller sees only <b>within / above limit</b>, never the amount. Sending the offer sends the customer OTP (S4 → S5).</p>
        {itarang && <p className="text-[12.5px]">Use the <b>Offer</b> tab: send for eligibility, upload the EPC quote PDF, compose the offer and send the OTP.</p>}
        {role === "ECOFY_ADMIN" && <p className="text-[12.5px]">Eligibility decisions are recorded in the <Link className="text-sky" href="/eligibility-queue">eligibility queue</Link>.</p>}
        {role === "ITARANG_ADMIN" && c.subStatus === "NOT_ELIGIBLE" && (
          <div className="flex items-end gap-2 border-t border-line pt-3">
            <Field label="Route to financier"><select className="input" value={financier} onChange={(e) => setFinancier(e.target.value)}><option value="">—</option>{(financiers.data?.data ?? []).filter((f) => f.id !== c.financierId && f.active).map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}</select></Field>
            <Field label="Note"><input className="input" value={note} onChange={(e) => setNote(e.target.value)} /></Field>
            <button className="btn" disabled={busy || !financier || note.length < 3} type="button" onClick={() => run("Routed to the next financier", () => post(`/cases/${c.id}/route-financier`, { financierId: financier, note }, { ifMatch: c.version }))}>Route</button>
          </div>
        )}
        {itarang && <CloseRow c={c} busy={busy} run={run} />}
        {role === "ITARANG_ADMIN" && <ReassignRow c={c} busy={busy} run={run} />}
      </div>
    );
  }

  if (c.stage === "S5") {
    return (
      <div className="space-y-3">
        <p className="text-[12.5px] text-muted">OTP sent to the customer. Enter the code the customer reads out in the <b>Offer</b> tab; on verification the File is created and locked (S5 → S6) and Ecofy is notified.</p>
        {itarang && <p className="text-[12.5px]">A withdrawal after this point needs iTarang Admin confirmation (Withdrawal tab).</p>}
      </div>
    );
  }

  if (c.stage === "S6") {
    return (
      <div className="space-y-3">
        <p className="text-[12.5px] text-muted">File locked; awaiting the financier&apos;s decision. Installation may start in parallel (Installation tab) with a warning while no sanction is recorded.</p>
        {role === "ECOFY_ADMIN" && <p className="text-[12.5px]">Record the sanction or rejection in the <b>Financing</b> tab or the <Link className="text-sky" href="/financing-queue">financing queue</Link>. A sanction below the accepted total triggers a re-acceptance OTP.</p>}
        {role === "ITARANG_ADMIN" && c.subStatus === "REJECTED_ROUTING" && (
          <div className="flex items-end gap-2 border-t border-line pt-3">
            <Field label="Route to financier"><select className="input" value={financier} onChange={(e) => setFinancier(e.target.value)}><option value="">—</option>{(financiers.data?.data ?? []).filter((f) => f.id !== c.financierId && f.active).map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}</select></Field>
            <Field label="Note"><input className="input" value={note} onChange={(e) => setNote(e.target.value)} /></Field>
            <button className="btn" disabled={busy || !financier || note.length < 3} type="button" onClick={() => run("Routed to the next financier", () => post(`/cases/${c.id}/route-financier`, { financierId: financier, note }, { ifMatch: c.version }))}>Route</button>
          </div>
        )}
        {role === "ITARANG_ADMIN" && c.subStatus === "REJECTED_ROUTING" && <p className="text-[12.5px] text-muted">Or close as rejected by all financiers through a withdrawal / closure.</p>}
      </div>
    );
  }

  if (c.stage === "S7") {
    return <p className="text-[12.5px] text-muted">Sanction recorded. Track the installation (Installation tab). {role === "ECOFY_ADMIN" ? "Record the down payment and, once INSTALLED with photos and the acceptance letter, the disbursement (Financing tab) — that moves the case to S8." : "Ecofy records the payout after installation."}</p>;
  }

  if (c.stage === "S8") {
    return <p className="text-[12.5px] text-muted">Disbursement recorded; the asset is active. EMI status, buyback and redeployment are recorded by Ecofy Admin under <Link className="text-sky" href="/assets">Assets</Link>. After-sales stays outside the platform.</p>;
  }
  return null;
}

function CloseRow({ c, busy, run }: { c: CaseSummary; busy: boolean; run: (label: string, fn: () => Promise<unknown>) => Promise<void> }) {
  const closure = useList("closure_reason");
  const [reason, setReason] = useState("");
  const [note, setNote] = useState("");
  return (
    <div className="flex items-end gap-2 border-t border-line pt-3">
      <Field label="Close with reason"><select className="input" value={reason} onChange={(e) => setReason(e.target.value)}><option value="">—</option>{(closure.data?.data ?? []).map((r) => <option key={r.code} value={r.code}>{r.label}</option>)}</select></Field>
      <Field label="Note"><input className="input" value={note} onChange={(e) => setNote(e.target.value)} /></Field>
      <button className="btn btn-danger" disabled={busy || !reason} type="button" onClick={() => run("Case closed", () => post(`/cases/${c.id}/close`, { closureReason: reason, note: note || undefined }, { ifMatch: c.version }))}>Close case</button>
    </div>
  );
}

function ReassignRow({ c, busy, run }: { c: CaseSummary; busy: boolean; run: (label: string, fn: () => Promise<unknown>) => Promise<void> }) {
  const users = useUsers();
  const [assignee, setAssignee] = useState("");
  const [reason, setReason] = useState("");
  return (
    <div className="flex items-end gap-2 border-t border-line pt-3">
      <Field label="Reassign within iTarang"><select className="input" value={assignee} onChange={(e) => setAssignee(e.target.value)}><option value="">—</option>{(users.data?.data ?? []).filter((u) => (u.role === "ITARANG_CALLER" || u.role === "ITARANG_ADMIN") && u.status === "ACTIVE" && u.id !== c.assignedUserId).map((u) => <option key={u.id} value={u.id}>{u.fullName}</option>)}</select></Field>
      <Field label="Reason (mandatory)"><input className="input" value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
      <button className="btn" disabled={busy || !assignee || reason.length < 3} type="button" onClick={() => run("Reassigned", () => post(`/cases/${c.id}/assign`, { userId: assignee, reason }, { ifMatch: c.version }))}>Reassign</button>
    </div>
  );
}

function ReturnRow({ c, busy, run }: { c: CaseSummary; busy: boolean; run: (label: string, fn: () => Promise<unknown>) => Promise<void> }) {
  const reasons = useList("return_reason");
  const [code, setCode] = useState("");
  const [note, setNote] = useState("");
  return (
    <div className="flex items-end gap-2 border-t border-line pt-3">
      <Field label="Return to Ecofy — reason"><select className="input" value={code} onChange={(e) => setCode(e.target.value)}><option value="">—</option>{(reasons.data?.data ?? []).map((r) => <option key={r.code} value={r.code}>{r.label}</option>)}</select></Field>
      <Field label="Note"><input className="input" value={note} onChange={(e) => setNote(e.target.value)} /></Field>
      <button className="btn btn-danger" disabled={busy || !code} type="button" onClick={() => run("Returned to Ecofy", () => post(`/cases/${c.id}/return`, { reasonCode: code, note: note || undefined }, { ifMatch: c.version }))}>Return</button>
    </div>
  );
}
