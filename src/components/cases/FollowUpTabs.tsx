"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { get, post, patch, del, uploadDocument, errorMessage } from "@/lib/api";
import { useEpcPartners, useList, fmtDateTime, type CaseSummary } from "@/lib/hooks";
import { useSession } from "@/components/shell/Shell";
import { Card, Empty, Field } from "@/components/ui/primitives";
import { toast } from "@/components/ui/toast";

type Activity = { id: number; type: string; callOutcome: string | null; note: string | null; nextFollowUpAt: string | null; at: string; actor: { fullName: string; role: string } | null };

export function ActivitiesTab({ c, onChange }: { c: CaseSummary; onChange: () => void }) {
  const s = useSession();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["activities", c.id], queryFn: () => get<Activity[]>(`/cases/${c.id}/activities`) });
  const ecofyAfterHandoff = (s.role === "ECOFY_USER" || s.role === "ECOFY_ADMIN") && c.stage !== "S0";
  const [f, setF] = useState({ type: ecofyAfterHandoff || s.role === "ECOFY_ADMIN" ? "COMMENT" : "CALL", callOutcome: "CONNECTED", note: "", nextFollowUpAt: "" });
  const [busy, setBusy] = useState(false);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await post(`/cases/${c.id}/activities`, { type: f.type, callOutcome: f.type === "CALL" ? f.callOutcome : undefined, note: f.note || undefined, nextFollowUpAt: f.nextFollowUpAt ? new Date(f.nextFollowUpAt).toISOString() : undefined });
      setF((x) => ({ ...x, note: "", nextFollowUpAt: "" }));
      qc.invalidateQueries({ queryKey: ["activities", c.id] });
      onChange();
      toast("Logged");
    } catch (err) { toast(errorMessage(err), "bad"); } finally { setBusy(false); }
  }
  return (
    <Card title="Calls, remarks & follow-ups" right="append-only">
      {c.stage !== "CLOSED" && (
        <form onSubmit={submit} className="mb-3 grid grid-cols-2 gap-2 rounded-lg bg-page p-3">
          <Field label="Type"><select className="input" value={f.type} onChange={(e) => setF((x) => ({ ...x, type: e.target.value }))} disabled={ecofyAfterHandoff || s.role === "ECOFY_ADMIN"}>{(ecofyAfterHandoff || s.role === "ECOFY_ADMIN" ? ["COMMENT"] : ["CALL", "REMARK", "FOLLOW_UP", "COMMENT"]).map((t) => <option key={t}>{t}</option>)}</select></Field>
          {f.type === "CALL" && <Field label="Outcome (mandatory)"><select className="input" value={f.callOutcome} onChange={(e) => setF((x) => ({ ...x, callOutcome: e.target.value }))}>{["CONNECTED", "NO_ANSWER", "BUSY", "SWITCHED_OFF", "WRONG_NUMBER", "CALL_BACK"].map((o) => <option key={o}>{o}</option>)}</select></Field>}
          {(f.type === "FOLLOW_UP" || f.type === "CALL") && <Field label="Next follow-up"><input className="input" type="datetime-local" value={f.nextFollowUpAt} onChange={(e) => setF((x) => ({ ...x, nextFollowUpAt: e.target.value }))} required={f.type === "FOLLOW_UP"} /></Field>}
          <div className="col-span-2"><Field label="Note"><textarea className="input" rows={2} value={f.note} onChange={(e) => setF((x) => ({ ...x, note: e.target.value }))} /></Field></div>
          <div className="col-span-2 flex justify-end"><button className="btn btn-primary btn-sm" type="submit" disabled={busy}>Log</button></div>
        </form>
      )}
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

type Appointment = { id: string; meetingType: string; scheduledAt: string; status: string; bookingRemarks: string | null; actualAt: string | null; meetingRemarks: string | null; outcomeReason: string | null; epcPartnerId: string | null; epcFeedback: string | null; rescheduledFrom: string | null };

export function AppointmentsTab({ c, onChange }: { c: CaseSummary; onChange: () => void }) {
  const s = useSession();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["appointments", c.id], queryFn: () => get<Appointment[]>(`/cases/${c.id}/appointments`) });
  const types = useList("meeting_type");
  const epcs = useEpcPartners();
  const itarang = s.role === "ITARANG_ADMIN" || s.role === "ITARANG_CALLER";
  const [f, setF] = useState({ meetingType: "PHONE", scheduledAt: "", bookingRemarks: "", epcPartnerId: "" });
  const [act, setAct] = useState<Record<string, { actualAt?: string; meetingRemarks?: string; outcomeReason?: string; scheduledAt?: string; epcFeedback?: string }>>({});
  const refresh = () => { qc.invalidateQueries({ queryKey: ["appointments", c.id] }); onChange(); };
  async function book(e: React.FormEvent) {
    e.preventDefault();
    try {
      await post(`/cases/${c.id}/appointments`, { meetingType: f.meetingType, scheduledAt: new Date(f.scheduledAt).toISOString(), bookingRemarks: f.bookingRemarks || undefined, epcPartnerId: f.meetingType === "EPC_VISIT" ? f.epcPartnerId : undefined });
      toast("Appointment booked"); refresh();
    } catch (err) { toast(errorMessage(err), "bad"); }
  }
  async function update(id: string, action: string) {
    const a = act[id] ?? {};
    try {
      await patch(`/appointments/${id}`, { action, actualAt: a.actualAt ? new Date(a.actualAt).toISOString() : undefined, meetingRemarks: a.meetingRemarks, outcomeReason: a.outcomeReason, scheduledAt: a.scheduledAt ? new Date(a.scheduledAt).toISOString() : undefined, epcFeedback: a.epcFeedback });
      toast(`Appointment ${action.toLowerCase()}`); refresh();
    } catch (err) { toast(errorMessage(err), "bad"); }
  }
  return (
    <Card title="Meetings & EPC visits" right="scheduled vs actual">
      {itarang && c.stage !== "CLOSED" && c.stage !== "S0" && (
        <form onSubmit={book} className="mb-3 grid grid-cols-2 gap-2 rounded-lg bg-page p-3">
          <Field label="Type"><select className="input" value={f.meetingType} onChange={(e) => setF((x) => ({ ...x, meetingType: e.target.value }))}>{(types.data?.data ?? []).map((t) => <option key={t.code} value={t.code}>{t.label}</option>)}</select></Field>
          <Field label="Scheduled at"><input className="input" type="datetime-local" required value={f.scheduledAt} onChange={(e) => setF((x) => ({ ...x, scheduledAt: e.target.value }))} /></Field>
          {f.meetingType === "EPC_VISIT" && <Field label="EPC partner"><select className="input" required value={f.epcPartnerId} onChange={(e) => setF((x) => ({ ...x, epcPartnerId: e.target.value }))}><option value="">—</option>{(epcs.data?.data ?? []).filter((p) => p.active).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></Field>}
          <div className={f.meetingType === "EPC_VISIT" ? "" : "col-span-2"}><Field label="Booking remarks"><input className="input" value={f.bookingRemarks} onChange={(e) => setF((x) => ({ ...x, bookingRemarks: e.target.value }))} /></Field></div>
          <div className="col-span-2 flex justify-end"><button className="btn btn-primary btn-sm" type="submit">Book</button></div>
        </form>
      )}
      {(q.data?.data ?? []).length === 0 && <Empty>No appointments.</Empty>}
      <div className="space-y-3">
        {(q.data?.data ?? []).map((a) => (
          <div key={a.id} className="rounded-lg border border-line p-3 text-[12.5px]">
            <div className="flex flex-wrap items-center gap-2"><b>{a.meetingType}</b><span className={`chip ${a.status === "COMPLETED" ? "bg-ecofy-soft text-ecofy" : a.status === "SCHEDULED" ? "bg-sky-soft text-sky" : "bg-chip text-muted"}`}>{a.status}</span>{a.rescheduledFrom && <span className="text-muted">rescheduled</span>}</div>
            <dl className="kv mt-2"><dt>Scheduled</dt><dd className="mono">{fmtDateTime(a.scheduledAt)}</dd><dt>Actual</dt><dd className="mono">{fmtDateTime(a.actualAt)}</dd><dt>Booking remarks</dt><dd>{a.bookingRemarks ?? "—"}</dd><dt>Meeting remarks</dt><dd>{a.meetingRemarks ?? "—"}</dd>{a.outcomeReason && <><dt>Reason</dt><dd>{a.outcomeReason}</dd></>}{a.meetingType === "EPC_VISIT" && <><dt>EPC feedback</dt><dd>{a.epcFeedback ?? "—"}</dd></>}</dl>
            {itarang && a.status === "SCHEDULED" && (
              <div className="mt-2 grid grid-cols-2 gap-2 border-t border-line pt-2">
                <Field label="Actual date & time"><input className="input" type="datetime-local" onChange={(e) => setAct((x) => ({ ...x, [a.id]: { ...x[a.id], actualAt: e.target.value } }))} /></Field>
                <Field label="Meeting remarks (mandatory)"><input className="input" onChange={(e) => setAct((x) => ({ ...x, [a.id]: { ...x[a.id], meetingRemarks: e.target.value } }))} /></Field>
                {a.meetingType === "EPC_VISIT" && <div className="col-span-2"><Field label="EPC feedback"><input className="input" onChange={(e) => setAct((x) => ({ ...x, [a.id]: { ...x[a.id], epcFeedback: e.target.value } }))} /></Field></div>}
                <div className="col-span-2 flex flex-wrap gap-2"><button className="btn btn-sm btn-primary" type="button" onClick={() => update(a.id, "COMPLETE")}>Mark completed</button>
                  <input className="input w-40" placeholder="no-show / cancel reason" onChange={(e) => setAct((x) => ({ ...x, [a.id]: { ...x[a.id], outcomeReason: e.target.value } }))} />
                  <button className="btn btn-sm" type="button" onClick={() => update(a.id, "NO_SHOW")}>No-show</button><button className="btn btn-sm" type="button" onClick={() => update(a.id, "CANCEL")}>Cancel</button>
                  <input className="input w-48" type="datetime-local" onChange={(e) => setAct((x) => ({ ...x, [a.id]: { ...x[a.id], scheduledAt: e.target.value } }))} /><button className="btn btn-sm" type="button" onClick={() => update(a.id, "RESCHEDULE")}>Reschedule</button></div>
              </div>
            )}
          </div>
        ))}
      </div>
    </Card>
  );
}

type Doc = { id: string; typeCode: string; fileName: string; mimeType: string; sizeBytes: number; uploadedAt: string; retentionUntil: string | null };

export function DocumentsTab({ c, onChange }: { c: CaseSummary; onChange: () => void }) {
  const s = useSession();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["documents", c.id], queryFn: () => get<Doc[]>(`/cases/${c.id}/documents`) });
  const types = useList("document_type");
  const [typeCode, setTypeCode] = useState("SITE_PHOTO");
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const admin = s.role === "ECOFY_ADMIN" || s.role === "ITARANG_ADMIN";
  async function upload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 26_214_400) return toast("Max 25 MB", "warn");
    setBusy(true);
    try {
      await uploadDocument(c.id, file, typeCode, { recordingConsent: typeCode === "CALL_RECORDING" ? consent : undefined });
      toast("Uploaded"); qc.invalidateQueries({ queryKey: ["documents", c.id] }); onChange();
    } catch (err) { toast(errorMessage(err), "bad"); } finally { setBusy(false); e.target.value = ""; }
  }
  async function download(id: string) {
    try { const r = await get<{ url: string }>(`/documents/${id}/download-url`); window.open(r.data.url, "_blank"); } catch (err) { toast(errorMessage(err), "bad"); }
  }
  async function remove(id: string) {
    const reason = window.prompt("Reason for deleting this document?");
    if (!reason || reason.length < 3) return;
    try { await del(`/documents/${id}`, { reason }); toast("Deleted"); qc.invalidateQueries({ queryKey: ["documents", c.id] }); } catch (err) { toast(errorMessage(err), "bad"); }
  }
  return (
    <Card title="Documents & recordings" right="PDF, JPG, PNG, MP3, M4A, WAV · 25 MB · no KYC types">
      {c.stage !== "CLOSED" && (
        <div className="mb-3 flex flex-wrap items-end gap-2 rounded-lg bg-page p-3">
          <Field label="Type"><select className="input" value={typeCode} onChange={(e) => setTypeCode(e.target.value)}>{(types.data?.data ?? []).filter((t) => t.code !== "EPC_QUOTE").map((t) => <option key={t.code} value={t.code}>{t.label}</option>)}</select></Field>
          {typeCode === "CALL_RECORDING" && <label className="flex items-center gap-1 text-[12px]"><input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} /> Customer consented to recording (deleted after 60 days)</label>}
          <input type="file" className="text-[12.5px]" disabled={busy || (typeCode === "CALL_RECORDING" && !consent)} onChange={upload} />
        </div>
      )}
      {(q.data?.data ?? []).length === 0 && <Empty>No documents.</Empty>}
      <table className="w-full"><tbody>
        {(q.data?.data ?? []).map((d) => (
          <tr key={d.id}><td className="td"><span className="chip bg-chip text-teal">{d.typeCode}</span></td><td className="td">{d.fileName}<div className="text-[11px] text-muted">{(d.sizeBytes / 1024).toFixed(0)} KB · {fmtDateTime(d.uploadedAt)}{d.retentionUntil ? ` · purge ${d.retentionUntil}` : ""}</div></td><td className="td text-right"><button className="btn btn-sm" type="button" onClick={() => download(d.id)}>Download</button> {admin && <button className="btn btn-sm btn-danger" type="button" onClick={() => remove(d.id)}>Delete</button>}</td></tr>
        ))}
      </tbody></table>
    </Card>
  );
}
