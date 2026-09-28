"use client";

// S4, the financier's admin: record the eligibility decision for THIS case
// without leaving it. The pending check comes from the eligibility queue
// (scoped to the caller's financier); the form mirrors the queue page's modal.

import { useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { get, post } from "@/lib/api";
import type { CaseSummary } from "@/lib/hooks";
import { useSession } from "@/components/shell/Shell";
import { Field } from "@/components/ui/primitives";
import { useCaseAction } from "./shared";

type Row = { id: string; eligibility: { id: string; status: string; requestedAt: string; reason: string | null } };

export function EligibilityDecisionInline({ c, onChange }: { c: CaseSummary; onChange: () => void }) {
  const s = useSession();
  const admin = s.role === "ECOFY_ADMIN" || s.role === "ITARANG_ADMIN";
  const q = useQuery({ queryKey: ["eligibility-queue"], queryFn: () => get<Row[]>("/eligibility-queue?limit=100"), enabled: admin });
  const { busy, run } = useCaseAction(c.id, onChange, ["eligibility", "eligibility-queue", "offers", "quotes"]);
  const [f, setF] = useState({ status: "ELIGIBLE", maxEligibleInr: "", reason: "" });
  if (!admin) return null;
  const row = q.data?.data.find((r) => r.id === c.id);
  if (q.isLoading) return <div className="text-[12.5px] text-muted">Loading the eligibility request…</div>;
  if (!row) {
    return (
      <p className="text-[12.5px] text-muted">
        This request is not in your eligibility queue (another financier&apos;s role decides it). <Link className="text-sky" href="/eligibility-queue">Open the queue</Link>.
      </p>
    );
  }
  return (
    <div className="grid gap-2 rounded-lg bg-page p-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
      <Field label="Decision">
        <select className="input" value={f.status} onChange={(e) => setF((x) => ({ ...x, status: e.target.value }))}>
          <option value="ELIGIBLE">Eligible (maximum amount)</option>
          <option value="NOT_ELIGIBLE">Not eligible (reason)</option>
          <option value="INFO_NEEDED">Info needed (note to the caller)</option>
        </select>
      </Field>
      {f.status === "ELIGIBLE" ? (
        <Field label="Maximum eligible amount (₹, your role only)"><input className="input mono" type="number" min={1} value={f.maxEligibleInr} onChange={(e) => setF((x) => ({ ...x, maxEligibleInr: e.target.value }))} /></Field>
      ) : (
        <Field label={f.status === "NOT_ELIGIBLE" ? "Reason" : "Note to the caller"}><input className="input" value={f.reason} onChange={(e) => setF((x) => ({ ...x, reason: e.target.value }))} /></Field>
      )}
      <button
        className="btn btn-green"
        type="button"
        disabled={busy || (f.status === "ELIGIBLE" ? !(Number(f.maxEligibleInr) > 0) : f.reason.trim().length < 3)}
        onClick={() => run(`${f.status.replace("_", " ").toLowerCase()} recorded`, () => post(`/eligibility/${row.eligibility.id}/decision`, { status: f.status, maxEligibleInr: f.status === "ELIGIBLE" ? Number(f.maxEligibleInr) : undefined, reason: f.status !== "ELIGIBLE" ? f.reason : undefined }))}
      >
        Record
      </button>
    </div>
  );
}
