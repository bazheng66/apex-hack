import type { SupabaseClient } from "@supabase/supabase-js"
import { afterEach, describe, expect, it, vi } from "vitest"
import { bootstrapSupabaseAuth, createSupabaseClient, ensureAnonymousSession, supabase } from "./supabase.ts"

function client(options: {
  session?: { user: { id: string } } | null
  sessionError?: { message: string } | null
  signIn?: (credentials?: { options?: { captchaToken?: string } }) => Promise<{ error: { message: string } | null }>
}): SupabaseClient {
  return {
    auth: {
      getSession: async () => ({
        data: { session: options.session ?? null },
        error: options.sessionError ?? null,
      }),
      signInAnonymously: options.signIn ?? (async () => ({ error: null })),
    },
  } as unknown as SupabaseClient
}

describe("supabase client", () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it("skips startup auth when no client was configured", async () => {
    expect(supabase).toBeNull()
    await expect(bootstrapSupabaseAuth()).resolves.toBeUndefined()
  })

  it("stays off when the url or publishable key is missing", () => {
    expect(createSupabaseClient(undefined, undefined)).toBeNull()
    expect(createSupabaseClient("https://bhylflnzkwmhhaskduqp.supabase.co", "")).toBeNull()
    expect(createSupabaseClient("  ", "sb_publishable_example")).toBeNull()
  })

  it("builds a client when both public env values are set", () => {
    const created = createSupabaseClient("https://bhylflnzkwmhhaskduqp.supabase.co", "sb_publishable_example")
    expect(created).not.toBeNull()
  })

  it("keeps an existing session and does not sign in again", async () => {
    const signIn = vi.fn(async () => ({ error: null }))
    await ensureAnonymousSession(client({ session: { user: { id: "already" } }, signIn }))
    expect(signIn).not.toHaveBeenCalled()
  })

  it("signs in anonymously when there is no session", async () => {
    const signIn = vi.fn(async () => ({ error: null }))
    await ensureAnonymousSession(client({ signIn }))
    expect(signIn).toHaveBeenCalledOnce()
    expect(signIn).toHaveBeenCalledWith(undefined)
  })

  it("passes a captcha token only when the hook returns one", async () => {
    const signIn = vi.fn(async () => ({ error: null }))
    await ensureAnonymousSession(
      client({ signIn }),
      async () => "  turnstile-token  ",
    )
    expect(signIn).toHaveBeenCalledWith({ options: { captchaToken: "turnstile-token" } })

    const skipped = vi.fn(async () => ({ error: null }))
    await ensureAnonymousSession(client({ signIn: skipped }), async () => "   ")
    expect(skipped).toHaveBeenCalledWith(undefined)
  })

  it("still tries anonymous sign-in when session lookup fails", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    const signIn = vi.fn(async () => ({ error: { message: "anonymous disabled" } }))
    await expect(
      ensureAnonymousSession(client({ sessionError: { message: "offline" }, signIn })),
    ).resolves.toBeUndefined()
    expect(signIn).toHaveBeenCalledOnce()
    expect(warn).toHaveBeenCalled()
  })
})
