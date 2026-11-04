import { describe, expect, it } from "vitest"
import { codeMatches, premiumAllowed } from "./premium.ts"

const env = { ACCESS_CODE: "TESTPASS-2026", SUPABASE_URL: "https://example.supabase.co", SUPABASE_PUBLISHABLE_KEY: "sb_publishable_x" }

function request(headers: Record<string, string>) {
  return new Request("https://test.invalid/api/see", { method: "POST", headers })
}

function fakeFetch(user: unknown) {
  return (async () => new Response(JSON.stringify(user), { status: 200 })) as unknown as typeof fetch
}

describe("premium access", () => {
  it("accepts only the configured invite code", () => {
    expect(codeMatches("TESTPASS-2026", "TESTPASS-2026")).toBe(true)
    expect(codeMatches(" testpass-2026 ", "TESTPASS-2026")).toBe(false)
    expect(codeMatches("", "TESTPASS-2026")).toBe(false)
    expect(codeMatches("TESTPASS-2026", "")).toBe(false)
    expect(codeMatches(null, "TESTPASS-2026")).toBe(false)
  })

  it("lets the invite code through without any account", async () => {
    const allowed = await premiumAllowed(request({ "x-access-code": "TESTPASS-2026" }), env, fakeFetch({}))
    expect(allowed).toBe(true)
  })

  it("rejects anonymous sessions and missing tokens", async () => {
    expect(await premiumAllowed(request({}), env, fakeFetch({ is_anonymous: true }))).toBe(false)
    expect(await premiumAllowed(request({ authorization: "Bearer abc" }), env, fakeFetch({ is_anonymous: true, email: "" }))).toBe(false)
  })

  it("accepts a real account with a confirmed email", async () => {
    const allowed = await premiumAllowed(
      request({ authorization: "Bearer abc" }),
      env,
      fakeFetch({ is_anonymous: false, email: "someone@example.com" }),
    )
    expect(allowed).toBe(true)
  })
})
