"use client";

import { useQuery } from "@tanstack/react-query";
import { get } from "@/lib/api";

export type ListItem = { id: string; code: string; label: string; active: boolean; sortOrder: number };
export function useList(listCode: string) {
  return useQuery({ queryKey: ["list", listCode], queryFn: () => get<ListItem[]>(`/lists/${listCode}/items?active=true`), staleTime: 300_000 });
}

export type EpcPartner = { id: string; name: string; active: boolean; pincodes: string[]; segments: string[]; contactName: string | null; mobile: string | null; email: string | null };
export function useEpcPartners() {
  return useQuery({ queryKey: ["epc-partners"], queryFn: () => get<EpcPartner[]>("/epc-partners?limit=100"), staleTime: 300_000 });
}

export type Financier = { id: string; name: string; isDefault: boolean; valuesVisibleTo: string; active: boolean };
export function useFinanciers(enabled = true) {
  return useQuery({ queryKey: ["financiers"], queryFn: () => get<Financier[]>("/financiers?limit=100"), staleTime: 300_000, enabled });
}

export type User = { id: string; fullName: string; email: string; role: string; status: string; mobile: string | null; lastLoginAt: string | null };
export function useUsers(enabled = true) {
  return useQuery({ queryKey: ["users"], queryFn: () => get<User[]>("/users?limit=100"), staleTime: 60_000, enabled });
}

export function useSettings(enabled = true) {
  return useQuery({ queryKey: ["settings"], queryFn: () => get<Record<string, unknown>>("/settings"), staleTime: 60_000, enabled });
}

export type CaseSummary = {
  id: string; caseNo: string; version: number; stage: string; subStatus: string | null; segment: string; temperature: string | null; source: string; owner: "ECOFY" | "ITARANG";
  assignedUserId: string | null; assignedUserName: string | null; qualifiedBy: string | null; qualifiedByName: string | null; financierId: string | null; financierName: string | null;
  customer: { id: string; fullName: string; mobile: string | null; altMobile: string | null; email?: string | null; customerType: string; businessName: string | null; address?: string; city: string; state: string; pincode: string; preferredLanguage: string | null; propertyType: string | null; consentDate: string; consentSource: string } | null;
  productInterest: string | null; avgMonthlyBillInr: number | null; sanctionedLoadKw: number | null; existingBackup: string | null; preferredCallTime: string | null; ecofyLeadId: string | null;
  stageEnteredAt: string; queueEnteredAt: string | null; firstCallAt: string | null; hotToFirstCallHours: number | null; closureReason: string | null; closureNote: string | null; closedAt: string | null; reopenCount: number; previousCaseId: string | null;
  ageing: { inStageWorkingHours: number; openWorkingHours: number }; createdAt: string; updatedAt: string;
};

export function useCase(caseId: string) {
  return useQuery({ queryKey: ["case", caseId], queryFn: () => get<CaseSummary>(`/cases/${caseId}`) });
}

export const fmtDate = (v?: string | null) => (v ? new Date(v).toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata", day: "2-digit", month: "short", year: "numeric" }) : "—");
export const fmtDateTime = (v?: string | null) => (v ? new Date(v).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) : "—");
export const inr = (v?: number | null) => (v === null || v === undefined ? "—" : `₹${v.toLocaleString("en-IN")}`);
export const todayIso = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date());
