/**
 * Response serialisation: snake_case → camelCase, Date → ISO-8601 UTC, undefined removed.
 * Amount fields a role may not see are OMITTED (never null) — use `omit()` in serializers.
 */
export function camel(key: string): string {
  return key.replace(/_([a-z0-9])/g, (_, c: string) => c.toUpperCase());
}

export function snake(key: string): string {
  return key.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);
}

/** Wrap a value whose keys must NOT be camel-cased (setting keys, header maps, template columns). */
export class Verbatim {
  constructor(readonly value: unknown) {}
}
export const verbatim = (v: unknown) => new Verbatim(v);

export function toApi<T = unknown>(value: unknown): T {
  return walk(value) as T;
}

function walk(v: unknown): unknown {
  if (v === undefined) return undefined;
  if (v === null) return null;
  if (v instanceof Verbatim) return walkValuesOnly(v.value);
  if (v instanceof Date) return v.toISOString();
  if (Array.isArray(v)) return v.map(walk);
  if (typeof v === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
      if (val === undefined) continue;
      out[camel(k)] = walk(val);
    }
    return out;
  }
  if (typeof v === "bigint") return Number(v);
  return v;
}

function walkValuesOnly(v: unknown): unknown {
  if (v instanceof Date) return v.toISOString();
  if (Array.isArray(v)) return v.map(walkValuesOnly);
  if (v && typeof v === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) if (val !== undefined) out[k] = walkValuesOnly(val);
    return out;
  }
  return v;
}

/** Remove keys (typically money) before serialising. */
export function omit<T extends Record<string, unknown>, K extends keyof T>(obj: T, keys: readonly K[]): Omit<T, K> {
  const copy: Record<string, unknown> = { ...obj };
  for (const k of keys) delete copy[k as string];
  return copy as Omit<T, K>;
}

/** Mask a +91 mobile for lists (FR-17.5): +91XXXXXX3210 → +91******3210 */
export function maskMobile(mobile: string | null | undefined): string | null {
  if (!mobile) return null;
  return mobile.replace(/^(\+91)(\d{6})(\d{4})$/, "$1******$3");
}

/** Pagination meta */
export type PageMeta = { nextCursor: string | null; limit?: number };
export function encodeCursor(v: Record<string, string | number | null>): string {
  return Buffer.from(JSON.stringify(v)).toString("base64url");
}
export function decodeCursor<T = Record<string, string | number | null>>(s: string | null | undefined): T | null {
  if (!s) return null;
  try { return JSON.parse(Buffer.from(s, "base64url").toString("utf8")) as T; } catch { return null; }
}
