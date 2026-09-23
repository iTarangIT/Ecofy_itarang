"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { get, post, patch, errorMessage } from "@/lib/api";
import { Card, Empty, Field, Modal } from "@/components/ui/primitives";
import { toast } from "@/components/ui/toast";
import { useSession } from "@/components/shell/Shell";
import { useUsers, fmtDateTime } from "@/lib/hooks";
import { ROLE_LABEL } from "@/core/auth/rbac";

type Seat = { role: string; seatLimit: number; seatsUsed: number };

/** M01 FR-01.7 … FR-01.9: invite, deactivate, reset password, revoke devices; seats (IA raises caps). */
export default function UsersPage() {
  const s = useSession();
  const qc = useQueryClient();
  const users = useUsers();
  const seats = useQuery({ queryKey: ["seats"], queryFn: () => get<Seat[]>("/seats"), enabled: s.role === "ITARANG_ADMIN" });
  const [inv, setInv] = useState({ open: false, fullName: "", email: "", mobile: "", role: s.role === "ECOFY_ADMIN" ? "ECOFY_USER" : "ITARANG_CALLER" });
  const [busy, setBusy] = useState(false);
  const refresh = () => { qc.invalidateQueries({ queryKey: ["users"] }); qc.invalidateQueries({ queryKey: ["seats"] }); };
  const run = async (label: string, fn: () => Promise<unknown>) => { setBusy(true); try { await fn(); toast(label); refresh(); } catch (e) { toast(errorMessage(e), "bad"); } finally { setBusy(false); } };
  const roles = s.role === "ECOFY_ADMIN" ? ["ECOFY_USER"] : ["ECOFY_ADMIN", "ECOFY_USER", "ITARANG_ADMIN", "ITARANG_CALLER"];

  return (
    <div className="space-y-4">
      {s.role === "ITARANG_ADMIN" && (
        <Card title="Seats (billing meter — counts only, never blocks access)" right="every change is written to the seat ledger">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            {(seats.data?.data ?? []).map((st) => (
              <div key={st.role} className="rounded-lg border border-line p-3 text-[12.5px]">
                <div className="font-semibold">{ROLE_LABEL[st.role as keyof typeof ROLE_LABEL]}</div>
                <div className="mono text-[20px] text-navy">{st.seatsUsed} / {st.seatLimit}</div>
                <button className="btn btn-sm mt-1" type="button" disabled={busy} onClick={() => { const v = window.prompt(`New seat cap for ${st.role} (0–50)`, String(st.seatLimit)); const r = v ? window.prompt("Reason") : null; if (v && r) run("Seat cap updated", () => patch(`/seats/${st.role}`, { seatLimit: Number(v), reason: r })); }}>Change cap</button>
              </div>
            ))}
          </div>
        </Card>
      )}
      <Card title="Users" right={<button className="btn btn-sm btn-primary" type="button" onClick={() => setInv((x) => ({ ...x, open: true }))}>+ Invite user</button>} pad={false}>
        <table className="w-full"><thead><tr><th className="th">Name</th><th className="th">Email</th><th className="th">Role</th><th className="th">Status</th><th className="th">Last login</th><th className="th" /></tr></thead><tbody>
          {(users.data?.data ?? []).map((u) => (
            <tr key={u.id}><td className="td font-semibold">{u.fullName}</td><td className="td">{u.email}</td><td className="td">{ROLE_LABEL[u.role as keyof typeof ROLE_LABEL]}</td><td className="td"><span className={`chip ${u.status === "ACTIVE" ? "bg-ecofy-soft text-ecofy" : u.status === "INVITED" ? "bg-sky-soft text-sky" : "bg-chip text-muted"}`}>{u.status}</span></td><td className="td text-[12px]">{fmtDateTime(u.lastLoginAt)}</td>
              <td className="td text-right"><div className="flex justify-end gap-1">
                {u.status !== "DEACTIVATED" && u.id !== s.userId && <button className="btn btn-sm btn-danger" type="button" disabled={busy} onClick={() => { const r = window.prompt("Reason for deactivation"); if (r) run("User deactivated — open cases unassigned", () => patch(`/users/${u.id}`, { status: "DEACTIVATED", reason: r })); }}>Deactivate</button>}
                {u.status === "DEACTIVATED" && <button className="btn btn-sm" type="button" disabled={busy} onClick={() => run("User reactivated", () => patch(`/users/${u.id}`, { status: "ACTIVE" }))}>Reactivate</button>}
                <button className="btn btn-sm" type="button" disabled={busy} onClick={() => run("Reset link sent", () => post(`/users/${u.id}/reset-password`))}>Reset password</button>
                {s.role === "ITARANG_ADMIN" && <button className="btn btn-sm" type="button" disabled={busy} onClick={() => { const r = window.prompt("Reason for revoking trusted devices"); if (r) run("Devices revoked", () => post(`/users/${u.id}/revoke-devices`, { reason: r })); }}>Revoke devices</button>}
              </div></td></tr>
          ))}
        </tbody></table>
        {users.data && users.data.data.length === 0 && <Empty>No users.</Empty>}
      </Card>
      <Modal open={inv.open} onClose={() => setInv((x) => ({ ...x, open: false }))} title="Invite user (seat check)">
        <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); run("Invited — the sign-in link was emailed", async () => { await post("/users", { fullName: inv.fullName, email: inv.email, mobile: inv.mobile || undefined, role: inv.role }); setInv((x) => ({ ...x, open: false })); }); }}>
          <Field label="Full name"><input className="input" required minLength={2} value={inv.fullName} onChange={(e) => setInv((x) => ({ ...x, fullName: e.target.value }))} /></Field>
          <Field label="Email"><input className="input" type="email" required value={inv.email} onChange={(e) => setInv((x) => ({ ...x, email: e.target.value }))} /></Field>
          <Field label="Mobile (optional)"><input className="input mono" pattern="[6-9][0-9]{9}" value={inv.mobile} onChange={(e) => setInv((x) => ({ ...x, mobile: e.target.value }))} /></Field>
          <Field label="Role"><select className="input" value={inv.role} onChange={(e) => setInv((x) => ({ ...x, role: e.target.value }))}>{roles.map((r) => <option key={r} value={r}>{ROLE_LABEL[r as keyof typeof ROLE_LABEL]}</option>)}</select></Field>
          <div className="flex justify-end"><button className="btn btn-primary" type="submit" disabled={busy}>Invite</button></div>
        </form>
      </Modal>
    </div>
  );
}
