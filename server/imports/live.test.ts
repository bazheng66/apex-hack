import { createClient } from "@supabase/supabase-js"
import { afterAll, describe, expect, it } from "vitest"
import { handleImportsApi } from "./http.ts"
import type { PublicFetchResult } from "./public-fetch.ts"

const url = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL
const key = process.env.VITE_SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_PUBLISHABLE_KEY
const enabled = process.env.IMPORT_API_LIVE === "1" && Boolean(url && key)

describe.skipIf(!enabled)("import api against supabase", () => {
  const ids: { token?: string; examId?: string } = {}

  afterAll(async () => {
    if (!url || !key || !ids.token || !ids.examId) return
    const client = createClient(url, key, {
      accessToken: async () => ids.token ?? null,
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    })
    await client.from("exams").delete().eq("id", ids.examId)
  })

  it("writes a public_url job, source, and items under the caller JWT", async () => {
    if (!url || !key) throw new Error("missing supabase env")
    const auth = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })
    const signed = await auth.auth.signInAnonymously()
    expect(signed.error).toBeNull()
    const token = signed.data.session?.access_token
    const userId = signed.data.user?.id
    expect(token).toBeTruthy()
    expect(userId).toBeTruthy()
    ids.token = token
    const exam = await auth.from("exams").insert({ user_id: userId, name: "import api live" }).select("id").single()
    expect(exam.error).toBeNull()
    ids.examId = exam.data?.id
    const page = "<html><head><title>Live</title></head><body><ol><li>分页与分段的地址映射有什么差别？</li></ol></body></html>"
    const target = `https://example.com/testpass-live-${crypto.randomUUID()}`
    const response = await handleImportsApi(jsonPost(token ?? "", { exam_id: ids.examId, mode: "public_url", url: target }), {
      env: { SUPABASE_URL: url, SUPABASE_PUBLISHABLE_KEY: key },
      fetchPublic: async () => htmlResult(target, page),
    })
    expect(response.status).toBe(202)
    const created = (await response.json()) as { job_id: string; source_id: string; status: string }
    expect(created.status).toBe("succeeded")
    const again = await handleImportsApi(jsonPost(token ?? "", { exam_id: ids.examId, mode: "public_url", url: target }), {
      env: { SUPABASE_URL: url, SUPABASE_PUBLISHABLE_KEY: key },
      fetchPublic: async () => htmlResult(target, page),
    })
    expect(again.status).toBe(202)
    const second = (await again.json()) as { source_id: string }
    expect(second.source_id).toBe(created.source_id)
    const items = await handleImportsApi(
      new Request(`http://127.0.0.1/api/v1/items?source_id=${created.source_id}`, {
        headers: { authorization: `Bearer ${token}` },
      }),
      { env: { SUPABASE_URL: url, SUPABASE_PUBLISHABLE_KEY: key } },
    )
    expect(items.status).toBe(200)
    const body = (await items.json()) as { items: Array<{ prompt: string }> }
    expect(body.items).toHaveLength(1)
    expect(body.items[0]?.prompt).toContain("分页与分段")
  }, 20000)
})

function jsonPost(token: string, body: Record<string, unknown>): Request {
  return new Request("http://127.0.0.1/api/v1/imports", {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify(body),
  })
}

function htmlResult(finalUrl: string, body: string): PublicFetchResult {
  return { outcome: "ok", status: 200, finalUrl, contentType: "text/html", body, bytes: body.length, etag: null }
}
