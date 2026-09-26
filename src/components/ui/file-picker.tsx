"use client";

import { useId, useRef, useState } from "react";

type Props = { file: File | null; onChange: (f: File | null) => void; accept?: string; hint?: string; label?: string; compact?: boolean };

/** Branded upload zone: dashed drop area in the page tint, navy "Choose file" button, drag-and-drop, selected file shown inline. */
export function FilePicker({ file, onChange, accept = ".xlsx,.csv", hint = "Excel .xlsx or .csv", label = "Choose Excel file", compact = false }: Props) {
  const id = useId();
  const ref = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const pick = (f: File | null | undefined) => { onChange(f ?? null); if (!f && ref.current) ref.current.value = ""; };
  const kb = file ? `${Math.max(1, Math.round(file.size / 1024))} KB` : "";
  return (
    <div
      className={`flex flex-wrap items-center gap-3 rounded-xl border-2 border-dashed transition ${compact ? "px-3 py-2.5" : "px-4 py-4"} ${over ? "border-sky bg-sky-soft" : file ? "border-ecofy/50 bg-ecofy-soft/50" : "border-line bg-page hover:border-sky/60"}`}
      onDragOver={(e) => { e.preventDefault(); setOver(true); }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => { e.preventDefault(); setOver(false); pick(e.dataTransfer.files?.[0]); }}
    >
      <label htmlFor={id} className={`btn btn-navy cursor-pointer ${compact ? "btn-sm" : ""}`}>
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="17 8 12 3 7 8" /><line x1="12" y1="3" x2="12" y2="15" /></svg>
        {label}
        <input id={id} ref={ref} type="file" accept={accept} className="sr-only" onChange={(e) => pick(e.target.files?.[0])} />
      </label>
      {file ? (
        <div className="flex min-w-0 items-center gap-2 text-[13px]">
          <span className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-ecofy text-[10px] font-bold text-white" aria-hidden>{file.name.toLowerCase().endsWith(".csv") ? "CSV" : "XLS"}</span>
          <span className="truncate font-medium text-ink" title={file.name}>{file.name}</span>
          <span className="shrink-0 text-muted">· {kb}</span>
          <button type="button" className="shrink-0 text-[12px] text-muted underline hover:text-bad" onClick={() => pick(null)}>Remove</button>
        </div>
      ) : (
        <div className="text-[12.5px] text-muted">or drag & drop here · <span className="font-medium text-ink">{hint}</span></div>
      )}
    </div>
  );
}
