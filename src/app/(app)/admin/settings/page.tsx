"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { get, post, patch, put, errorMessage } from "@/lib/api";
import { Banner, Card, Empty, Field, Modal } from "@/components/ui/primitives";
import { toast } from "@/components/ui/toast";
import { useSession } from "@/components/shell/Shell";
import { useEpcPartners, useFinanciers, useSettings } from "@/lib/hooks";

const LISTS = ["return_reason", "closure_reason", "meeting_type", "document_type", "language", "consent_source", "property_type", "product_interest", "existing_backup", "call_time"];
const GROUPS: Array<{ title: string; keys: string[] }> = [
  { title: "Gates", keys: ["gates.meeting_before_assessment", "gates.s4_order", "gates.sanction_before_installation", "gates.down_payment_before_installation", "gates.allow_provisional_quote_acceptance"] },
  { title: "Intake & retention", keys: ["intake.max_rows", "intake.consent_attestation_text", "imports.raw_retention_days", "recordings.retention_days", "permissions.ecofy_docs_after_handoff"] },
  { title: "Ageing & quotes", keys: ["ageing.bands_working_days", "quotes.default_validity_days", "systems.price_refresh_days", "appointments.reminder_minutes_before"] },
  { title: "OTP & SMS", keys: ["otp.length", "otp.expiry_minutes", "otp.max_attempts", "otp.resend_after_seconds", "otp.max_sends_per_offer_per_hour", "sms.sender_id", "sms.dlt_template_acceptance", "sms.dlt_template_reacceptance"] },
  { title: "Login & devices", keys: ["auth.device_otp_expiry_minutes", "auth.device_otp_max_attempts", "auth.device_lockout_minutes", "auth.trusted_device_days"] },
  { title: "Other", keys: ["notifications.admin_daily_digest", "exports.mask_mobile_in_lists", "idempotency.ttl_hours", "billing.usage_view_enabled"] },
];

/** M02: settings (typed, logged), lists (codes never deleted), calendar, EPC partners, financiers. IA edits; EA views. */
export default function SettingsPage() {
  const s = useSession();
  const canEdit = s.role === "ITARANG_ADMIN";
  const [tab, setTab] = useState<"Settings" | "Lists" | "Calendar" | "EPC partners" | "Financiers">("Settings");
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-1">{(["Settings", "Lists", "Calendar", "EPC partners", "Financiers"] as const).map((t) => <button key={t} type="button" className={`btn btn-sm ${tab === t ? "btn-navy" : ""}`} onClick={() => setTab(t)}>{t}</button>)}</div>
      {!canEdit && <Banner kind="amber">Ecofy Admin views settings; iTarang Admin edits them. Every change is logged with who, when and old/new values.</Banner>}
      {tab === "Settings" && <SettingsTab canEdit={canEdit} />}
      {tab === "Lists" && <ListsTab canEdit={canEdit} />}
      {tab === "Calendar" && <CalendarTab canEdit={canEdit} />}
      {tab === "EPC partners" && <EpcTab canEdit={canEdit} />}
      {tab === "Financiers" && <FinanciersTab canEdit={canEdit} />}
    </div>
  );
}

function SettingsTab({ canEdit }: { canEdit: boolean }) {
  const qc = useQueryClient();
  const settings = useSettings();
  const [edit, setEdit] = useState<{ key: string; value: string; reason: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const all = settings.data?.data ?? {};
  const known = new Set(GROUPS.flatMap((g) => g.keys));
  const extra = Object.keys(all).filter((k) => !known.has(k));
  async function save() {
    if (!edit) return;
    setBusy(true);
    try {
      let value: unknown = edit.value;
      const cur = all[edit.key];
      if (typeof cur === "number") value = Number(edit.value);
      else if (typeof cur === "boolean") value = edit.value === "true";
      else if (Array.isArray(cur)) value = JSON.parse(edit.value);
      else if (cur === null && edit.value === "") value = null;
      await patch(`/settings/${edit.key}`, { value, reason: edit.reason || undefined });
      toast(`${edit.key} updated`); setEdit(null); qc.invalidateQueries({ queryKey: ["settings"] });
    } catch (e) { toast(errorMessage(e), "bad"); } finally { setBusy(false); }
  }
  const show = (v: unknown) => (v === null ? "—" : typeof v === "object" ? JSON.stringify(v) : String(v));
  return (
    <div className="space-y-4">
      {[...GROUPS, ...(extra.length ? [{ title: "Additional", keys: extra }] : [])].map((g) => (
        <Card key={g.title} title={g.title} pad={false}>
          <table className="w-full"><tbody>
            {g.keys.map((k) => (
              <tr key={k}><td className="td mono text-[12px]">{k}</td><td className="td mono text-[12.5px]">{show(all[k])}</td><td className="td text-right">{canEdit && <button className="btn btn-sm" type="button" onClick={() => setEdit({ key: k, value: all[k] === null ? "" : typeof all[k] === "object" ? JSON.stringify(all[k]) : String(all[k]), reason: "" })}>Edit</button>}</td></tr>
            ))}
          </tbody></table>
        </Card>
      ))}
      <Modal open={Boolean(edit)} onClose={() => setEdit(null)} title={edit?.key ?? ""}>
        {edit && (
          <div className="space-y-3">
            {typeof all[edit.key] === "boolean" ? <Field label="Value"><select className="input" value={edit.value} onChange={(e) => setEdit((x) => x && ({ ...x, value: e.target.value }))}><option value="true">true</option><option value="false">false</option></select></Field>
              : edit.key === "gates.s4_order" ? <Field label="Value"><select className="input" value={edit.value} onChange={(e) => setEdit((x) => x && ({ ...x, value: e.target.value }))}><option>ELIGIBILITY_FIRST</option><option>QUOTE_FIRST</option><option>PARALLEL</option></select></Field>
              : <Field label="Value" hint={Array.isArray(all[edit.key]) ? "JSON array, e.g. [1, 3, 7]" : typeof all[edit.key] === "number" ? "number" : "text"}><textarea className="input mono" rows={3} value={edit.value} onChange={(e) => setEdit((x) => x && ({ ...x, value: e.target.value }))} /></Field>}
            <Field label="Reason (logged)"><input className="input" value={edit.reason} onChange={(e) => setEdit((x) => x && ({ ...x, reason: e.target.value }))} /></Field>
            <div className="flex justify-end gap-2"><button className="btn" type="button" onClick={() => setEdit(null)}>Cancel</button><button className="btn btn-primary" type="button" disabled={busy} onClick={save}>Save</button></div>
          </div>
        )}
      </Modal>
    </div>
  );
}

function ListsTab({ canEdit }: { canEdit: boolean }) {
  const qc = useQueryClient();
  const [code, setCode] = useState(LISTS[0]);
  const q = useQuery({ queryKey: ["list-admin", code], queryFn: () => get<Array<{ id: string; code: string; label: string; sortOrder: number; active: boolean }>>(`/lists/${code}/items`) });
  const [add, setAdd] = useState({ code: "", label: "" });
  const [busy, setBusy] = useState(false);
  const run = async (label: string, fn: () => Promise<unknown>) => { setBusy(true); try { await fn(); toast(label); qc.invalidateQueries({ queryKey: ["list-admin", code] }); qc.invalidateQueries({ queryKey: ["list", code] }); } catch (e) { toast(errorMessage(e), "bad"); } finally { setBusy(false); } };
  return (
    <Card title="Lists" right="codes are never deleted; deactivate instead. KYC-like document types are rejected by the database." pad={false}>
      <div className="flex flex-wrap gap-1 border-b border-line px-4 py-3">{LISTS.map((l) => <button key={l} type="button" className={`btn btn-sm ${code === l ? "btn-navy" : ""}`} onClick={() => setCode(l)}>{l}</button>)}</div>
      <table className="w-full"><thead><tr><th className="th">Code</th><th className="th">Label</th><th className="th">Order</th><th className="th">Active</th><th className="th" /></tr></thead><tbody>
        {(q.data?.data ?? []).map((i) => (
          <tr key={i.id} className={i.active ? "" : "opacity-50"}><td className="td mono">{i.code}</td><td className="td">{i.label}</td><td className="td mono">{i.sortOrder}</td><td className="td">{i.active ? "yes" : "no"}</td><td className="td text-right">{canEdit && <><button className="btn btn-sm" type="button" disabled={busy} onClick={() => { const l = window.prompt("New label", i.label); if (l) run("Renamed", () => patch(`/lists/${code}/items/${i.id}`, { label: l })); }}>Rename</button> <button className="btn btn-sm" type="button" disabled={busy} onClick={() => run(i.active ? "Deactivated" : "Reactivated", () => patch(`/lists/${code}/items/${i.id}`, { active: !i.active }))}>{i.active ? "Deactivate" : "Reactivate"}</button></>}</td></tr>
        ))}
      </tbody></table>
      {canEdit && (
        <form className="flex items-end gap-2 border-t border-line px-4 py-3" onSubmit={(e) => { e.preventDefault(); run("Item added", async () => { await post(`/lists/${code}/items`, { code: add.code.toUpperCase(), label: add.label }); setAdd({ code: "", label: "" }); }); }}>
          <Field label="Code (A–Z, 0–9, _)"><input className="input mono" required pattern="[A-Za-z0-9_]{2,40}" value={add.code} onChange={(e) => setAdd((x) => ({ ...x, code: e.target.value }))} /></Field>
          <Field label="Label"><input className="input" required value={add.label} onChange={(e) => setAdd((x) => ({ ...x, label: e.target.value }))} /></Field>
          <button className="btn btn-primary btn-sm" type="submit" disabled={busy}>Add</button>
        </form>
      )}
      {q.data && q.data.data.length === 0 && <Empty>Empty list.</Empty>}
    </Card>
  );
}

function CalendarTab({ canEdit }: { canEdit: boolean }) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["calendar"], queryFn: () => get<{ workingHours: Array<{ weekday: number; start: string; end: string }>; holidays: Array<{ day: string; name: string }> }>("/calendar") });
  const [draft, setDraft] = useState<{ workingHours: Array<{ weekday: number; start: string; end: string }>; holidays: Array<{ day: string; name: string }> } | null>(null);
  const d = draft ?? q.data?.data ?? { workingHours: [], holidays: [] };
  const days = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  async function save() {
    try { await put("/calendar", d); toast("Calendar saved"); setDraft(null); qc.invalidateQueries({ queryKey: ["calendar"] }); } catch (e) { toast(errorMessage(e), "bad"); }
  }
  return (
    <Card title="Working calendar (drives every ageing figure)" right="default Mon–Fri 10:00–19:00 IST">
      <div className="grid gap-4 md:grid-cols-2">
        <div>
          <div className="label">Working hours</div>
          {days.map((name, i) => {
            const wd = i + 1; const row = d.workingHours.find((w) => w.weekday === wd);
            return (
              <div key={wd} className="flex items-center gap-2 py-1 text-[12.5px]">
                <label className="w-20 flex items-center gap-1"><input type="checkbox" disabled={!canEdit} checked={Boolean(row)} onChange={(e) => setDraft({ ...d, workingHours: e.target.checked ? [...d.workingHours, { weekday: wd, start: "10:00", end: "19:00" }].sort((a, b) => a.weekday - b.weekday) : d.workingHours.filter((w) => w.weekday !== wd) })} /> {name}</label>
                {row && <><input className="input w-24" type="time" disabled={!canEdit} value={row.start} onChange={(e) => setDraft({ ...d, workingHours: d.workingHours.map((w) => (w.weekday === wd ? { ...w, start: e.target.value } : w)) })} /> – <input className="input w-24" type="time" disabled={!canEdit} value={row.end} onChange={(e) => setDraft({ ...d, workingHours: d.workingHours.map((w) => (w.weekday === wd ? { ...w, end: e.target.value } : w)) })} /></>}
              </div>
            );
          })}
        </div>
        <div>
          <div className="label">Holidays</div>
          {d.holidays.map((h, i) => <div key={i} className="flex items-center gap-2 py-1 text-[12.5px]"><span className="mono">{h.day}</span><span className="flex-1">{h.name}</span>{canEdit && <button className="text-bad" type="button" onClick={() => setDraft({ ...d, holidays: d.holidays.filter((_, j) => j !== i) })}>✕</button>}</div>)}
          {canEdit && <form className="mt-2 flex items-end gap-2" onSubmit={(e) => { e.preventDefault(); const fd = new FormData(e.currentTarget); setDraft({ ...d, holidays: [...d.holidays, { day: String(fd.get("day")), name: String(fd.get("name")) }].sort((a, b) => a.day.localeCompare(b.day)) }); e.currentTarget.reset(); }}><Field label="Date"><input className="input" name="day" type="date" required /></Field><Field label="Name"><input className="input" name="name" required /></Field><button className="btn btn-sm" type="submit">Add</button></form>}
        </div>
      </div>
      {canEdit && <div className="mt-3 flex justify-end"><button className="btn btn-primary" type="button" disabled={!draft} onClick={save}>Save calendar</button></div>}
    </Card>
  );
}

function EpcTab({ canEdit }: { canEdit: boolean }) {
  const qc = useQueryClient();
  const epcs = useEpcPartners();
  const [f, setF] = useState<{ id?: string; name: string; contactName: string; mobile: string; email: string; pincodes: string; segments: string[]; active: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  async function save() {
    if (!f) return;
    setBusy(true);
    try {
      const body = { name: f.name, contactName: f.contactName || undefined, mobile: f.mobile || undefined, email: f.email || undefined, pincodes: f.pincodes.split(/[,\s]+/).filter(Boolean), segments: f.segments, active: f.active };
      if (f.id) await patch(`/epc-partners/${f.id}`, body); else await post("/epc-partners", body);
      toast("EPC partner saved"); setF(null); qc.invalidateQueries({ queryKey: ["epc-partners"] });
    } catch (e) { toast(errorMessage(e), "bad"); } finally { setBusy(false); }
  }
  return (
    <Card title="EPC partners" right={canEdit ? <button className="btn btn-sm btn-primary" type="button" onClick={() => setF({ name: "", contactName: "", mobile: "", email: "", pincodes: "", segments: ["RESI"], active: true })}>+ Add</button> : undefined} pad={false}>
      <table className="w-full"><thead><tr><th className="th">Name</th><th className="th">Contact</th><th className="th">Pincodes</th><th className="th">Segments</th><th className="th">Active</th><th className="th" /></tr></thead><tbody>
        {(epcs.data?.data ?? []).map((p) => <tr key={p.id}><td className="td font-semibold">{p.name}</td><td className="td text-[12px]">{p.contactName} {p.mobile} {p.email}</td><td className="td mono text-[11.5px]">{p.pincodes.join(", ")}</td><td className="td text-[12px]">{p.segments.join(", ")}</td><td className="td">{p.active ? "yes" : "no"}</td><td className="td text-right">{canEdit && <button className="btn btn-sm" type="button" onClick={() => setF({ id: p.id, name: p.name, contactName: p.contactName ?? "", mobile: p.mobile ?? "", email: p.email ?? "", pincodes: p.pincodes.join(", "), segments: p.segments, active: p.active })}>Edit</button>}</td></tr>)}
      </tbody></table>
      {epcs.data && epcs.data.data.length === 0 && <Empty>No EPC partners yet — add the partners who quote and install.</Empty>}
      <Modal open={Boolean(f)} onClose={() => setF(null)} title={f?.id ? "Edit EPC partner" : "New EPC partner"}>
        {f && (
          <div className="grid grid-cols-2 gap-3">
            <Field label="Name"><input className="input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
            <Field label="Contact name"><input className="input" value={f.contactName} onChange={(e) => setF({ ...f, contactName: e.target.value })} /></Field>
            <Field label="Mobile"><input className="input mono" value={f.mobile} onChange={(e) => setF({ ...f, mobile: e.target.value })} /></Field>
            <Field label="Email"><input className="input" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></Field>
            <div className="col-span-2"><Field label="Pincodes served (comma separated)"><input className="input mono" value={f.pincodes} onChange={(e) => setF({ ...f, pincodes: e.target.value })} /></Field></div>
            <div className="col-span-2 flex gap-3 text-[12.5px]">{["RESI", "ESS", "CI"].map((sg) => <label key={sg} className="flex items-center gap-1"><input type="checkbox" checked={f.segments.includes(sg)} onChange={(e) => setF({ ...f, segments: e.target.checked ? [...f.segments, sg] : f.segments.filter((x) => x !== sg) })} /> {sg === "CI" ? "C&I" : sg}</label>)}<label className="ml-auto flex items-center gap-1"><input type="checkbox" checked={f.active} onChange={(e) => setF({ ...f, active: e.target.checked })} /> Active</label></div>
            <div className="col-span-2 flex justify-end gap-2"><button className="btn" type="button" onClick={() => setF(null)}>Cancel</button><button className="btn btn-primary" type="button" disabled={busy} onClick={save}>Save</button></div>
          </div>
        )}
      </Modal>
    </Card>
  );
}

function FinanciersTab({ canEdit }: { canEdit: boolean }) {
  const qc = useQueryClient();
  const fins = useFinanciers();
  const [f, setF] = useState<{ id?: string; name: string; valuesVisibleTo: string; active: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  async function save() {
    if (!f) return;
    setBusy(true);
    try {
      if (f.id) await patch(`/financiers/${f.id}`, { name: f.name, valuesVisibleTo: f.valuesVisibleTo, active: f.active }); else await post("/financiers", { name: f.name, valuesVisibleTo: f.valuesVisibleTo, active: f.active });
      toast("Financier saved"); setF(null); qc.invalidateQueries({ queryKey: ["financiers"] });
    } catch (e) { toast(errorMessage(e), "bad"); } finally { setBusy(false); }
  }
  return (
    <Card title="Financiers" right={canEdit ? <button className="btn btn-sm btn-primary" type="button" onClick={() => setF({ name: "", valuesVisibleTo: "ITARANG_ADMIN", active: true })}>+ Add</button> : undefined} pad={false}>
      <table className="w-full"><thead><tr><th className="th">Name</th><th className="th">Default</th><th className="th">Values visible to</th><th className="th">Active</th><th className="th" /></tr></thead><tbody>
        {(fins.data?.data ?? []).map((x) => <tr key={x.id}><td className="td font-semibold">{x.name}</td><td className="td">{x.isDefault ? "yes (Ecofy)" : ""}</td><td className="td text-[12px]">{x.valuesVisibleTo}</td><td className="td">{x.active ? "yes" : "no"}</td><td className="td text-right">{canEdit && !x.isDefault && <button className="btn btn-sm" type="button" onClick={() => setF({ id: x.id, name: x.name, valuesVisibleTo: x.valuesVisibleTo, active: x.active })}>Edit</button>}</td></tr>)}
      </tbody></table>
      <Modal open={Boolean(f)} onClose={() => setF(null)} title={f?.id ? "Edit financier" : "New financier"}>
        {f && (
          <div className="space-y-3">
            <Field label="Name"><input className="input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
            <Field label="Role that may see its amounts"><select className="input" value={f.valuesVisibleTo} onChange={(e) => setF({ ...f, valuesVisibleTo: e.target.value })}><option value="ITARANG_ADMIN">iTarang Admin (other financiers)</option><option value="ECOFY_ADMIN">Ecofy Admin</option></select></Field>
            <label className="flex items-center gap-1 text-[12.5px]"><input type="checkbox" checked={f.active} onChange={(e) => setF({ ...f, active: e.target.checked })} /> Active</label>
            <div className="flex justify-end gap-2"><button className="btn" type="button" onClick={() => setF(null)}>Cancel</button><button className="btn btn-primary" type="button" disabled={busy} onClick={save}>Save</button></div>
          </div>
        )}
      </Modal>
    </Card>
  );
}
