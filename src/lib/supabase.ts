import { createClient, type SupabaseClient } from "@supabase/supabase-js"

export type CaptchaTokenProvider = () => Promise<string | undefined>

function configured(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : undefined
}

export function createSupabaseClient(url: string | undefined, publishableKey: string | undefined): SupabaseClient | null {
  const supabaseUrl = configured(url)
  const key = configured(publishableKey)
  if (!supabaseUrl || !key) return null
  return createClient(supabaseUrl, key)
}

export const supabase: SupabaseClient | null = createSupabaseClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
)

async function captchaTokenFrom(getCaptchaToken?: CaptchaTokenProvider): Promise<string | undefined> {
  if (!getCaptchaToken) return undefined
  const token = await getCaptchaToken()
  if (typeof token !== "string") return undefined
  const trimmed = token.trim()
  return trimmed.length > 0 ? trimmed : undefined
}

export async function ensureAnonymousSession(client: SupabaseClient, getCaptchaToken?: CaptchaTokenProvider): Promise<void> {
  const { data, error } = await client.auth.getSession()
  if (error) console.warn("Supabase session lookup failed", error.message)
  if (data.session) return

  const captchaToken = await captchaTokenFrom(getCaptchaToken)
  const { error: signInError } = await client.auth.signInAnonymously(captchaToken ? { options: { captchaToken } } : undefined)
  if (signInError) console.warn("Anonymous sign-in failed", signInError.message)
}

let bootstrap: Promise<void> | null = null

export function bootstrapSupabaseAuth(getCaptchaToken?: CaptchaTokenProvider): Promise<void> {
  if (!supabase) return Promise.resolve()
  bootstrap ??= ensureAnonymousSession(supabase, getCaptchaToken).catch((error: unknown) => {
    const message = error instanceof Error ? error.message : "unknown error"
    console.warn("Supabase anonymous auth did not start", message)
  })
  return bootstrap
}
