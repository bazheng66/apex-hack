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
