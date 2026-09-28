"use client";

// Stage-transition rows shared by the CurrentStepCard (formerly StepPanel):
// qualify (S0), pick up & assign (S1), advance, route to the next financier,
// reassign, return, close, reopen / new linked case. Each renders nothing when
// the signed-in role may not do it at the case's stage; the API re-checks.

import { useState } from "react";
import Link from "next/link";
import { post } from "@/lib/api";
import { useList, useUsers, useFinanciers, type CaseSummary } from "@/lib/hooks";
import { useSession } from "@/components/shell/Shell";
import { Field } from "@/components/ui/primitives";
import { NewLeadModal } from "@/components/cases/NewLeadModal";
import { useCaseAction } from "./shared";

type P = { c: CaseSummary; onChange: () => void };

const rowCls = "grid gap-2 sm:grid-cols-[1fr_1fr_auto] sm:items-end";

/** S0, Ecofy roles: temperature, push (Warm), Not interested; Ecofy Admin also assigns an Ecofy User. */
export function QualifyPanel({ c, onChange }: P) {
  const s = useSession();
  const closure = useList("closure_reason");
  const { busy, run } = useCaseAction(c.id, onChange);
  const [note, setNote] = useState("");
  const [reason, setReason] = useState("");
  const ecofy = s.role === "ECOFY_ADMIN" || s.role === "ECOFY_USER";
  if (!ecofy || c.stage !== "S0") return null;
  const temp = (t: string) =>
    run(`Temperature set: ${t}`, () =>
      post(`/cases/${c.id}/temperature`, { temperature: t, note: note || undefined, closureReason: t === "NOT_INTERESTED" ? reason || closure.data?.data[0]?.code : undefined }, { ifMatch: c.version }),
    );
  return (
    <div className="space-y-3">
      <Field label="Note (optional)"><textarea className="input" rows={2} value={note} onChange={(e) => setNote(e.target.value)} /></Field>
      <div className="flex flex-wrap gap-2">
        <button className="btn" disabled={busy} type="button" onClick={() => temp("COLD")}>Mark Cold</button>
        <button className="btn border-warn text-warn" disabled={busy} type="button" onClick={() => temp("WARM")}>Mark Warm</button>
        <button className="btn border-bad text-bad" disabled={busy} type="button" onClick={() => temp("HOT")}>Mark Hot → queue</button>
        {c.temperature === "WARM" && (
          <button className="btn btn-primary" disabled={busy} type="button" onClick={() => run("Pushed to iTarang (S1)", () => post(`/cases/${c.id}/push`, { note: note || undefined }, { ifMatch: c.version }))}>
            Push to iTarang
          </button>
        )}
      </div>
      <div className={`${rowCls} border-t border-line pt-3`}>
        <Field label="Closure reason">
          <select className="input" value={reason} onChange={(e) => setReason(e.target.value)}>
            <option value="">—</option>
            {(closure.data?.data ?? []).map((r) => <option key={r.code} value={r.code}>{r.label}</option>)}
          </select>
        </Field>
        <div />
        <button className="btn btn-danger" disabled={busy || !reason} type="button" onClick={() => temp("NOT_INTERESTED")}>Not interested — close</button>
      </div>
      <AssignEcofyUserRow c={c} onChange={onChange} />
    </div>
  );
}

/** S0, Ecofy Admin: hand the qualification to an Ecofy User. */
export function AssignEcofyUserRow({ c, onChange }: P) {
  const s = useSession();
  const users = useUsers(s.role === "ECOFY_ADMIN");
  const { busy, run } = useCaseAction(c.id, onChange);
  const [assignee, setAssignee] = useState("");
  const [reason, setReason] = useState("");
  if (s.role !== "ECOFY_ADMIN" || c.stage !== "S0") return null;
  return (
    <div className={`${rowCls} border-t border-line pt-3`}>
      <Field label="Assign to Ecofy User">
        <select className="input" value={assignee} onChange={(e) => setAssignee(e.target.value)}>
          <option value="">—</option>
          {(users.data?.data ?? []).filter((u) => u.role === "ECOFY_USER" && u.status === "ACTIVE").map((u) => <option key={u.id} value={u.id}>{u.fullName}</option>)}
        </select>
      </Field>
      <Field label="Reason (when reassigning)"><input className="input" value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
      <button className="btn" disabled={busy || !assignee} type="button" onClick={() => run("Assigned", () => post(`/cases/${c.id}/assign`, { userId: assignee, reason: reason || undefined }, { ifMatch: c.version }))}>Assign</button>
    </div>
  );
}

/** S1, iTarang Admin: assign a caller (moves the case to S2). */
export function PickupAssignRow({ c, onChange }: P) {
  const s = useSession();
  const users = useUsers(s.role === "ITARANG_ADMIN");
  const { busy, run } = useCaseAction(c.id, onChange);
  const [assignee, setAssignee] = useState("");
  if (s.role !== "ITARANG_ADMIN" || c.stage !== "S1") return null;
  return (
    <div className="space-y-2">
      <div className={rowCls}>
        <Field label="Assign to">
          <select className="input" value={assignee} onChange={(e) => setAssignee(e.target.value)}>
            <option value="">—</option>
            {(users.data?.data ?? []).filter((u) => (u.role === "ITARANG_CALLER" || u.role === "ITARANG_ADMIN") && u.status === "ACTIVE").map((u) => <option key={u.id} value={u.id}>{u.fullName}</option>)}
          </select>
        </Field>
        <div />
        <button className="btn btn-primary" disabled={busy || !assignee} type="button" onClick={() => run("Assigned — case at S2", () => post(`/cases/${c.id}/assign`, { userId: assignee }, { ifMatch: c.version }))}>Pick up & assign</button>
      </div>
      <p className="text-[12px] text-muted">Use the <Link className="text-sky" href="/queue">pickup queue</Link> for the full list.</p>
    </div>
  );
}

/** S2 → S3 (iTarang roles). */
export function AdvanceButton({ c, onChange }: P) {
  const s = useSession();
  const { busy, run } = useCaseAction(c.id, onChange);
  if (!(s.role === "ITARANG_ADMIN" || s.role === "ITARANG_CALLER") || c.stage !== "S2") return null;
  return (
    <button className="btn btn-primary" disabled={busy} type="button" onClick={() => run("Advanced to assessment (S3)", () => post(`/cases/${c.id}/advance`, undefined, { ifMatch: c.version }))}>
      Advance to assessment →
    </button>
  );
}

/** S2–S7, iTarang Admin: move the case to another caller (reason mandatory). */
export function ReassignRow({ c, onChange }: P) {
  const s = useSession();
  const users = useUsers(s.role === "ITARANG_ADMIN");
  const { busy, run } = useCaseAction(c.id, onChange);
  const [assignee, setAssignee] = useState("");
  const [reason, setReason] = useState("");
  if (s.role !== "ITARANG_ADMIN" || !["S2", "S3", "S4", "S5", "S6", "S7"].includes(c.stage)) return null;
  return (
    <div className={rowCls}>
      <Field label="Reassign within iTarang">
        <select className="input" value={assignee} onChange={(e) => setAssignee(e.target.value)}>
          <option value="">—</option>
          {(users.data?.data ?? []).filter((u) => (u.role === "ITARANG_CALLER" || u.role === "ITARANG_ADMIN") && u.status === "ACTIVE" && u.id !== c.assignedUserId).map((u) => <option key={u.id} value={u.id}>{u.fullName}</option>)}
        </select>
      </Field>
      <Field label="Reason (mandatory)"><input className="input" value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
      <button className="btn" disabled={busy || !assignee || reason.length < 3} type="button" onClick={() => run("Reassigned", () => post(`/cases/${c.id}/assign`, { userId: assignee, reason }, { ifMatch: c.version }))}>Reassign</button>
    </div>
  );
}

/** S1–S2, Ecofy-sourced leads, iTarang Admin: back to Ecofy's qualifier with a reason. */
export function ReturnRow({ c, onChange }: P) {
  const s = useSession();
  const reasons = useList("return_reason");
  const { busy, run } = useCaseAction(c.id, onChange);
  const [code, setCode] = useState("");
  const [note, setNote] = useState("");
  if (s.role !== "ITARANG_ADMIN" || c.owner !== "ECOFY" || !["S1", "S2"].includes(c.stage)) return null;
  return (
    <div className={rowCls}>
      <Field label="Return to Ecofy — reason">
        <select className="input" value={code} onChange={(e) => setCode(e.target.value)}>
          <option value="">—</option>
          {(reasons.data?.data ?? []).map((r) => <option key={r.code} value={r.code}>{r.label}</option>)}
        </select>
      </Field>
      <Field label="Note"><input className="input" value={note} onChange={(e) => setNote(e.target.value)} /></Field>
      <button className="btn btn-danger" disabled={busy || !code} type="button" onClick={() => run("Returned to Ecofy", () => post(`/cases/${c.id}/return`, { reasonCode: code, note: note || undefined }, { ifMatch: c.version }))}>Return</button>
    </div>
  );
}

/** S1–S4, iTarang roles: close with a reason. */
export function CloseRow({ c, onChange }: P) {
  const s = useSession();
  const closure = useList("closure_reason");
  const { busy, run } = useCaseAction(c.id, onChange);
  const [reason, setReason] = useState("");
  const [note, setNote] = useState("");
  if (!(s.role === "ITARANG_ADMIN" || s.role === "ITARANG_CALLER") || !["S1", "S2", "S3", "S4"].includes(c.stage)) return null;
  return (
    <div className={rowCls}>
      <Field label="Close with reason">
        <select className="input" value={reason} onChange={(e) => setReason(e.target.value)}>
          <option value="">—</option>
          {(closure.data?.data ?? []).map((r) => <option key={r.code} value={r.code}>{r.label}</option>)}
        </select>
      </Field>
      <Field label="Note"><input className="input" value={note} onChange={(e) => setNote(e.target.value)} /></Field>
      <button className="btn btn-danger" disabled={busy || !reason} type="button" onClick={() => run("Case closed", () => post(`/cases/${c.id}/close`, { closureReason: reason, note: note || undefined }, { ifMatch: c.version }))}>Close case</button>
    </div>
  );
}

/** S4 NOT_ELIGIBLE / S6 REJECTED_ROUTING, iTarang Admin: next financier. */
export function RouteFinancierRow({ c, onChange }: P) {
  const s = useSession();
  const financiers = useFinanciers(s.role === "ITARANG_ADMIN");
  const { busy, run } = useCaseAction(c.id, onChange);
  const [financier, setFinancier] = useState("");
  const [note, setNote] = useState("");
  if (s.role !== "ITARANG_ADMIN" || !((c.stage === "S4" && c.subStatus === "NOT_ELIGIBLE") || (c.stage === "S6" && c.subStatus === "REJECTED_ROUTING"))) return null;
  return (
    <div className={rowCls}>
      <Field label="Route to financier">
        <select className="input" value={financier} onChange={(e) => setFinancier(e.target.value)}>
          <option value="">—</option>
          {(financiers.data?.data ?? []).filter((f) => f.id !== c.financierId && f.active).map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
        </select>
      </Field>
      <Field label="Note (mandatory)"><input className="input" value={note} onChange={(e) => setNote(e.target.value)} /></Field>
      <button className="btn" disabled={busy || !financier || note.length < 3} type="button" onClick={() => run("Routed to the next financier", () => post(`/cases/${c.id}/route-financier`, { financierId: financier, note }, { ifMatch: c.version }))}>Route</button>
    </div>
  );
}

/**
 * CLOSED (CONFLICTS #29): Ecofy roles and iTarang Admin reopen at S0; a case
 * that reached a File never reopens (database trigger) — start a linked case.
 */
export function ReopenBlock({ c, onChange }: P) {
  const s = useSession();
  const { busy, run } = useCaseAction(c.id, onChange);
  const [reason, setReason] = useState("");
  const [linkedOpen, setLinkedOpen] = useState(false);
  const canReopen = s.role === "ECOFY_ADMIN" || s.role === "ECOFY_USER" || s.role === "ITARANG_ADMIN";
  if (c.stage !== "CLOSED" || !canReopen) return null;
  const cu = c.customer;
  if (!c.hasFile) {
    return (
      <div className="grid gap-2 sm:grid-cols-[1fr_auto] sm:items-end">
        <Field label="Reopen reason"><input className="input" value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
        <button className="btn" disabled={busy || reason.length < 3} type="button" onClick={() => run("Case reopened at S0", () => post(`/cases/${c.id}/reopen`, { reason }, { ifMatch: c.version }))}>Reopen</button>
      </div>
    );
  }
  return (
    <>
      <button className="btn btn-primary" type="button" onClick={() => setLinkedOpen(true)}>Start a new linked case</button>
      <NewLeadModal
        open={linkedOpen}
        onClose={() => setLinkedOpen(false)}
        initial={cu ? {
          fullName: cu.fullName, mobile: (cu.mobile ?? "").replace(/^\+91/, ""), altMobile: (cu.altMobile ?? "").replace(/^\+91/, ""), email: cu.email ?? "",
          customerType: cu.customerType, businessName: cu.businessName ?? "", address: cu.address ?? "", city: cu.city, state: cu.state, pincode: cu.pincode,
          preferredLanguage: cu.preferredLanguage ?? "", propertyType: cu.propertyType ?? "", segment: c.segment, productInterest: c.productInterest ?? "",
        } : undefined}
      />
    </>
  );
}
