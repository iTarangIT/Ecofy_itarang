"use client";

import { useEffect, type ReactNode } from "react";
import { clsx } from "clsx";

export function Card({ title, right, children, className, pad = true }: { title?: ReactNode; right?: ReactNode; children: ReactNode; className?: string; pad?: boolean }) {
  return (
    <section className={clsx("card", className)}>
      {title !== undefined && (
        <header className="card-h">
          <div>{title}</div>
          {right && <div className="text-[12px] font-normal text-muted">{right}</div>}
        </header>
      )}
      <div className={pad ? "card-b" : ""}>{children}</div>
    </section>
  );
}

export function Kpi({ label, value, sub }: { label: string; value: ReactNode; sub?: ReactNode }) {
  return (
    <div className="card px-[18px] py-4">
      <div className="text-[11.5px] font-semibold uppercase tracking-[0.07em] text-muted">{label}</div>
      <div className="mt-1 text-[26px] font-bold text-navy leading-tight">{value}</div>
      {sub && <div className="mt-1 text-[12px] text-muted">{sub}</div>}
    </div>
  );
}

export function Banner({ kind = "green", children }: { kind?: "green" | "purple" | "amber" | "red"; children: ReactNode }) {
  return <div className={clsx("banner", { "banner-green": kind === "green", "banner-purple": kind === "purple", "banner-amber": kind === "amber", "banner-red": kind === "red" })}>{children}</div>;
}

const STAGE_LABEL: Record<string, string> = { S0: "S0 Qualification", S1: "S1 Pickup queue", S2: "S2 Follow-up", S3: "S3 Assessment", S4: "S4 Offer", S5: "S5 File", S6: "S6 Financing", S7: "S7 Installation", S8: "S8 Asset", CLOSED: "Closed" };
export const STAGE_OWNER: Record<string, "ECOFY" | "ITARANG" | "EPC"> = { S0: "ECOFY", S1: "ITARANG", S2: "ITARANG", S3: "ITARANG", S4: "ITARANG", S5: "ITARANG", S6: "ECOFY", S7: "EPC", S8: "ECOFY", CLOSED: "ITARANG" };
export const STAGES = ["S0", "S1", "S2", "S3", "S4", "S5", "S6", "S7", "S8"];

export function StageChip({ stage, subStatus }: { stage: string; subStatus?: string | null }) {
  const owner = STAGE_OWNER[stage];
  const cls = stage === "S8" ? "bg-navy text-white" : stage === "CLOSED" ? "bg-chip text-muted" : owner === "ECOFY" ? "bg-ecofy-soft text-ecofy" : owner === "EPC" ? "bg-epc-soft text-epc" : "bg-chip text-teal";
  return (
    <span className={clsx("chip", cls)} title={subStatus ?? undefined}>
      {STAGE_LABEL[stage] ?? stage}
      {subStatus ? <span className="ml-1 opacity-70">· {subStatus.replace(/_/g, " ").toLowerCase()}</span> : null}
    </span>
  );
}

export function TempChip({ temperature }: { temperature?: string | null }) {
  if (!temperature) return <span className="text-muted">—</span>;
  const cls = temperature === "HOT" ? "bg-bad-soft text-bad" : temperature === "WARM" ? "bg-warn-soft text-warn" : temperature === "NOT_INTERESTED" ? "bg-chip text-[#8a9aa5]" : "bg-chip text-muted";
  return <span className={clsx("chip", cls)}>{temperature.replace("_", " ")}</span>;
}

export function SegPill({ segment }: { segment: string }) {
  const cls = segment === "RESI" ? "bg-sky-soft text-sky" : segment === "ESS" ? "bg-ecofy-soft text-ecofy" : "bg-epc-soft text-epc";
  return <span className={clsx("chip text-[10.5px] font-bold", cls)}>{segment === "CI" ? "C&I" : segment}</span>;
}

export function OwnerBadge({ owner }: { owner: "ECOFY" | "ITARANG" | "EPC" }) {
  const cls = owner === "ECOFY" ? "bg-ecofy-soft text-ecofy" : owner === "EPC" ? "bg-epc-soft text-epc" : "bg-sky-soft text-sky";
  const label = owner === "ECOFY" ? "Ecofy executes" : owner === "EPC" ? "EPC executes" : "iTarang executes";
  return <span className={clsx("chip text-[10.5px] font-bold uppercase", cls)}>{label}</span>;
}

/**
 * The stage rail: S0 → S8 with owner colours (prototype pattern). `tone`
 * colours the current node by whose turn it is (indigo = the viewer acts,
 * amber = waiting on another party, navy = done) and `partyLabel` is pinned
 * under it ("You are here" / "Pending: iTarang"), so the current step is
 * never in doubt. The connector is solid up to the current node, dashed after.
 */
export function StageRail({ stage, tone = "action", partyLabel }: { stage: string; tone?: "action" | "waiting" | "done"; partyLabel?: string }) {
  const idx = stage === "CLOSED" ? STAGES.length : STAGES.indexOf(stage);
  const node = {
    action: "border-transparent bg-gradient-to-br from-indigo-600 to-violet-600 text-white ring-4 ring-indigo-100",
    waiting: "border-transparent bg-warn text-white ring-4 ring-warn-soft",
    done: "border-navy bg-navy text-white ring-4 ring-chip",
  }[tone];
  const pill = { action: "bg-gradient-to-r from-indigo-600 to-violet-600 text-white", waiting: "bg-warn text-white", done: "bg-navy text-white" }[tone];
  return (
    <ol className="flex items-start gap-0 overflow-x-auto py-1">
      {STAGES.map((s, i) => {
        const done = idx > i || (stage === "S8" && i === 8);
        const current = idx === i;
        const owner = STAGE_OWNER[s];
        const ownerCls = owner === "ECOFY" ? "text-ecofy" : owner === "EPC" ? "text-epc" : "text-sky";
        return (
          <li key={s} className="flex min-w-[96px] flex-1 flex-col items-center text-center">
            <div className="flex w-full items-center">
              <div className={clsx("flex-1", i === 0 ? "h-0.5 bg-transparent" : done || current ? "h-0.5 bg-navy" : "border-t-2 border-dashed border-line")} />
              <div className={clsx("flex h-7 w-7 items-center justify-center rounded-full border-2 text-[11px] font-bold", current ? node : done ? "border-navy bg-navy text-white" : "border-silver bg-white text-muted")}>{done ? "✓" : current ? "●" : i}</div>
              <div className={clsx("flex-1", i === STAGES.length - 1 ? "h-0.5 bg-transparent" : done ? "h-0.5 bg-navy" : "border-t-2 border-dashed border-line")} />
            </div>
            <div className={clsx("mt-1.5 text-[11px] font-semibold", current ? "text-ink" : "text-muted")}>{STAGE_LABEL[s].slice(3)}</div>
            <div className={clsx("text-[9.5px] font-bold uppercase tracking-[0.08em]", ownerCls)}>{owner === "ITARANG" ? "iTarang" : owner === "ECOFY" ? "Ecofy" : "EPC"}</div>
            {current && partyLabel && <span className={clsx("mt-1 rounded-full px-2 py-0.5 text-[10px] font-semibold", pill)}>{partyLabel}</span>}
          </li>
        );
      })}
    </ol>
  );
}

export function Modal({ open, onClose, title, children, wide }: { open: boolean; onClose: () => void; title: ReactNode; children: ReactNode; wide?: boolean }) {
  useEffect(() => {
    if (!open) return;
    const h = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-40 flex items-start justify-center overflow-y-auto bg-navy/40 p-4 pt-16" onClick={onClose}>
      <div className={clsx("card w-full", wide ? "max-w-3xl" : "max-w-lg")} onClick={(e) => e.stopPropagation()}>
        <header className="card-h">
          <div>{title}</div>
          <button className="btn btn-sm" onClick={onClose} type="button">Close</button>
        </header>
        <div className="card-b">{children}</div>
      </div>
    </div>
  );
}

const DEFAULT_TIME = "10:00";

/**
 * Date + time as two native inputs, held as ONE `YYYY-MM-DDTHH:mm` string (what the forms already convert with
 * `new Date(v).toISOString()`). Not `datetime-local`: picking a date from its calendar leaves the time empty, so the
 * value stays "" and the submit silently does nothing. Here a chosen date fills a default time at once, the time is
 * changed freely, and the line below says what will be saved. No min / max: any date and time may be chosen.
 */
export function DateTimeField({ label, value, onChange, required, hint }: { label: string; value: string; onChange: (next: string) => void; required?: boolean; hint?: string }) {
  const [date, time] = value ? value.split("T") : ["", ""];
  const d = value ? new Date(`${value}:00+05:30`) : null;
  const preview = d && !Number.isNaN(d.getTime()) ? d.toLocaleString("en-IN", { timeZone: "Asia/Kolkata", weekday: "short", day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) : null;
  return (
    <div className="block">
      <span className="label">{label}</span>
      <div className="grid grid-cols-[1fr_auto] gap-2">
        <input className="input" type="date" value={date} required={required} aria-label={`${label} — date`} onChange={(e) => onChange(e.target.value ? `${e.target.value}T${time || DEFAULT_TIME}` : "")} />
        <input className="input w-28" type="time" value={time} required={required} aria-label={`${label} — time`} onChange={(e) => onChange(date ? `${date}T${e.target.value || DEFAULT_TIME}` : "")} />
      </div>
      <span className="mt-1 block text-[11.5px] text-muted">{preview ? `Will be saved as ${preview} (IST)` : hint ?? "Pick a date; the time fills in and can be changed."}</span>
    </div>
  );
}

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <label className="block">
      <span className="label">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-[11.5px] text-muted">{hint}</span>}
    </label>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="px-4 py-8 text-center text-[13px] text-muted">{children}</div>;
}

export function Money({ v }: { v: number | null | undefined }) {
  if (v === null || v === undefined) return <span className="text-muted">—</span>;
  return <span className="mono">₹{v.toLocaleString("en-IN")}</span>;
}

export function When({ v, time = true }: { v: string | Date | null | undefined; time?: boolean }) {
  if (!v) return <span className="text-muted">—</span>;
  const d = new Date(v);
  return <span className="mono text-[12px]" title={d.toISOString()}>{d.toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "2-digit", month: "short", ...(time ? { hour: "2-digit", minute: "2-digit" } : {}) })}</span>;
}

export function Hours({ h }: { h: number | null | undefined }) {
  if (h === null || h === undefined) return <span className="text-muted">—</span>;
  if (h < 9) return <span className="mono">{h.toFixed(1)} wh</span>;
  return <span className="mono">{(h / 9).toFixed(1)} wd</span>;
}
