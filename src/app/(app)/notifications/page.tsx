"use client";

import Link from "next/link";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { get, post } from "@/lib/api";
import { Card, Empty } from "@/components/ui/primitives";
import { fmtDateTime } from "@/lib/hooks";

type N = { id: number; type: string; title: string; body: string | null; caseId: string | null; readAt: string | null; createdAt: string };

export default function NotificationsPage() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["notifications", "all"], queryFn: () => get<N[]>("/notifications?limit=100") });
  async function read(id: number) { await post(`/notifications/${id}/read`); qc.invalidateQueries({ queryKey: ["notifications"] }); }
  return (
    <Card title="Notifications" pad={false}>
      {(q.data?.data ?? []).length === 0 && <Empty>No notifications.</Empty>}
      {(q.data?.data ?? []).map((n) => (
        <div key={n.id} className={`flex items-start gap-3 border-b border-line px-4 py-2.5 text-[12.5px] ${n.readAt ? "opacity-60" : ""}`}>
          <div className="flex-1"><div className="font-semibold">{n.title}</div>{n.body && <div className="text-muted">{n.body}</div>}<div className="text-[11px] text-muted">{fmtDateTime(n.createdAt)} · {n.type.split("#")[0]}</div></div>
          {n.caseId && <Link className="btn btn-sm" href={`/cases/${n.caseId}`} onClick={() => read(n.id)}>Open case</Link>}
          {!n.readAt && <button className="btn btn-sm" type="button" onClick={() => read(n.id)}>Mark read</button>}
        </div>
      ))}
    </Card>
  );
}
