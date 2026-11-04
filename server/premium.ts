import type { IncomingMessage } from "node:http"

export interface PremiumEnv {
  ACCESS_CODE?: string
  SUPABASE_URL?: string
  SUPABASE_PUBLISHABLE_KEY?: string
  VITE_SUPABASE_URL?: string
  VITE_SUPABASE_PUBLISHABLE_KEY?: string
}

function headersOf(source: Request | IncomingMessage): Headers {
  if (source instanceof Request) return source.headers
  const headers = new Headers()
  for (const [name, value] of Object.entries(source.headers)) {
    if (typeof value === "string") headers.set(name, value)
    else if (Array.isArray(value)) headers.set(name, value.join(", "))
  }
  return headers
}

export function codeMatches(given: string | null, expected: string | undefined): boolean {
  if (!given || !expected) return false
  return given.trim() === expected.trim() && expected.trim().length > 0
}

/**
 * Premium calls (past papers, photos of papers) need either the invite code or a real account.
 * Anonymous sessions are free but must not be able to spend model calls by hitting the API directly.
 */
export async function premiumAllowed(
  source: Request | IncomingMessage,
  env: PremiumEnv = process.env as PremiumEnv,
  fetchImpl: typeof fetch = fetch,
): Promise<boolean> {
  const headers = headersOf(source)
  if (codeMatches(headers.get("x-access-code"), env.ACCESS_CODE)) return true

  const authorization = headers.get("authorization") ?? ""
  const token = authorization.toLowerCase().startsWith("bearer ") ? authorization.slice(7).trim() : ""
  if (!token) return false

  const url = env.SUPABASE_URL ?? env.VITE_SUPABASE_URL
  const key = env.SUPABASE_PUBLISHABLE_KEY ?? env.VITE_SUPABASE_PUBLISHABLE_KEY
  if (!url || !key) return false

  try {
    const response = await fetchImpl(`${url}/auth/v1/user`, {
      headers: { apikey: key, Authorization: `Bearer ${token}` },
    })
    if (!response.ok) return false
    const user = (await response.json()) as { is_anonymous?: boolean; email?: string }
    return user.is_anonymous !== true && Boolean(user.email)
  } catch {
    return false
  }
}
