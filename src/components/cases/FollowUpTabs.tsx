"use client";

// Activities, Appointments and Documents. The forms are exported on their own
// so the CurrentStepCard can show exactly the one the case needs next.

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { get, post, patch, del, uploadDocument, errorMessage } from "@/lib/api";
import { useEpcPartners, useList, fmtDateTime, type CaseSummary } from "@/lib/hooks";
import { useSession } from "@/components/shell/Shell";
import { Card, DateTimeField, Empty, Field } from "@/components/ui/primitives";
import { toast } from "@/components/ui/toast";
import { useCaseAction } from "./shared";

type P = { c: CaseSummary; onChange: () => void };

// ---------------------------------------------------------------------------
// Activities
// ---------------------------------------------------------------------------

type Activity = { id: number; type: string; callOutcome: string | null; note: string | null; nextFollowUpAt: string | null; at: string; actor: { fullName: string; role: string } | null };

/** Log a call / remark / follow-up / comment. Ecofy after handoff (and Ecofy Admin) may only comment. */
export function LogActivityForm({ c, onChange }: P) {
  const s = useSession();
  const { busy, run } = useCaseAction(c.id, onChange, ["activities"]);
  const commentOnly = ((s.role === "ECOFY_USER" || s.role === "ECOFY_ADMIN") && c.stage !== "S0") || s.role === "ECOFY_ADMIN";
  const [f, setF] = useState({ type: commentOnly ? "COMMENT" : "CALL", callOutcome: "CONNECTED", note: "", nextFollowUpAt: "" });
  if (c.stage === "CLOSED") return null;
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const ok = await run("Logged", () =>
      post(`/cases/${c.id}/activities`, { type: f.type, callOutcome: f.type === "CALL" ? f.callOutcome : undefined, note: f.note || undefined, nextFollowUpAt: f.nextFollowUpAt ? new Date(f.nextFollowUpAt).toISOString() : undefined }),
    );
    if (ok) setF((x) => ({ ...x, note: "", nextFollowUpAt: "" }));
  }
  return (
    <form onSubmit={submit} className="grid grid-cols-2 gap-2 rounded-lg bg-page p-3">
      <Field label="Type">
        <select className="input" value={f.type} onChange={(e) => setF((x) => ({ ...x, type: e.target.value }))} disabled={commentOnly}>
          {(commentOnly ? ["COMMENT"] : ["CALL", "REMARK", "FOLLOW_UP", "COMMENT"]).map((t) => <option key={t}>{t}</option>)}
        </select>
      </Field>
      {f.type === "CALL" && (
        <Field label="Outcome (mandatory)">
          <select className="input" value={f.callOutcome} onChange={(e) => setF((x) => ({ ...x, callOutcome: e.target.value }))}>
            {["CONNECTED", "NO_ANSWER", "BUSY", "SWITCHED_OFF", "WRONG_NUMBER", "CALL_BACK"].map((o) => <option key={o}>{o}</option>)}
          </select>
        </Field>
      )}
      {(f.type === "FOLLOW_UP" || f.type === "CALL") && <DateTimeField label="Next follow-up" value={f.nextFollowUpAt} onChange={(v) => setF((x) => ({ ...x, nextFollowUpAt: v }))} required={f.type === "FOLLOW_UP"} />}
      <div className="col-span-2"><Field label="Note"><textarea className="input" rows={2} value={f.note} onChange={(e) => setF((x) => ({ ...x, note: e.target.value }))} /></Field></div>
      <div className="col-span-2 flex justify-end"><button className="btn btn-primary btn-sm" type="submit" disabled={busy}>Log</button></div>
    </form>
  );
}

export function ActivitiesTab({ c, onChange }: P) {
  const q = useQuery({ queryKey: ["activities", c.id], queryFn: () => get<Activity[]>(`/cases/${c.id}/activities`) });
  return (
    <Card title="Calls, remarks & follow-ups" right="append-only">
      <div className="mb-3"><LogActivityForm c={c} onChange={onChange} /></div>
      {(q.data?.data ?? []).length === 0 && <Empty>No activities yet.</Empty>}
      <div className="space-y-2">
        {(q.data?.data ?? []).slice().reverse().map((a) => (
          <div key={a.id} className="grid grid-cols-[120px_1fr] gap-3 border-b border-line pb-2 text-[12.5px]">
            <div className="mono text-[11.5px] text-muted">{fmtDateTime(a.at)}</div>
            <div><b>{a.type}{a.callOutcome ? ` · ${a.callOutcome}` : ""}</b> {a.note && <span>— {a.note}</span>}{a.nextFollowUpAt && <div className="text-muted">next follow-up {fmtDateTime(a.nextFollowUpAt)}</div>}<div className="text-[11px] text-muted">{a.actor?.fullName}</div></div>
          </div>
        ))}
      </div>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Appointments
// ---------------------------------------------------------------------------

export type Appointment = { id: string; meetingType: string; scheduledAt: string; status: string; bookingRemarks: string | null; actualAt: string | null; meetingRemarks: string | null; outcomeReason: string | null; epcPartnerId: string | null; epcFeedback: string | null; rescheduledFrom: string | null };

const isItarang = (role: string) => role === "ITARANG_ADMIN" || role === "ITARANG_CALLER";

/** Book a meeting or EPC visit (iTarang roles, S1–S8). */
export function BookMeetingForm({ c, onChange }: P) {
  const s = useSession();
  const types = useList("meeting_type");
  const epcs = useEpcPartners();
  const { busy, run } = useCaseAction(c.id, onChange, ["appointments"]);
  const [f, setF] = useState({ meetingType: "PHONE", scheduledAt: "", bookingRemarks: "", epcPartnerId: "" });
  if (!isItarang(s.role) || c.stage === "CLOSED" || c.stage === "S0") return null;
  async function book(e: React.FormEvent) {
    e.preventDefault();
    const ok = await run("Appointment booked", () =>
      post(`/cases/${c.id}/appointments`, { meetingType: f.meetingType, scheduledAt: new Date(f.scheduledAt).toISOString(), bookingRemarks: f.bookingRemarks || undefined, epcPartnerId: f.meetingType === "EPC_VISIT" ? f.epcPartnerId : undefined }),
    );
    if (ok) setF((x) => ({ ...x, scheduledAt: "", bookingRemarks: "" }));
  }
  return (
    <form onSubmit={book} className="grid grid-cols-2 gap-2 rounded-lg bg-page p-3">
      <Field label="Type"><select className="input" value={f.meetingType} onChange={(e) => setF((x) => ({ ...x, meetingType: e.target.value }))}>{(types.data?.data ?? []).map((t) => <option key={t.code} value={t.code}>{t.label}</option>)}</select></Field>
      <DateTimeField label="Scheduled at" required value={f.scheduledAt} onChange={(v) => setF((x) => ({ ...x, scheduledAt: v }))} />
      {f.meetingType === "EPC_VISIT" && <Field label="EPC partner"><select className="input" required value={f.epcPartnerId} onChange={(e) => setF((x) => ({ ...x, epcPartnerId: e.target.value }))}><option value="">—</option>{(epcs.data?.data ?? []).filter((p) => p.active).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></Field>}
      <div className={f.meetingType === "EPC_VISIT" ? "" : "col-span-2"}><Field label="Booking remarks"><input className="input" value={f.bookingRemarks} onChange={(e) => setF((x) => ({ ...x, bookingRemarks: e.target.value }))} /></Field></div>
      <div className="col-span-2 flex justify-end"><button className="btn btn-primary btn-sm" type="submit" disabled={busy || !f.scheduledAt}>Book</button></div>
    </form>
  );
}

/** One appointment with its complete / no-show / cancel / reschedule block while SCHEDULED (iTarang roles). */
export function AppointmentCard({ c, a, onChange }: P & { a: Appointment }) {
  const s = useSession();
  const { busy, run } = useCaseAction(c.id, onChange, ["appointments"]);
  const [act, setAct] = useState<{ actualAt?: string; meetingRemarks?: string; outcomeReason?: string; scheduledAt?: string; epcFeedback?: string }>({});
  const update = (action: string) =>
    run(`Appointment ${action.toLowerCase()}`, () =>
      patch(`/appointments/${a.id}`, { action, actualAt: act.actualAt ? new Date(act.actualAt).toISOString() : undefined, meetingRemarks: act.meetingRemarks, outcomeReason: act.outcomeReason, scheduledAt: act.scheduledAt ? new Date(act.scheduledAt).toISOString() : undefined, epcFeedback: act.epcFeedback }),
    );
  return (
    <div className="rounded-lg border border-line bg-white p-3 text-[12.5px]">
      <div className="flex flex-wrap items-center gap-2"><b>{a.meetingType}</b><span className={`chip ${a.status === "COMPLETED" ? "bg-ecofy-soft text-ecofy" : a.status === "SCHEDULED" ? "bg-sky-soft text-sky" : "bg-chip text-muted"}`}>{a.status}</span>{a.rescheduledFrom && <span className="text-muted">rescheduled</span>}</div>
      <dl className="kv mt-2"><dt>Scheduled</dt><dd className="mono">{fmtDateTime(a.scheduledAt)}</dd><dt>Actual</dt><dd className="mono">{fmtDateTime(a.actualAt)}</dd><dt>Booking remarks</dt><dd>{a.bookingRemarks ?? "—"}</dd><dt>Meeting remarks</dt><dd>{a.meetingRemarks ?? "—"}</dd>{a.outcomeReason && <><dt>Reason</dt><dd>{a.outcomeReason}</dd></>}{a.meetingType === "EPC_VISIT" && <><dt>EPC feedback</dt><dd>{a.epcFeedback ?? "—"}</dd></>}</dl>
      {isItarang(s.role) && a.status === "SCHEDULED" && (
        <div className="mt-2 grid grid-cols-2 gap-2 border-t border-line pt-2">
          <DateTimeField label="Actual date & time" value={act.actualAt ?? ""} onChange={(v) => setAct((x) => ({ ...x, actualAt: v }))} />
          <Field label="Meeting remarks (mandatory)"><input className="input" onChange={(e) => setAct((x) => ({ ...x, meetingRemarks: e.target.value }))} /></Field>
          {a.meetingType === "EPC_VISIT" && <div className="col-span-2"><Field label="EPC feedback"><input className="input" onChange={(e) => setAct((x) => ({ ...x, epcFeedback: e.target.value }))} /></Field></div>}
          <div className="col-span-2 flex flex-wrap items-end gap-2">
            <button className="btn btn-sm btn-primary" type="button" disabled={busy} onClick={() => update("COMPLETE")}>Mark completed</button>
            <input className="input w-40" placeholder="no-show / cancel reason" onChange={(e) => setAct((x) => ({ ...x, outcomeReason: e.target.value }))} />
            <button className="btn btn-sm" type="button" disabled={busy} onClick={() => update("NO_SHOW")}>No-show</button>
            <button className="btn btn-sm" type="button" disabled={busy} onClick={() => update("CANCEL")}>Cancel</button>
            <div className="w-72"><DateTimeField label="New time (to reschedule)" value={act.scheduledAt ?? ""} onChange={(v) => setAct((x) => ({ ...x, scheduledAt: v }))} /></div>
            <button className="btn btn-sm" type="button" disabled={busy} onClick={() => update("RESCHEDULE")}>Reschedule</button>
          </div>
        </div>
      )}
    </div>
  );
}

export function AppointmentsTab({ c, onChange }: P) {
  const q = useQuery({ queryKey: ["appointments", c.id], queryFn: () => get<Appointment[]>(`/cases/${c.id}/appointments`) });
  return (
    <Card title="Meetings & EPC visits" right="scheduled vs actual">
      <div className="mb-3"><BookMeetingForm c={c} onChange={onChange} /></div>
      {(q.data?.data ?? []).length === 0 && <Empty>No appointments.</Empty>}
      <div className="space-y-3">
        {(q.data?.data ?? []).map((a) => <AppointmentCard key={a.id} c={c} a={a} onChange={onChange} />)}
      </div>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Documents
// ---------------------------------------------------------------------------

export type Doc = { id: string; typeCode: string; fileName: string; mimeType: string; sizeBytes: number; uploadedAt: string; retentionUntil: string | null };

/**
 * Upload one document. With `fixedType` the type picker is hidden — the
 * CurrentStepCard uses this for the S7 proof (INSTALLATION_PHOTO and
 * CUSTOMER_ACCEPTANCE_LETTER, which Ecofy's installation_proof gate needs).
 */
export function DocumentUploadControl({ c, onChange, fixedType, label }: P & { fixedType?: string; label?: string }) {
  const types = useList("document_type");
  const { busy, run } = useCaseAction(c.id, onChange, ["documents"]);
  const [typeCode, setTypeCode] = useState(fixedType ?? "SITE_PHOTO");
  const [consent, setConsent] = useState(false);
  if (c.stage === "CLOSED") return null;
  async function upload(e: React.ChangeEvent<HTMLInputElement>) {
    const input = e.target;
    const file = input.files?.[0];
    if (!file) return;
    if (file.size > 26_214_400) { input.value = ""; return toast("Max 25 MB", "warn"); }
    await run("Uploaded", () => uploadDocument(c.id, file, typeCode, { recordingConsent: typeCode === "CALL_RECORDING" ? consent : undefined }));
    input.value = "";
  }
  const blocked = busy || (typeCode === "CALL_RECORDING" && !consent);
  return (
    <div className="flex flex-wrap items-end gap-2 rounded-lg bg-page p-3">
      {!fixedType && (
        <Field label="Type">
          <select className="input" value={typeCode} onChange={(e) => setTypeCode(e.target.value)}>
            {(types.data?.data ?? []).filter((t) => t.code !== "EPC_QUOTE").map((t) => <option key={t.code} value={t.code}>{t.label}</option>)}
          </select>
        </Field>
      )}
      {fixedType && <span className="label mb-0 self-center">{label ?? fixedType.replace(/_/g, " ").toLowerCase()}</span>}
      {typeCode === "CALL_RECORDING" && <label className="flex items-center gap-1 text-[12px]"><input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} /> Customer consented to recording (deleted after 60 days)</label>}
      <label className={`btn btn-navy ${blocked ? "pointer-events-none opacity-50" : "cursor-pointer"}`}>
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="17 8 12 3 7 8" /><line x1="12" y1="3" x2="12" y2="15" /></svg>
        {busy ? "Uploading…" : "Choose file & upload"}
        <input type="file" accept=".pdf,.jpg,.jpeg,.png,.mp3,.m4a,.wav" className="sr-only" disabled={blocked} onChange={upload} />
      </label>
    </div>
  );
}

export function DocumentsTab({ c, onChange }: P) {
  const s = useSession();
  const q = useQuery({ queryKey: ["documents", c.id], queryFn: () => get<Doc[]>(`/cases/${c.id}/documents`) });
  const { busy, run } = useCaseAction(c.id, onChange, ["documents"]);
  const admin = s.role === "ECOFY_ADMIN" || s.role === "ITARANG_ADMIN";
  async function download(id: string) {
    try { const r = await get<{ url: string }>(`/documents/${id}/download-url`); window.open(r.data.url, "_blank"); } catch (err) { toast(errorMessage(err), "bad"); }
  }
  async function remove(id: string) {
    const reason = window.prompt("Reason for deleting this document?");
    if (!reason || reason.length < 3) return;
    await run("Deleted", () => del(`/documents/${id}`, { reason }));
  }
  return (
    <Card title="Documents & recordings" right="PDF, JPG, PNG, MP3, M4A, WAV · 25 MB · no KYC types">
      <div className="mb-3"><DocumentUploadControl c={c} onChange={onChange} /></div>
      {(q.data?.data ?? []).length === 0 && <Empty>No documents.</Empty>}
      <table className="w-full"><tbody>
        {(q.data?.data ?? []).map((d) => (
          <tr key={d.id}><td className="td"><span className="chip bg-chip text-teal">{d.typeCode}</span></td><td className="td">{d.fileName}<div className="text-[11px] text-muted">{(d.sizeBytes / 1024).toFixed(0)} KB · {fmtDateTime(d.uploadedAt)}{d.retentionUntil ? ` · purge ${d.retentionUntil}` : ""}</div></td><td className="td text-right"><button className="btn btn-sm" type="button" onClick={() => download(d.id)}>Download</button> {admin && <button className="btn btn-sm btn-danger" type="button" disabled={busy} onClick={() => remove(d.id)}>Delete</button>}</td></tr>
        ))}
      </tbody></table>
    </Card>
  );
}
