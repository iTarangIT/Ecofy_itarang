/**
 * Roles and the permission helpers behind the BRD §2.2 matrix.
 * Endpoint-level allow-lists live on each route (`x-roles`); this file holds the cross-cutting rules.
 */
export const ROLES = ["ECOFY_ADMIN", "ECOFY_USER", "ITARANG_ADMIN", "ITARANG_CALLER"] as const;
export type Role = (typeof ROLES)[number];
export type OrgKind = "ECOFY" | "ITARANG";

export const ALL_ROLES: readonly Role[] = ROLES;
export const ADMINS: readonly Role[] = ["ECOFY_ADMIN", "ITARANG_ADMIN"];
/** Roles that may bulk-upload leads (docs/CONFLICTS.md #25: Ecofy Users upload too, into their own S0 queue). */
export const IMPORTERS: readonly Role[] = ["ECOFY_ADMIN", "ECOFY_USER", "ITARANG_ADMIN"];
export const ECOFY_ROLES: readonly Role[] = ["ECOFY_ADMIN", "ECOFY_USER"];
export const ITARANG_ROLES: readonly Role[] = ["ITARANG_ADMIN", "ITARANG_CALLER"];

export function isRole(x: unknown): x is Role {
  return typeof x === "string" && (ROLES as readonly string[]).includes(x);
}

export function orgOf(role: Role): OrgKind {
  return role.startsWith("ECOFY") ? "ECOFY" : "ITARANG";
}

export function isAdmin(role: Role) {
  return role === "ECOFY_ADMIN" || role === "ITARANG_ADMIN";
}

/** Money rows carry `visible_to`; only that exact role may read them (agreed rule 5). */
export function canSeeAmounts(role: Role, visibleTo: Role) {
  return role === visibleTo;
}

/** Short labels used in the UI and audit text. */
export const ROLE_LABEL: Record<Role, string> = {
  ECOFY_ADMIN: "Ecofy Admin",
  ECOFY_USER: "Ecofy User",
  ITARANG_ADMIN: "iTarang Admin",
  ITARANG_CALLER: "iTarang Caller",
};

/** Permission codes returned by GET /me (drives navigation and action visibility in the UI). */
export const PERMISSIONS: Record<Role, string[]> = {
  ECOFY_ADMIN: [
    "leads.import", "cases.create", "cases.assign.s0", "cases.temperature", "cases.push", "cases.close",
    "activities.comment", "calculator.run", "assessments.save", "eligibility.record", "amounts.view",
    "financing.record", "reacceptance.trigger", "installation.view", "payout.record", "asset.record",
    "calculator.approve", "settings.view", "users.manage.ecofy", "dashboards.all", "export", "audit.view", "usage.view",
  ],
  ECOFY_USER: [
    "leads.import", "cases.create", "cases.temperature", "cases.push", "cases.close", "activities.log", "calculator.run",
    "assessments.save", "dashboards.own",
  ],
  ITARANG_ADMIN: [
    "leads.import", "cases.create", "cases.assign", "cases.return", "cases.reassign", "cases.close", "cases.reopen",
    "activities.log", "appointments.manage", "calculator.run", "assessments.save", "assessments.confirm",
    "eligibility.send", "quotes.upload", "offers.compose", "otp.send", "financing.route", "financing.record.other",
    "installation.manage", "payout.record.other", "withdrawals.request", "withdrawals.confirm",
    "calculator.design", "settings.edit", "lists.edit", "masters.edit", "users.manage", "seats.manage",
    "dashboards.all", "export", "audit.view", "usage.view",
  ],
  ITARANG_CALLER: [
    "activities.log", "appointments.manage", "calculator.run", "assessments.save", "assessments.confirm",
    "eligibility.send", "quotes.upload", "offers.compose", "otp.send", "installation.manage", "withdrawals.request",
    "dashboards.own",
  ],
};
