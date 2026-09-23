"use client";

import { useEffect, useState } from "react";

type Toast = { id: number; text: string; kind: "ok" | "warn" | "bad" };
const listeners = new Set<(t: Toast) => void>();
let seq = 0;

export function toast(text: string, kind: Toast["kind"] = "ok") {
  const t = { id: ++seq, text, kind };
  listeners.forEach((l) => l(t));
}

export function ToastHost() {
  const [items, setItems] = useState<Toast[]>([]);
  useEffect(() => {
    const l = (t: Toast) => {
      setItems((x) => [...x, t]);
      setTimeout(() => setItems((x) => x.filter((i) => i.id !== t.id)), 4500);
    };
    listeners.add(l);
    return () => { listeners.delete(l); };
  }, []);
  return (
    <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2">
      {items.map((t) => (
        <div key={t.id} className={`rounded-lg px-4 py-2.5 text-[13px] text-white shadow-lg ${t.kind === "ok" ? "bg-navy" : t.kind === "warn" ? "bg-warn" : "bg-bad"}`}>{t.text}</div>
      ))}
    </div>
  );
}
