/**
 * Lead upload template v0.3 → database mapping (BRD §7.3) and row rules (template "How to fill").
 * Labels are for people; the database stores codes.
 */
export const TEMPLATE_COLUMNS = [
  "customer_name", "mobile", "segment", "pincode", "consent_obtained", "consent_date", "consent_source", "city", "state", "address",
  "customer_type", "business_name", "ecofy_lead_id", "alternate_mobile", "email", "preferred_language", "property_type", "product_interest",
  "avg_monthly_bill_inr", "sanctioned_load_kw", "existing_backup", "preferred_call_time", "assign_to",
] as const;
export type TemplateColumn = (typeof TEMPLATE_COLUMNS)[number];

export const MANDATORY: TemplateColumn[] = ["customer_name", "mobile", "segment", "pincode", "consent_obtained", "consent_date", "consent_source", "city", "state", "address", "customer_type"];

/** Header aliases for auto-matching (lower-cased, non-alphanumerics stripped). */
const ALIASES: Record<TemplateColumn, string[]> = {
  customer_name: ["name", "customername", "fullname", "customer", "leadname"],
  mobile: ["mobile", "mobileno", "mobilenumber", "phone", "phoneno", "contact", "contactno", "mob"],
  segment: ["segment", "seg", "category"],
  pincode: ["pincode", "pin", "zip", "postalcode"],
  consent_obtained: ["consentobtained", "consent", "consentflag"],
  consent_date: ["consentdate", "dateofconsent"],
  consent_source: ["consentsource", "source", "leadsource"],
  city: ["city", "town"],
  state: ["state"],
  address: ["address", "addr", "siteaddress"],
  customer_type: ["customertype", "type", "individualbusiness"],
  business_name: ["businessname", "company", "firm", "entity"],
  ecofy_lead_id: ["ecofyleadid", "leadid", "ecofyid", "customerid", "crmid"],
  alternate_mobile: ["alternatemobile", "altmobile", "alternatephone", "secondarymobile"],
  email: ["email", "emailid", "mail"],
  preferred_language: ["preferredlanguage", "language", "lang"],
  property_type: ["propertytype", "property"],
  product_interest: ["productinterest", "interest", "product"],
  avg_monthly_bill_inr: ["avgmonthlybillinr", "avgmonthlybill", "monthlybill", "bill", "averagebill"],
  sanctioned_load_kw: ["sanctionedloadkw", "sanctionedload", "load", "loadkw"],
  existing_backup: ["existingbackup", "backup"],
  preferred_call_time: ["preferredcalltime", "calltime", "besttimetocall"],
  assign_to: ["assignto", "assignee", "owner", "assignedto"],
};

export function normHeader(h: string) {
  return h.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/** Auto-match source headers to template columns. Unmatched headers are left for the user. */
export function suggestMapping(headers: string[]): Record<string, TemplateColumn | null> {
  const out: Record<string, TemplateColumn | null> = {};
  const used = new Set<TemplateColumn>();
  for (const h of headers) {
    const n = normHeader(h);
    let hit: TemplateColumn | null = null;
    for (const col of TEMPLATE_COLUMNS) {
      if (used.has(col)) continue;
      if (n === normHeader(col) || ALIASES[col].includes(n)) { hit = col; break; }
    }
    if (hit) used.add(hit);
    out[h] = hit;
  }
  return out;
}

/** Label → code conversions (case-insensitive; codes are also accepted). */
export const LABEL_CODES: Record<string, Record<string, string>> = {
  segment: { resi: "RESI", ess: "ESS", "c&i": "CI", ci: "CI", "c i": "CI" },
  customer_type: { individual: "INDIVIDUAL", business: "BUSINESS" },
  consent_source: { "website form": "WEBSITE_FORM", call: "CALL", campaign: "CAMPAIGN", "walk-in": "WALK_IN", "walk in": "WALK_IN", "existing customer": "EXISTING_CUSTOMER", referral: "REFERRAL", other: "OTHER" },
  preferred_language: { hindi: "HINDI", marathi: "MARATHI", english: "ENGLISH", marwari: "MARWARI", other: "OTHER" },
  property_type: { "own house": "OWN_HOUSE", "rented house": "RENTED_HOUSE", "own shop": "OWN_SHOP", "rented shop": "RENTED_SHOP", factory: "FACTORY", office: "OFFICE", other: "OTHER" },
  product_interest: { "solar + storage": "SOLAR_STORAGE", "solar+storage": "SOLAR_STORAGE", "storage only": "STORAGE_ONLY", "solar only": "SOLAR_ONLY", "not sure": "NOT_SURE" },
  existing_backup: { none: "NONE", inverter: "INVERTER", generator: "GENERATOR", both: "BOTH" },
  preferred_call_time: { morning: "MORNING", afternoon: "AFTERNOON", evening: "EVENING", any: "ANY" },
};

export function toCode(column: string, raw: string, validCodes?: Set<string>): string | null {
  const v = raw.trim();
  if (!v) return null;
  const table = LABEL_CODES[column] ?? {};
  const byLabel = table[v.toLowerCase()];
  if (byLabel) return byLabel;
  const asCode = v.toUpperCase().replace(/[\s-]+/g, "_");
  if (validCodes ? validCodes.has(asCode) : Object.values(table).includes(asCode)) return asCode;
  return null;
}

export function normaliseMobile(raw: string): string | null {
  const digits = raw.replace(/\D/g, "");
  const ten = digits.length === 12 && digits.startsWith("91") ? digits.slice(2) : digits.length === 11 && digits.startsWith("0") ? digits.slice(1) : digits;
  return /^[6-9][0-9]{9}$/.test(ten) ? `+91${ten}` : null;
}

export type RowError = { column?: string; code: string; message: string };
