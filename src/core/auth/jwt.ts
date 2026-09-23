import { createRemoteJWKSet, jwtVerify, SignJWT, type JWTPayload } from "jose";
import { config } from "@/core/config";

export type SupabaseClaims = {
  sub: string; // auth user id
  email?: string;
  session_id: string;
  exp: number;
  role?: string;
};

let jwks: ReturnType<typeof createRemoteJWKSet> | undefined;

/**
 * Verifies a Supabase access token.
 *  - AUTH_JWT_STUB_SECRET (tests / no Supabase yet): HS256 with that secret
 *  - SUPABASE_JWT_SECRET: HS256 legacy secret
 *  - otherwise: the project's JWKS (ES256/RS256 signing keys)
 */
export async function verifyAccessToken(token: string): Promise<SupabaseClaims> {
  const c = config();
  let payload: JWTPayload;
  if (c.AUTH_JWT_STUB_SECRET) {
    ({ payload } = await jwtVerify(token, new TextEncoder().encode(c.AUTH_JWT_STUB_SECRET)));
  } else if (c.SUPABASE_JWT_SECRET) {
    ({ payload } = await jwtVerify(token, new TextEncoder().encode(c.SUPABASE_JWT_SECRET), { algorithms: ["HS256"] }));
  } else {
    if (!c.NEXT_PUBLIC_SUPABASE_URL) throw new Error("NEXT_PUBLIC_SUPABASE_URL is not configured");
    jwks ??= createRemoteJWKSet(new URL(`${c.NEXT_PUBLIC_SUPABASE_URL}/auth/v1/.well-known/jwks.json`));
    ({ payload } = await jwtVerify(token, jwks));
  }
  if (typeof payload.sub !== "string" || typeof payload.session_id !== "string" || typeof payload.exp !== "number") {
    throw new Error("token is missing sub/session_id/exp");
  }
  return { sub: payload.sub, email: payload.email as string | undefined, session_id: payload.session_id as string, exp: payload.exp, role: payload.role as string | undefined };
}

/** Decode without verification (used only to detect expiry before a refresh). */
export function decodeExp(token: string): number | null {
  try {
    const [, b] = token.split(".");
    const json = JSON.parse(Buffer.from(b, "base64url").toString("utf8"));
    return typeof json.exp === "number" ? json.exp : null;
  } catch {
    return null;
  }
}

/** Test/dev helper: mint a token the stub verifier accepts. */
export async function signStubToken(claims: { sub: string; email: string; session_id: string; expiresInSeconds?: number }): Promise<string> {
  const secret = config().AUTH_JWT_STUB_SECRET;
  if (!secret) throw new Error("AUTH_JWT_STUB_SECRET is not set");
  return new SignJWT({ email: claims.email, session_id: claims.session_id, role: "authenticated" })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(claims.sub)
    .setIssuedAt()
    .setExpirationTime(`${claims.expiresInSeconds ?? 3600}s`)
    .sign(new TextEncoder().encode(secret));
}
