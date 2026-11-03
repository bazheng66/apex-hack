import { createHash } from "node:crypto"
import { parseImportedBank, type ImportHint } from "../../src/engine/import-bank.js"
import type { ImportMode } from "./contract.js"
import { createNodeScraplingParser, externalKeyFor, type ScraplingParsedItem } from "./scrapling.js"
import type { ImportJobRecord, ImportRepository } from "./repository.js"

export interface LocalInput { content: string; mode: ImportMode; filename?: string; declaredSourceUrl?: string | null }
export function inputHash(input: LocalInput) { return createHash("sha256").update(`${input.mode}\0${input.content}`).digest("hex") }
function sourceId(userId: string, examId: string, hash: string) {
  const value = createHash("sha256").update(`${userId}/${examId}/${hash}`).digest("hex")
  return `${value.slice(0,8)}-${value.slice(8,12)}-5${value.slice(13,16)}-a${value.slice(17,20)}-${value.slice(20,32)}`
}

export async function runLocalJob(repo: ImportRepository, job: ImportJobRecord, input: LocalInput, now = () => new Date()): Promise<ImportJobRecord> {
  await repo.updateJob(job.id, { status: "running" })
  try {
    const hint: ImportHint = input.mode === "upload_json" ? "json" : input.mode === "upload_csv" ? "csv" : input.mode === "upload_markdown" ? "md" : "html"
    const structured = hint === "json" || hint === "html" ? createNodeScraplingParser().parse({ url: "", body: input.content, contentType: hint === "json" ? "application/json" : "text/html" }).items : []
    const parsed: ScraplingParsedItem[] = structured.length ? structured : parseImportedBank(input.content, input.mode === "paste_html" ? undefined : hint).map(({ stem }) => ({ external_key: externalKeyFor(stem), kind: "unknown", prompt: stem, choices: null, answer_index: null, answer_text: null }))
    if (!parsed.length) return repo.updateJob(job.id, { status: "failed", errorCode: "PARSE_EMPTY", errorMessage: "No questions were found in the supplied content.", finishedAt: now().toISOString() })
    const hash = inputHash(input)
    const source = await repo.upsertSource({ id: sourceId(repo.userId, job.exam_id, hash), examId: job.exam_id,
      kind: input.mode === "paste_html" && !input.filename ? "manual" : "upload", url: null,
      title: input.filename?.slice(0,180) || "粘贴的题目", paperKind: job.paper_kind as "practice" | "diagnostic" | "standard",
      etag: null, fetchedAt: now().toISOString(), rawMeta: { mode: input.mode, input_sha256: hash, declared_source_url: input.declaredSourceUrl ?? null },
    })
    const count = await repo.upsertItems(parsed.map((item) => ({
      examId: job.exam_id, sourceId: source.id, kind: item.kind, externalKey: item.external_key,
      prompt: item.prompt, choices: item.choices, answerIndex: item.answer_index, answerText: item.answer_text,
      provenance: { mode: input.mode, input_sha256: hash, declared_source_url: input.declaredSourceUrl ?? null },
    })))
    return repo.updateJob(job.id, { status: "succeeded", sourceId: source.id, errorCode: null, errorMessage: null,
      stats: { items_seen: parsed.length, items_upserted: count, input_sha256: hash }, finishedAt: now().toISOString() })
  } catch {
    return repo.updateJob(job.id, { status: "failed", errorCode: "WRITE_FAILED", errorMessage: "The import could not be saved. Retry the same content.", finishedAt: now().toISOString() })
  }
}
