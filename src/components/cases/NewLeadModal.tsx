"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { post, errorMessage } from "@/lib/api";
import { useList } from "@/lib/hooks";
import { Field, Modal } from "@/components/ui/primitives";
import { toast } from "@/components/ui/toast";
import { useSession } from "@/components/shell/Shell";

/** FR-03.8: EU creates at S0 with a consent tick; IA creates an iTarang-sourced lead at S1. */
export function NewLeadModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const s = useSession();
  const router = useRouter();
  const lists = { consent: useList("consent_source"), lang: useList("language"), prop: useList("property_type"), pi: useList("product_interest"), backup: useList("existing_backup"), call: useList("call_time") };
  const [f, setF] = useState<Record<string, string>>({ segment: "RESI", customerType: "INDIVIDUAL", consentSource: "CALL", consentDate: new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date()) });
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF((x) => ({ ...x, [k]: e.target.value }));
  const opt = (q: { data?: { data: Array<{ code: string; label: string }> } }) => (q.data?.data ?? []).map((i) => <option key={i.code} value={i.code}>{i.label}</option>);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!consent) { toast("Tick the consent confirmation first", "warn"); return; }
    setBusy(true);
    try {
      const body = {
        customer: { fullName: f.fullName, mobile: f.mobile, altMobile: f.altMobile || undefined, email: f.email || undefined, customerType: f.customerType, businessName: f.businessName || undefined, address: f.address, city: f.city, state: f.state, pincode: f.pincode, preferredLanguage: f.preferredLanguage || undefined, propertyType: f.propertyType || undefined, consentObtained: true, consentDate: f.consentDate, consentSource: f.consentSource },
        segment: f.segment, productInterest: f.productInterest || undefined, avgMonthlyBillInr: f.avgMonthlyBillInr ? Number(f.avgMonthlyBillInr) : undefined, sanctionedLoadKw: f.sanctionedLoadKw ? Number(f.sanctionedLoadKw) : undefined, existingBackup: f.existingBackup || undefined, preferredCallTime: f.preferredCallTime || undefined,
      };
      const r = await post<{ id: string; caseNo: string }>("/cases", body, { idempotent: true });
      toast(`Case ${r.data.caseNo} created`);
      onClose();
      router.push(`/cases/${r.data.id}`);
    } catch (err) {
      toast(errorMessage(err), "bad");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title={s.org === "ITARANG" ? "New iTarang-sourced lead (starts at S1)" : "New lead (starts at S0)"} wide>
      <form onSubmit={submit} className="grid grid-cols-2 gap-3">
        <Field label="Customer name"><input className="input" required maxLength={100} onChange={set("fullName")} /></Field>
        <Field label="Mobile (10 digits)"><input className="input mono" required pattern="[6-9][0-9]{9}" onChange={set("mobile")} /></Field>
        <Field label="Segment"><select className="input" value={f.segment} onChange={set("segment")}><option value="RESI">RESI</option><option value="ESS">ESS</option><option value="CI">C&amp;I</option></select></Field>
        <Field label="Customer type"><select className="input" value={f.customerType} onChange={set("customerType")}><option value="INDIVIDUAL">Individual</option><option value="BUSINESS">Business</option></select></Field>
        {f.customerType === "BUSINESS" && <Field label="Business name"><input className="input" required onChange={set("businessName")} /></Field>}
        <Field label="Pincode"><input className="input mono" required pattern="[1-9][0-9]{5}" onChange={set("pincode")} /></Field>
        <Field label="City"><input className="input" required onChange={set("city")} /></Field>
        <Field label="State"><input className="input" required onChange={set("state")} /></Field>
        <div className="col-span-2"><Field label="Address"><input className="input" required maxLength={250} onChange={set("address")} /></Field></div>
        <Field label="Consent source"><select className="input" value={f.consentSource} onChange={set("consentSource")}>{opt(lists.consent)}</select></Field>
        <Field label="Consent date"><input className="input" type="date" value={f.consentDate} required onChange={set("consentDate")} /></Field>
        <Field label="Alternate mobile"><input className="input mono" pattern="[6-9][0-9]{9}" onChange={set("altMobile")} /></Field>
        <Field label="Email"><input className="input" type="email" onChange={set("email")} /></Field>
        <Field label="Preferred language"><select className="input" onChange={set("preferredLanguage")}><option value="">—</option>{opt(lists.lang)}</select></Field>
        <Field label="Property type"><select className="input" onChange={set("propertyType")}><option value="">—</option>{opt(lists.prop)}</select></Field>
        <Field label="Product interest"><select className="input" onChange={set("productInterest")}><option value="">—</option>{opt(lists.pi)}</select></Field>
        <Field label="Existing backup"><select className="input" onChange={set("existingBackup")}><option value="">—</option>{opt(lists.backup)}</select></Field>
        <Field label="Avg monthly bill (₹)"><input className="input mono" type="number" min={0} onChange={set("avgMonthlyBillInr")} /></Field>
        <Field label="Sanctioned load (kW)"><input className="input mono" type="number" min={0} step="0.1" onChange={set("sanctionedLoadKw")} /></Field>
        <Field label="Preferred call time"><select className="input" onChange={set("preferredCallTime")}><option value="">—</option>{opt(lists.call)}</select></Field>
        <label className="col-span-2 flex items-start gap-2 rounded-lg bg-page p-3 text-[12.5px]">
          <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} className="mt-0.5" />
          <span>I confirm this customer has consented to be contacted about solar and storage products by Ecofy and iTarang (DPDP). The confirmation is logged.</span>
        </label>
        <div className="col-span-2 flex justify-end gap-2">
          <button className="btn" type="button" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" type="submit" disabled={busy}>{busy ? "Saving…" : "Create lead"}</button>
        </div>
      </form>
    </Modal>
  );
}
