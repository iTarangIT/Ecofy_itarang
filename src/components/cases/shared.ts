"use client";

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { errorMessage } from "@/lib/api";
import { toast } from "@/components/ui/toast";

/**
 * Busy flag + toast + cache invalidation for one case action. `keys` are the
 * per-case query families to refresh (e.g. ["appointments"]); the case itself
 * and the timeline are always refreshed by the page's `onChange`.
 */
export function useCaseAction(caseId: string, onChange: () => void, keys: string[] = []) {
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  async function run(label: string, fn: () => Promise<unknown>): Promise<boolean> {
    setBusy(true);
    try {
      await fn();
      toast(label);
      for (const k of keys) qc.invalidateQueries({ queryKey: [k, caseId] });
      onChange();
      return true;
    } catch (e) {
      toast(errorMessage(e), "bad");
      return false;
    } finally {
      setBusy(false);
    }
  }
  return { busy, run };
}
