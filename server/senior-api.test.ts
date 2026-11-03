import { describe, expect, it } from "vitest"
import { seniorFetch } from "./senior-api.ts"

describe("production AI entry points", () => {
  it("rejects unsupported methods and returns the same missing-key fallback as local development", async () => {
    expect((await seniorFetch(new Request("https://test.invalid/api/senior"), "senior", "")).status).toBe(405)
    const request = new Request("https://test.invalid/api/senior", { method: "POST", body: JSON.stringify({ kind: "today", exam: "操作系统" }) })
    const response = await seniorFetch(request, "senior", "")
    expect(response.status).toBe(503)
    expect(await response.json()).toEqual({ error: "未配置密钥" })
    expect(response.headers.get("cache-control")).toBe("no-store")
  })
})
