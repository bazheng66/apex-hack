import {
  LIMITS,
  assertSize,
  canonicalPublicUrl,
  isImportMode,
  isPaperKind,
  rejectCredentialFields,
  urlHasCredentials,
  type PaperKind,
} from "./contract.js"
import type { ImportJobRecord, ImportRepository } from "./repository.js"
import { openUserRepository, readSupabasePublicEnv, type SupabasePublicEnv } from "./repository.js"
import type { FetchPublic } from "./worker.js"
import { MESSAGES, runPublicUrlJob } from "./worker.js"
import type { ScraplingParser } from "./scrapling.js"

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export type OpenRepository = (
  jwt: string,
  env: SupabasePublicEnv,
) => Promise<{ userId: string; repo: ImportRepository } | null>

export type ImportApiDeps = {
  env?: Record<string, string | undefined>
  openRepository?: OpenRepository
  fetchPublic?: FetchPublic
  parser?: ScraplingParser
  now?: () => Date
  maxBodyBytes?: number
}

export function resolveRequestUrl(request: Request): URL {
  const url = new URL(request.url)
  if (url.pathname === "/api/import-v1" || url.pathname.endsWith("/api/import-v1")) {
    const route = url.searchParams.get("__route")
    if (route !== null) {
      url.searchParams.delete("__route")
      const safe = safeRoute(route)
      if (!safe) return new URL(`/api/v1/__invalid__${url.search}`, url.origin)
      return new URL(`/api/v1/${safe}${url.search}`, url.origin)
    }
  }
  return url
}

export async function handleImportsApi(request: Request, deps: ImportApiDeps = {}): Promise<Response> {
  try {
    return await route(request, deps)
  } catch (error) {
    console.error("import api failed", error instanceof Error ? error.message.slice(0, 300) : "unknown")
    return json(500, { error_code: "INTERNAL", error_message: MESSAGES.WRITE_FAILED })
  }
}

export async function readLimitedBody(request: Request, maxBytes: number): Promise<{ ok: true; bytes: Uint8Array } | { ok: false }> {
  const declared = Number(request.headers.get("content-length") ?? "")
  if (Number.isFinite(declared) && declared > maxBytes) return { ok: false }
  if (!request.body) return { ok: true, bytes: new Uint8Array() }
  const reader = request.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  for (;;) {
    const step = await reader.read()
    if (step.done) break
    const value = step.value
    if (!value) continue
    total += value.byteLength
    if (total > maxBytes) {
      await reader.cancel().catch(() => undefined)
      return { ok: false }
    }
    chunks.push(value)
  }
  const bytes = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  return { ok: true, bytes }
}

async function route(request: Request, deps: ImportApiDeps): Promise<Response> {
  const url = resolveRequestUrl(request)
  const parts = url.pathname.split("/").filter(Boolean)
  if (parts[0] !== "api" || parts[1] !== "v1") return notFound()
  if (parts[2] === "imports") return importsRoute(request, url, parts, deps)
  if (parts[2] === "sources" && parts.length === 3) return sourcesRoute(request, url, deps)
  if (parts[2] === "items" && parts.length === 3) return itemsRoute(request, url, deps)
  return notFound()
}

async function importsRoute(request: Request, url: URL, parts: string[], deps: ImportApiDeps): Promise<Response> {
  if (request.method === "POST" && parts.length === 3) return createImport(request, deps)
  if (request.method === "GET") {
    const jobId = parts[3] ?? url.searchParams.get("job_id") ?? ""
    if (!jobId || parts.length > 4) return notFound()
    const auth = await authorize(request, deps)
    if (auth instanceof Response) return auth
    if (!isUuid(jobId)) return invalid("job_id must be a uuid.")
    const job = await auth.repo.getJob(jobId)
    if (!job) return json(404, { error_code: "NOT_FOUND", error_message: "Import job not found." })
    return json(200, { job })
  }
  return methodNotAllowed(parts.length === 3 ? "POST" : "GET")
}

async function sourcesRoute(request: Request, url: URL, deps: ImportApiDeps): Promise<Response> {
  if (request.method !== "GET") return methodNotAllowed("GET")
  const auth = await authorize(request, deps)
  if (auth instanceof Response) return auth
  const examId = url.searchParams.get("exam_id") ?? ""
  if (!isUuid(examId)) return invalid("exam_id must be a uuid.")
  const limit = takeLimit(url.searchParams)
  if (limit instanceof Response) return limit
  const sources = await auth.repo.listSources(examId, limit)
  return json(200, { sources })
}

async function itemsRoute(request: Request, url: URL, deps: ImportApiDeps): Promise<Response> {
  if (request.method !== "GET") return methodNotAllowed("GET")
  const auth = await authorize(request, deps)
  if (auth instanceof Response) return auth
  const sourceId = url.searchParams.get("source_id")
  const examId = url.searchParams.get("exam_id")
  const topicId = url.searchParams.get("topic_id")
  if (sourceId && !isUuid(sourceId)) return invalid("source_id must be a uuid.")
  if (examId && !isUuid(examId)) return invalid("exam_id must be a uuid.")
  if (topicId && !isUuid(topicId)) return invalid("topic_id must be a uuid.")
  if (!sourceId && !(examId && topicId)) {
    return invalid("Pass source_id, or both exam_id and topic_id.")
  }
  const limit = takeLimit(url.searchParams)
  if (limit instanceof Response) return limit
  const items = await auth.repo.listItems(
    {
      ...(sourceId ? { sourceId } : {}),
      ...(examId ? { examId } : {}),
      ...(topicId ? { topicId } : {}),
    },
    limit,
  )
  return json(200, { items })
}

async function createImport(request: Request, deps: ImportApiDeps): Promise<Response> {
  const auth = await authorize(request, deps)
  if (auth instanceof Response) return auth
  const type = (request.headers.get("content-type") ?? "").toLowerCase()
  const maxBody = deps.maxBodyBytes ?? LIMITS.jsonCsvMarkdownBytes
  if (type.includes("multipart/form-data")) {
    const declared = Number(request.headers.get("content-length") ?? "")
    if (Number.isFinite(declared) && declared > maxBody) return tooLarge()
    return notImplemented("upload")
  }
  const body = await readLimitedBody(request, maxBody)
  if (!body.ok) return tooLarge()
  let parsed: unknown
  try {
    parsed = JSON.parse(new TextDecoder().decode(body.bytes) || "null")
  } catch {
    return json(400, { error_code: "INVALID_JSON", error_message: "Request body must be JSON." })
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return invalid("Request body must be a JSON object.")
  }
  const record = parsed as Record<string, unknown>
  const forbidden = rejectCredentialFields(record)
  if (forbidden === "IMPORT_CREDENTIALS_FORBIDDEN") {
    return json(400, { error_code: "IMPORT_CREDENTIALS_FORBIDDEN", error_message: MESSAGES.IMPORT_CREDENTIALS_FORBIDDEN })
  }
  if (forbidden) return invalid("Request body is too nested to accept.")
  if (!isImportMode(record.mode)) return invalid("mode is not a supported import mode.")
  const sized = assertSize(record.mode, body.bytes.byteLength)
  if (sized) return tooLarge()
  if (record.mode !== "public_url") return notImplemented(record.mode)
  if (typeof record.url !== "string" || !record.url.trim()) return invalid("url is required for public_url.")
  if (urlHasCredentials(record.url)) {
    return json(400, { error_code: "IMPORT_CREDENTIALS_FORBIDDEN", error_message: MESSAGES.IMPORT_CREDENTIALS_FORBIDDEN })
  }
  const canonical = canonicalPublicUrl(record.url)
  if (!canonical) return json(400, { error_code: "URL_REJECTED", error_message: MESSAGES.URL_REJECTED })
  if (record.paper_kind !== undefined && !isPaperKind(record.paper_kind)) return invalid("paper_kind must be practice, diagnostic, or standard.")
  const paperKind: PaperKind = isPaperKind(record.paper_kind) ? record.paper_kind : "practice"
  if (typeof record.exam_id !== "string" || !isUuid(record.exam_id)) return invalid("exam_id must be a uuid.")
  const exam = await auth.repo.getExam(record.exam_id)
  if (!exam) return json(404, { error_code: "EXAM_NOT_FOUND", error_message: "Exam not found." })
  const job = await auth.repo.insertJob({ examId: record.exam_id, requestUrl: canonical, paperKind })
  const finished = await runPublicUrlJob(auth.repo, job, deps)
  return accepted(finished)
}

async function authorize(request: Request, deps: ImportApiDeps): Promise<{ repo: ImportRepository } | Response> {
  const token = bearerToken(request)
  if (!token) {
    return json(401, { error_code: "UNAUTHORIZED", error_message: "Send the Supabase access token as a Bearer token." })
  }
  const env = readSupabasePublicEnv(deps.env ?? process.env)
  if (!env) {
    return json(503, {
      error_code: "SUPABASE_NOT_CONFIGURED",
      error_message: "Set SUPABASE_URL and the publishable key. Do not put a secret key on the server.",
    })
  }
  const open = deps.openRepository ?? openUserRepository
  const opened = await open(token, env)
  if (!opened) return json(401, { error_code: "UNAUTHORIZED", error_message: "The Supabase access token was rejected." })
  return { repo: opened.repo }
}

function accepted(job: ImportJobRecord): Response {
  const body: Record<string, unknown> = { job_id: job.id, status: job.status }
  if (job.source_id) body.source_id = job.source_id
  if (job.error_code) {
    body.error_code = job.error_code
    body.error_message = job.error_message
  }
  return json(statusFor(job), body)
}

function statusFor(job: ImportJobRecord): number {
  if (job.status === "succeeded") return 202
  switch (job.error_code) {
    case "LOGIN_WALL":
      return 422
    case "PAYLOAD_TOO_LARGE":
      return 413
    case "URL_REJECTED":
    case "IMPORT_CREDENTIALS_FORBIDDEN":
      return 400
    case "SOURCE_EXAM_CONFLICT":
      return 409
    default:
      return 202
  }
}

function bearerToken(request: Request): string | null {
  const header = request.headers.get("authorization") ?? ""
  const match = /^Bearer\s+(\S+)$/i.exec(header.trim())
  const token = match?.[1]
  if (!token || token.length < 20 || token.length > 8192) return null
  return token
}

function takeLimit(params: URLSearchParams): number | Response {
  const raw = params.get("limit")
  if (raw === null || raw === "") return 50
  if (!/^\d+$/.test(raw)) return invalid("limit must be an integer from 1 to 100.")
  const limit = Number(raw)
  if (limit < 1 || limit > 100) return invalid("limit must be an integer from 1 to 100.")
  return limit
}

function isUuid(value: string): boolean {
  return UUID.test(value)
}

function safeRoute(route: string): string | null {
  const trimmed = route.replace(/^\/+|\/+$/g, "")
  if (!trimmed || trimmed.length > 240) return null
  const parts = trimmed.split("/")
  if (parts.some((part) => !/^[A-Za-z0-9_-]+$/.test(part))) return null
  return parts.join("/")
}

function invalid(errorMessage: string): Response {
  return json(400, { error_code: "INVALID_INPUT", error_message: errorMessage })
}

function tooLarge(): Response {
  return json(413, { error_code: "PAYLOAD_TOO_LARGE", error_message: "The request is larger than the import size limit." })
}

function notImplemented(mode: string): Response {
  return json(501, {
    error_code: "NOT_IMPLEMENTED",
    error_message: `mode ${mode} is not implemented. This version supports public_url only.`,
  })
}

function notFound(): Response {
  return json(404, { error_code: "NOT_FOUND", error_message: "No import route matches that path." })
}

function methodNotAllowed(allow: string): Response {
  return json(405, { error_code: "METHOD_NOT_ALLOWED", error_message: "Method not allowed." }, { allow })
}

function json(status: number, body: unknown, extra?: Record<string, string>): Response {
  const headers = new Headers({
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  })
  if (extra) {
    for (const [key, value] of Object.entries(extra)) headers.set(key, value)
  }
  return new Response(JSON.stringify(body), { status, headers })
}
