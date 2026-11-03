import {
  bankStorageKey,
  mergeStoredImport,
  parseStoredImports,
  type ImportFetchResult,
  type ImportReason,
  type ImportedStem,
  type StoredImport,
} from "../engine/import-bank.ts"
import { safePageUrl } from "../engine/extract.ts"
import { bootstrapSupabaseAuth, supabase } from "./supabase.ts"
import { findCloudRecord } from "./cloud-record.ts"

export interface CloudImportInput {
  mode: "public_url" | "paste_html" | "upload_json" | "upload_csv" | "upload_markdown"
  url?: string
  content?: string
  filename?: string
}
export async function requestCloudImport(examSlug: string, input: CloudImportInput): Promise<ImportedStem[]> {
  if (!supabase) throw new Error("云同步尚未配置。")
  await bootstrapSupabaseAuth()
  const { data, error } = await supabase.auth.getSession()
  if (error || !data.session) throw new Error("匿名会话未建立，请重试同步。")
  const cloud = await findCloudRecord(supabase, data.session.user.id, examSlug)
  if (!cloud) throw new Error("请先同步考试记录，再重试导入。")
  const headers = { "Content-Type": "application/json", Authorization: `Bearer ${data.session.access_token}` }
  const response = await fetch("/api/v1/imports", { method: "POST", headers, body: JSON.stringify({ exam_id: cloud.id, ...input }) })
  const result = await response.json() as { status?: string; source_id?: string; error_code?: string }
  if (result.error_code === "LOGIN_WALL") throw new Error("LOGIN_WALL")
  if (!response.ok || result.status !== "succeeded" || !result.source_id) throw new Error(result.error_code === "PARSE_EMPTY" ? "没有读到题目，请检查格式后重试。" : "题库同步失败，请重试。")
  const itemsResponse = await fetch(`/api/v1/items?source_id=${encodeURIComponent(result.source_id)}&limit=100`, { headers })
  if (!itemsResponse.ok) throw new Error("题目已收录，读取结果失败，请重试。")
  const items = await itemsResponse.json() as { items: { prompt: string }[] }
  return items.items.map((item) => ({ stem: item.prompt }))
}

export async function requestPublicImport(url: string): Promise<ImportFetchResult & { sourceUrl?: string }> {
  const safe = safePageUrl(url.trim())
  if (!safe) return { outcome: "miss", reason: "bad-url", questions: [] }
  try {
    const response = await fetch("/api/import-page", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: safe }),
    })
    const data: unknown = await response.json().catch(() => null)
    const parsed = readFetchResult(data)
    if (!response.ok || !parsed) return { outcome: "miss", reason: "unreachable", questions: [] }
    return parsed.outcome === "ok" ? { ...parsed, sourceUrl: safe } : parsed
  } catch {
    return { outcome: "miss", reason: "unreachable", questions: [] }
  }
}

export function rememberImport(examId: string, kind: StoredImport["kind"], source: string, questions: ImportedStem[]): StoredImport {
  const next: StoredImport = {
    id: crypto.randomUUID(),
    kind,
    source,
    questions,
    savedAt: new Date().toISOString(),
  }
  try {
    const key = bankStorageKey(examId)
    const current = parseStoredImports(localStorage.getItem(key))
    localStorage.setItem(key, JSON.stringify(mergeStoredImport(current, next)))
  } catch {
    // The panel still shows this import when the browser refuses storage.
  }
  return mergeStoredImport([], next)[0] ?? next
}

export async function readUploadedText(file: File): Promise<string> {
  const buffer = await file.arrayBuffer()
  const utf8 = new TextDecoder("utf-8", { fatal: false }).decode(buffer)
  if (!utf8.includes("\uFFFD")) return utf8
  try {
    return new TextDecoder("gbk").decode(buffer)
  } catch {
    return utf8
  }
}

function readFetchResult(data: unknown): ImportFetchResult | null {
  if (!data || typeof data !== "object" || Array.isArray(data)) return null
  const row = data as { outcome?: unknown; reason?: unknown; questions?: unknown }
  const questions = Array.isArray(row.questions)
    ? row.questions.flatMap((item) => {
        if (!item || typeof item !== "object") return []
        const stem = (item as { stem?: unknown }).stem
        if (typeof stem !== "string") return []
        const text = stem.replace(/\s+/g, " ").trim().slice(0, 480)
        return text ? [{ stem: text }] : []
      })
    : []
  if (row.outcome === "ok") {
    return questions.length > 0 ? { outcome: "ok", reason: "ok", questions } : { outcome: "miss", reason: "none", questions: [] }
  }
  if (row.outcome === "gated") return { outcome: "gated", reason: gatedReason(row.reason), questions: [] }
  if (row.outcome === "miss") return { outcome: "miss", reason: missReason(row.reason), questions: [] }
  return null
}

function gatedReason(value: unknown): ImportReason {
  if (value === "forbidden" || value === "empty" || value === "login") return value
  return "login"
}

function missReason(value: unknown): ImportReason {
  if (value === "timeout" || value === "none" || value === "unreachable" || value === "bad-url") return value
  return "unreachable"
}
