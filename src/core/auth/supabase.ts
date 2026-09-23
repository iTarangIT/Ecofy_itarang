import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { config } from "@/core/config";

/**
 * Server-side Supabase clients. Only two are ever used on the server:
 *  - `admin()` (service role) for invites, resets, sign-out-others, createUser
 *  - `anon()` for refreshSession / getUser with a user's own tokens
 * The browser uses a plain anon client with persistSession:false (no @supabase/ssr; cookies are ours).
 */
let adminClient: SupabaseClient | undefined;
let anonClient: SupabaseClient | undefined;

export function supabaseConfigured(): boolean {
  const c = config();
  return Boolean(c.NEXT_PUBLIC_SUPABASE_URL && c.NEXT_PUBLIC_SUPABASE_ANON_KEY);
}

export function admin(): SupabaseClient {
  const c = config();
  if (!c.NEXT_PUBLIC_SUPABASE_URL || !c.SUPABASE_SERVICE_ROLE_KEY) throw new Error("Supabase service role is not configured");
  adminClient ??= createClient(c.NEXT_PUBLIC_SUPABASE_URL, c.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
  return adminClient;
}

export function anon(): SupabaseClient {
  const c = config();
  if (!c.NEXT_PUBLIC_SUPABASE_URL || !c.NEXT_PUBLIC_SUPABASE_ANON_KEY) throw new Error("Supabase anon key is not configured");
  anonClient ??= createClient(c.NEXT_PUBLIC_SUPABASE_URL, c.NEXT_PUBLIC_SUPABASE_ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
  return anonClient;
}

/** Refresh an access token with the refresh token (rotation-safe: one call per user at a time). */
const refreshLocks = new Map<string, Promise<{ accessToken: string; refreshToken: string } | null>>();
export function refreshTokens(userKey: string, refreshToken: string): Promise<{ accessToken: string; refreshToken: string } | null> {
  const existing = refreshLocks.get(userKey);
  if (existing) return existing;
  const p = (async () => {
    try {
      const { data, error } = await anon().auth.refreshSession({ refresh_token: refreshToken });
      if (error || !data.session) return null;
      return { accessToken: data.session.access_token, refreshToken: data.session.refresh_token };
    } finally {
      setTimeout(() => refreshLocks.delete(userKey), 2000);
    }
  })();
  refreshLocks.set(userKey, p);
  return p;
}
