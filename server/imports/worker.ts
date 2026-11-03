import { gateReason } from "../../src/engine/import-bank.js"
import type { ImportJobRecord, ImportRepository, ItemUpsert } from "./repository.js"
import { SourceExamConflict } from "./repository.js"
import { fetchPublicPage, type PublicFetchResult } from "./public-fetch.js"
import { createNodeScraplingParser, pageTitle, type ScraplingParser } from "./scrapling.js"

export const MESSAGES = {
  LOGIN_WALL: "This public page is behind a login wall. Import it from your side with paste, upload, or an extension pack.",
  PAYLOAD_TOO_LARGE: "The public page is larger than the import size limit.",
  URL_REJECTED: "That URL is not a public http(s) address.",
  FETCH_FAILED: "The public page could not be fetched.",
  FETCH_TIMEOUT: "The public page timed out.",
  PARSE_EMPTY: "No questions were found on the public page.",
  IMPORT_CREDENTIALS_FORBIDDEN: "Import requests cannot include cookies, authorization, storage state, or proxy headers.",
  SOURCE_EXAM_CONFLICT: "This URL is already imported for a different exam.",
  WRITE_FAILED: "The import could not be saved.",
} as const

export type FetchPublic = (url: string) => Promise<PublicFetchResult>

export async function runPublicUrlJob(
  repo: ImportRepository,
  job: ImportJobRecord,
  deps: { fetchPublic?: FetchPublic; parser?: ScraplingParser; now?: () => Date } = {},
): Promise<ImportJobRecord> {
  const fetchPublic = deps.fetchPublic ?? ((url: string) => fetchPublicPage(url))
  const parser = deps.parser ?? createNodeScraplingParser()
  const now = deps.now ?? (() => new Date())
  await repo.updateJob(job.id, { status: "running" })
  try {
    const requestUrl = job.request_url ?? ""
    const fetched = await fetchPublic(requestUrl)
    if (fetched.outcome === "blocked") {
      const code = fetched.reason === "credentials" ? "IMPORT_CREDENTIALS_FORBIDDEN" : "URL_REJECTED"
      return finish(repo, job.id, now, {
        status: "rejected",
        errorCode: code,
        errorMessage: code === "IMPORT_CREDENTIALS_FORBIDDEN" ? MESSAGES.IMPORT_CREDENTIALS_FORBIDDEN : MESSAGES.URL_REJECTED,
        stats: baseStats(parser),
      })
    }
    if (fetched.outcome === "too_large") {
      return finish(repo, job.id, now, {
        status: "rejected",
        errorCode: "PAYLOAD_TOO_LARGE",
        errorMessage: MESSAGES.PAYLOAD_TOO_LARGE,
        stats: { ...baseStats(parser), limit: fetched.limit },
      })
    }
    if (fetched.outcome === "error") {
      return finish(repo, job.id, now, {
        status: "failed",
        errorCode: "FETCH_FAILED",
        errorMessage: fetched.reason === "timeout" ? MESSAGES.FETCH_TIMEOUT : MESSAGES.FETCH_FAILED,
        stats: baseStats(parser),
      })
    }
    const gate = gateReason(fetched.status, fetched.body)
    if (gate === "login" || gate === "forbidden") {
      return finish(repo, job.id, now, {
        status: "rejected",
        errorCode: "LOGIN_WALL",
        errorMessage: MESSAGES.LOGIN_WALL,
        stats: fetchStats(parser, fetched),
      })
    }
    if (fetched.status < 200 || fetched.status >= 300) {
      return finish(repo, job.id, now, {
        status: "failed",
        errorCode: "FETCH_FAILED",
        errorMessage: MESSAGES.FETCH_FAILED,
        stats: fetchStats(parser, fetched),
      })
    }
    const parsed = parser.parse({ url: requestUrl, contentType: fetched.contentType, body: fetched.body })
    if (parsed.items.length === 0) {
      return finish(repo, job.id, now, {
        status: "failed",
        errorCode: "PARSE_EMPTY",
        errorMessage: MESSAGES.PARSE_EMPTY,
        stats: { ...fetchStats(parser, fetched), items_seen: 0, items_upserted: 0 },
      })
    }
    const source = await repo.upsertSource({
      examId: job.exam_id,
      url: requestUrl,
      title: pageTitle(fetched.body, fetched.finalUrl),
      paperKind: paperKindOf(job.paper_kind),
      etag: fetched.etag,
      fetchedAt: now().toISOString(),
      rawMeta: {
        parser: parser.id,
        parser_impl: parser.impl,
        content_type: fetched.contentType,
        final_url: fetched.finalUrl,
        http_status: fetched.status,
      },
    })
    const items: ItemUpsert[] = parsed.items.map((item) => ({
      examId: job.exam_id,
      sourceId: source.id,
      kind: item.kind,
      externalKey: item.external_key,
      prompt: item.prompt,
      choices: item.choices,
      answerIndex: item.answer_index,
      answerText: item.answer_text,
      provenance: { parser: parser.id, parser_impl: parser.impl, url: requestUrl },
    }))
    const upserted = await repo.upsertItems(items)
    return finish(repo, job.id, now, {
      status: "succeeded",
      sourceId: source.id,
      errorCode: null,
      errorMessage: null,
      stats: {
        ...fetchStats(parser, fetched),
        items_seen: parsed.seen,
        items_upserted: upserted,
        truncated: parsed.truncated,
      },
    })
  } catch (error) {
    if (error instanceof SourceExamConflict) {
      return finish(repo, job.id, now, {
        status: "rejected",
        errorCode: "SOURCE_EXAM_CONFLICT",
        errorMessage: MESSAGES.SOURCE_EXAM_CONFLICT,
        stats: baseStats(parser),
      })
    }
    console.error("import worker failed", error instanceof Error ? error.message.slice(0, 300) : "unknown")
    return finish(repo, job.id, now, {
      status: "failed",
      errorCode: "WRITE_FAILED",
      errorMessage: MESSAGES.WRITE_FAILED,
      stats: baseStats(parser),
    })
  }
}

function finish(
  repo: ImportRepository,
  jobId: string,
  now: () => Date,
  patch: {
    status: ImportJobRecord["status"]
    sourceId?: string | null
    errorCode?: string | null
    errorMessage?: string | null
    stats: Record<string, unknown>
  },
): Promise<ImportJobRecord> {
  return repo.updateJob(jobId, {
    status: patch.status,
    sourceId: patch.sourceId ?? null,
    errorCode: patch.errorCode ?? null,
    errorMessage: patch.errorMessage ?? null,
    stats: patch.stats,
    finishedAt: now().toISOString(),
  })
}

function baseStats(parser: ScraplingParser): Record<string, unknown> {
  return { parser: parser.id, parser_impl: parser.impl }
}

function fetchStats(parser: ScraplingParser, fetched: Extract<PublicFetchResult, { outcome: "ok" }>): Record<string, unknown> {
  return {
    ...baseStats(parser),
    http_status: fetched.status,
    bytes: fetched.bytes,
    final_url: fetched.finalUrl,
  }
}

function paperKindOf(value: string): "practice" | "diagnostic" | "standard" {
  if (value === "diagnostic" || value === "standard") return value
  return "practice"
}
