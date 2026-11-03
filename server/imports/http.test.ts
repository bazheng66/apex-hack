import { describe, expect, it } from "vitest"
import type { PublicFetchResult } from "./public-fetch.ts"
import { fetchPublicPage } from "./public-fetch.ts"
import { handleImportsApi, resolveRequestUrl, type ImportApiDeps } from "./http.ts"
import type {
  ImportJobRecord,
  ImportRepository,
  ItemRecord,
  ItemUpsert,
  JobPatch,
  NewJob,
  SourceRecord,
  SourceUpsert,
} from "./repository.ts"
import { SourceExamConflict } from "./repository.ts"
import { externalKeyFor } from "./scrapling.ts"

const TOKEN = `bearer-token-${"a".repeat(24)}`
const EXAM = "11111111-1111-4111-8111-111111111111"
const OTHER = "22222222-2222-4222-8222-222222222222"
const stemA = "三个页框，访问串 1 2 3 4，FIFO 先淘汰哪一页？"
const stemB = "银行家算法为什么不能只看 Need？"
const stemC = "分页与分段的地址映射有什么差别？"

const pageHtml = [
  "<html><head><title>OS quiz</title></head><body>",
  `<ol><li>${stemA}</li><li>${stemB}</li></ol>`,
  `<script type="application/json">${JSON.stringify({
    questions: [{ stem: stemC, options: ["页表", "段表"], answer: "A" }],
  })}</script>`,
  "</body></html>",
].join("")

describe("import http api", () => {
  it("requires a bearer token and a publishable key", async () => {
    const repo = new MemoryRepo()
    const openRepository = async () => ({ userId: repo.userId, repo })
    const missing = await handleImportsApi(post({ url: "https://example.com/q" }), {
      env: { SUPABASE_URL: "https://bhylflnzkwmhhaskduqp.supabase.co", SUPABASE_PUBLISHABLE_KEY: "sb_publishable_example" },
      openRepository,
    })
    expect(missing.status).toBe(401)
    const sources = await handleImportsApi(new Request("http://127.0.0.1/api/v1/sources"), {
      env: { SUPABASE_URL: "https://bhylflnzkwmhhaskduqp.supabase.co", SUPABASE_PUBLISHABLE_KEY: "sb_publishable_example" },
      openRepository,
    })
    expect(sources.status).toBe(401)
    expect(repo.jobs.size).toBe(0)

    const secret = await handleImportsApi(post({ url: "https://example.com/q" }, TOKEN), {
      env: {
        SUPABASE_URL: "https://bhylflnzkwmhhaskduqp.supabase.co",
        SUPABASE_PUBLISHABLE_KEY: "sb_secret_not_for_clients",
      },
      openRepository,
    })
    expect(secret.status).toBe(503)
    expect(repo.jobs.size).toBe(0)
  })

  it("rejects credential fields, userinfo, oversized bodies, and unimplemented modes", async () => {
    const { repo, deps } = harness()
    const cookie = await handleImportsApi(
      post({ exam_id: EXAM, mode: "public_url", url: "https://example.com/q", pack: { headers: { cookie: "a" } } }, TOKEN),
      deps,
    )
    expect(cookie.status).toBe(400)
    expect(await cookie.json()).toMatchObject({ error_code: "IMPORT_CREDENTIALS_FORBIDDEN" })
    expect(repo.jobs.size).toBe(0)

    const userinfo = await handleImportsApi(post({ exam_id: EXAM, mode: "public_url", url: "https://user:pass@example.com/q" }, TOKEN), deps)
    expect(userinfo.status).toBe(400)
    expect(await userinfo.json()).toMatchObject({ error_code: "IMPORT_CREDENTIALS_FORBIDDEN" })

    const huge = await handleImportsApi(post({ exam_id: EXAM, mode: "paste_html", html: "x".repeat(40) }, TOKEN), {
      ...deps,
      maxBodyBytes: 32,
    })
    expect(huge.status).toBe(413)
    expect(await huge.json()).toMatchObject({ error_code: "PAYLOAD_TOO_LARGE" })

    for (const mode of ["extension_pack"]) {
      const response = await handleImportsApi(post({ exam_id: EXAM, mode, html: "<p>题</p>" }, TOKEN), deps)
      expect(response.status, mode).toBe(501)
      expect(await response.json()).toMatchObject({ error_code: "NOT_IMPLEMENTED" })
    }
    const upload = await handleImportsApi(
      new Request("http://127.0.0.1/api/v1/imports", {
        method: "POST",
        headers: { authorization: `Bearer ${TOKEN}`, "content-type": "multipart/form-data; boundary=x" },
      }),
      deps,
    )
    expect(upload.status).toBe(400)
    expect(repo.jobs.size).toBe(0)
  })

  it("imports pasted and uploaded formats, preserves supplied answers, and deduplicates retries", async () => {
    const { repo, deps } = harness({ fetchPublic: async () => { throw new Error("Local imports must not fetch") } })
    const fixtures = [
      { mode: "paste_html", content: `<ol><li>${stemA}</li></ol>` },
      { mode: "upload_json", content: JSON.stringify({ questions: [{ prompt: stemC, choices: ["页表", "段表"], answer_index: 0 }] }) },
      { mode: "upload_csv", content: `prompt\n"${stemB}"` },
      { mode: "upload_markdown", content: `- ${stemC}` },
    ]
    for (const input of fixtures) {
      const first = await handleImportsApi(post({ exam_id: EXAM, ...input }, TOKEN), deps)
      expect(await first.json()).toMatchObject({ status: "succeeded" })
      const sources = repo.sources.size, items = repo.items.size
      const retry = await handleImportsApi(post({ exam_id: EXAM, ...input }, TOKEN), deps)
      expect(await retry.json()).toMatchObject({ status: "succeeded" })
      expect(repo.sources.size).toBe(sources)
      expect(repo.items.size).toBe(items)
    }
    expect(repo.sources.size).toBe(4)
    expect([...repo.items.values()].find((item) => item.answer_index === 0)?.choices).toEqual(["页表", "段表"])
    const credential = await handleImportsApi(post({ exam_id: EXAM, mode: "upload_json", content: JSON.stringify({ cookies: "forbidden", prompt: stemA }) }, TOKEN), deps)
    expect(credential.status).toBe(400)
    const foreignExam = await handleImportsApi(post({ exam_id: OTHER, ...fixtures[0] }, TOKEN), deps)
    expect(foreignExam.status).toBe(404)
  })

  it("accepts a multipart file and preserves case-sensitive boundaries", async () => {
    const { deps } = harness()
    const form = new FormData()
    form.set("exam_id", EXAM)
    form.set("mode", "upload_json")
    form.set("file", new File([JSON.stringify([{ prompt: stemA }])], "Bank.json", { type: "application/json" }))
    const response = await handleImportsApi(new Request("http://localhost/api/v1/imports", { method: "POST", headers: { authorization: `Bearer ${TOKEN}` }, body: form }), deps)
    expect(await response.json()).toMatchObject({ status: "succeeded" })
  })

  it("imports a public page, upserts items by external key, and reads them back", async () => {
    const seen: string[] = []
    const { repo, deps } = harness({
      fetchPublic: async (url) => {
        seen.push(url)
        return ok(pageHtml)
      },
    })
    const first = await handleImportsApi(
      post({ exam_id: EXAM, mode: "public_url", url: "https://Example.com/os#frag", paper_kind: "diagnostic" }, TOKEN),
      deps,
    )
    expect(first.status).toBe(202)
    const created = (await first.json()) as { job_id: string; source_id: string; status: string }
    expect(created.status).toBe("succeeded")
    expect(seen).toEqual(["https://example.com/os"])
    expect(repo.sources.size).toBe(1)
    expect(repo.items.size).toBe(3)
    const source = [...repo.sources.values()][0]
    expect(source?.paper_kind).toBe("diagnostic")
    expect(source?.title).toBe("OS quiz")
    expect(source?.raw_meta).toMatchObject({ parser: "scrapling", parser_impl: "node-html-adapter" })
    const mcq = [...repo.items.values()].find((item) => item.external_key === externalKeyFor(stemC))
    expect(mcq?.choices).toEqual(["页表", "段表"])
    expect(mcq?.answer_index).toBe(0)

    const again = await handleImportsApi(post({ exam_id: EXAM, mode: "public_url", url: "https://example.com/os" }, TOKEN), deps)
    expect(again.status).toBe(202)
    expect(repo.sources.size).toBe(1)
    expect(repo.items.size).toBe(3)
    expect([...repo.items.values()].find((item) => item.external_key === externalKeyFor(stemC))?.id).toBe(mcq?.id)

    const job = await handleImportsApi(new Request(`http://127.0.0.1/api/v1/imports/${created.job_id}`, { headers: auth() }), deps)
    expect(job.status).toBe(200)
    const byQuery = await handleImportsApi(new Request(`http://127.0.0.1/api/v1/imports?job_id=${created.job_id}`, { headers: auth() }), deps)
    expect(byQuery.status).toBe(200)
    const jobBody = (await job.json()) as { job: ImportJobRecord }
    expect(jobBody.job.status).toBe("succeeded")
    expect(jobBody.job.parser).toBe("scrapling")
    expect(jobBody.job.stats).toMatchObject({ items_upserted: 3, parser_impl: "node-html-adapter" })

    const sources = await handleImportsApi(new Request(`http://127.0.0.1/api/v1/sources?exam_id=${EXAM}`, { headers: auth() }), deps)
    expect(sources.status).toBe(200)
    expect(((await sources.json()) as { sources: SourceRecord[] }).sources).toHaveLength(1)

    const items = await handleImportsApi(
      new Request(`http://127.0.0.1/api/v1/items?source_id=${created.source_id}`, { headers: auth() }),
      deps,
    )
    expect(items.status).toBe(200)
    expect(((await items.json()) as { items: ItemRecord[] }).items).toHaveLength(3)

    const missingFilter = await handleImportsApi(new Request("http://127.0.0.1/api/v1/items", { headers: auth() }), deps)
    expect(missingFilter.status).toBe(400)
    const byTopic = await handleImportsApi(
      new Request(`http://127.0.0.1/api/v1/items?exam_id=${EXAM}&topic_id=${OTHER}`, { headers: auth() }),
      deps,
    )
    expect(byTopic.status).toBe(200)
    expect(((await byTopic.json()) as { items: ItemRecord[] }).items).toEqual([])
  })

  it("rejects a login wall and a metadata address without writing items", async () => {
    const login = harness({
      fetchPublic: async () =>
        ok("<html><body><form><h1>请登录</h1><p>登录后才能查看这套题。</p><input type='password'></form></body></html>"),
    })
    const wall = await handleImportsApi(post({ exam_id: EXAM, mode: "public_url", url: "https://example.com/private" }, TOKEN), login.deps)
    expect(wall.status).toBe(422)
    expect(await wall.json()).toMatchObject({ error_code: "LOGIN_WALL", status: "rejected" })
    expect(login.repo.sources.size).toBe(0)
    expect(login.repo.items.size).toBe(0)

    let fetched = 0
    const metadata = harness({
      fetchPublic: (url) =>
        fetchPublicPage(url, {
          resolve: async () => {
            throw new Error("dns")
          },
          request: async () => {
            fetched += 1
            throw new Error("should not fetch")
          },
        }),
    })
    const blocked = await handleImportsApi(
      post({ exam_id: EXAM, mode: "public_url", url: "http://169.254.169.254/latest/meta-data" }, TOKEN),
      metadata.deps,
    )
    expect(blocked.status).toBe(400)
    expect(await blocked.json()).toMatchObject({ error_code: "URL_REJECTED", status: "rejected" })
    expect(fetched).toBe(0)
    expect(metadata.repo.items.size).toBe(0)
  })

  it("records an oversized public page and a source owned by another exam", async () => {
    const oversized = harness({ fetchPublic: async () => ({ outcome: "too_large", limit: 2 * 1024 * 1024, contentType: "text/html" }) })
    const tooBig = await handleImportsApi(post({ exam_id: EXAM, mode: "public_url", url: "https://example.com/big" }, TOKEN), oversized.deps)
    expect(tooBig.status).toBe(413)
    expect(await tooBig.json()).toMatchObject({ error_code: "PAYLOAD_TOO_LARGE", status: "rejected" })

    const conflict = harness()
    conflict.repo.seedSource(OTHER, "https://example.com/os")
    const response = await handleImportsApi(post({ exam_id: EXAM, mode: "public_url", url: "https://example.com/os" }, TOKEN), {
      ...conflict.deps,
      fetchPublic: async () => ok(pageHtml),
    })
    expect(response.status).toBe(409)
    expect(await response.json()).toMatchObject({ error_code: "SOURCE_EXAM_CONFLICT", status: "rejected" })
  })

  it("resolves the vercel rewrite onto the public path", () => {
    const rewritten = resolveRequestUrl(new Request("http://127.0.0.1/api/import-v1?__route=imports/abc-def&exam_id=1"))
    expect(rewritten.pathname).toBe("/api/v1/imports/abc-def")
    expect(rewritten.searchParams.get("exam_id")).toBe("1")
    expect(rewritten.searchParams.get("__route")).toBeNull()
    const direct = resolveRequestUrl(new Request(`http://127.0.0.1/api/v1/sources?exam_id=${EXAM}&__route=items`))
    expect(direct.pathname).toBe("/api/v1/sources")
  })
})

class MemoryRepo implements ImportRepository {
  readonly userId = "user-1"
  readonly jobs = new Map<string, ImportJobRecord>()
  readonly sources = new Map<string, SourceRecord>()
  readonly items = new Map<string, ItemRecord>()
  private exams: Set<string>
  private tick = 0

  constructor(exams: string[] = [EXAM]) {
    this.exams = new Set(exams)
  }

  async getExam(examId: string): Promise<{ id: string } | null> {
    return this.exams.has(examId) ? { id: examId } : null
  }

  async insertJob(input: NewJob): Promise<ImportJobRecord> {
    const stamp = this.stamp()
    const job: ImportJobRecord = {
      id: crypto.randomUUID(),
      exam_id: input.examId,
      source_id: null,
      mode: input.mode ?? "public_url",
      status: "queued",
      request_url: input.requestUrl,
      declared_source_url: null,
      paper_kind: input.paperKind,
      parser: "scrapling",
      stats: {},
      error_code: null,
      error_message: null,
      created_at: stamp,
      updated_at: stamp,
      finished_at: null,
    }
    this.jobs.set(job.id, job)
    return job
  }

  async updateJob(id: string, patch: JobPatch): Promise<ImportJobRecord> {
    const current = this.jobs.get(id)
    if (!current) throw new Error("missing job")
    const next: ImportJobRecord = {
      ...current,
      status: patch.status ?? current.status,
      source_id: "sourceId" in patch ? (patch.sourceId ?? null) : current.source_id,
      stats: patch.stats ?? current.stats,
      error_code: "errorCode" in patch ? (patch.errorCode ?? null) : current.error_code,
      error_message: "errorMessage" in patch ? (patch.errorMessage ?? null) : current.error_message,
      finished_at: "finishedAt" in patch ? (patch.finishedAt ?? null) : current.finished_at,
      updated_at: this.stamp(),
    }
    this.jobs.set(id, next)
    return next
  }

  async getJob(id: string): Promise<ImportJobRecord | null> {
    return this.jobs.get(id) ?? null
  }

  async listSources(examId: string, limit: number): Promise<SourceRecord[]> {
    return [...this.sources.values()]
      .filter((source) => source.exam_id === examId)
      .sort((a, b) => b.created_at.localeCompare(a.created_at))
      .slice(0, limit)
  }

  async listItems(filter: { sourceId?: string; examId?: string; topicId?: string }, limit: number): Promise<ItemRecord[]> {
    return [...this.items.values()]
      .filter((item) => (filter.sourceId ? item.source_id === filter.sourceId : true))
      .filter((item) => (filter.examId ? item.exam_id === filter.examId : true))
      .filter((item) => (filter.topicId ? item.topic_id === filter.topicId : true))
      .sort((a, b) => a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id))
      .slice(0, limit)
  }

  async upsertSource(input: SourceUpsert): Promise<{ id: string }> {
    const existing = [...this.sources.values()].find((source) => input.id ? source.id === input.id : source.url === input.url)
    if (existing && existing.exam_id !== input.examId) throw new SourceExamConflict()
    const stamp = this.stamp()
    const id = existing?.id ?? input.id ?? crypto.randomUUID()
    this.sources.set(id, {
      id,
      exam_id: input.examId,
      kind: input.kind ?? "url",
      paper_kind: input.paperKind,
      url: input.url,
      title: input.title,
      status: "ready",
      etag: input.etag,
      last_fetched_at: input.fetchedAt,
      error_message: null,
      raw_meta: input.rawMeta,
      created_at: existing?.created_at ?? stamp,
      updated_at: stamp,
    })
    return { id }
  }

  async upsertItems(items: ItemUpsert[]): Promise<number> {
    for (const item of items) {
      const existing = [...this.items.values()].find(
        (row) => row.source_id === item.sourceId && row.external_key === item.externalKey,
      )
      const stamp = this.stamp()
      const id = existing?.id ?? crypto.randomUUID()
      this.items.set(id, {
        id,
        exam_id: item.examId,
        source_id: item.sourceId,
        topic_id: existing?.topic_id ?? null,
        kind: item.kind,
        external_key: item.externalKey,
        prompt: item.prompt,
        choices: item.choices,
        answer_index: item.answerIndex,
        answer_text: item.answerText,
        is_active: true,
        provenance: item.provenance,
        created_at: existing?.created_at ?? stamp,
        updated_at: stamp,
      })
    }
    return items.length
  }

  seedSource(examId: string, url: string) {
    const stamp = this.stamp()
    const id = crypto.randomUUID()
    this.sources.set(id, {
      id,
      exam_id: examId,
      kind: "url",
      paper_kind: "practice",
      url,
      title: "other",
      status: "ready",
      etag: null,
      last_fetched_at: stamp,
      error_message: null,
      raw_meta: {},
      created_at: stamp,
      updated_at: stamp,
    })
  }

  private stamp(): string {
    this.tick += 1
    return new Date(Date.UTC(2026, 10, 3, 0, 0, this.tick)).toISOString()
  }
}

function harness(options: { fetchPublic?: ImportApiDeps["fetchPublic"] } = {}) {
  const repo = new MemoryRepo()
  const deps: ImportApiDeps = {
    env: {
      SUPABASE_URL: "https://bhylflnzkwmhhaskduqp.supabase.co",
      SUPABASE_PUBLISHABLE_KEY: "sb_publishable_example",
    },
    openRepository: async () => ({ userId: repo.userId, repo }),
    fetchPublic: options.fetchPublic ?? (async () => ok(pageHtml)),
    now: () => new Date("2026-11-03T00:00:00.000Z"),
  }
  return { repo, deps }
}

function post(body: Record<string, unknown>, token?: string): Request {
  const headers = new Headers({ "content-type": "application/json" })
  if (token) headers.set("authorization", `Bearer ${token}`)
  return new Request("http://127.0.0.1/api/v1/imports", { method: "POST", headers, body: JSON.stringify(body) })
}

function auth(): Headers {
  return new Headers({ authorization: `Bearer ${TOKEN}` })
}

function ok(body: string): PublicFetchResult {
  return {
    outcome: "ok",
    status: 200,
    finalUrl: "https://example.com/os",
    contentType: "text/html",
    body,
    bytes: body.length,
    etag: null,
  }
}
