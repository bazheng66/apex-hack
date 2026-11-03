/**
 * Locked import contract v1: modes, size limits, and credential rejection.
 * Public URL fetches apply the HTML cap (or the JSON/CSV/Markdown cap) to the response body.
 */

export const LIMITS = {
  htmlBytes: 2 * 1024 * 1024,
  jsonCsvMarkdownBytes: 5 * 1024 * 1024,
  maxUrlLength: 2000,
} as const

export const IMPORT_MODES = [
  "public_url",
  "paste_html",
  "upload_json",
  "upload_csv",
  "upload_markdown",
  "extension_pack",
] as const

export type ImportMode = (typeof IMPORT_MODES)[number]
export type PaperKind = "practice" | "diagnostic" | "standard"
export type ImportStatus = "queued" | "running" | "succeeded" | "failed" | "rejected"

const PAPER_KINDS = new Set<PaperKind>(["practice", "diagnostic", "standard"])

const FORBIDDEN_KEYS = new Set([
  "cookie",
  "cookies",
  "authorization",
  "storagestate",
  "setcookie",
  "headers",
])

export function isImportMode(value: unknown): value is ImportMode {
  return typeof value === "string" && (IMPORT_MODES as readonly string[]).includes(value)
}

export function isPaperKind(value: unknown): value is PaperKind {
  return typeof value === "string" && PAPER_KINDS.has(value as PaperKind)
}

export function assertSize(mode: ImportMode, byteLength: number): string | null {
  const max =
    mode === "paste_html" || mode === "extension_pack" ? LIMITS.htmlBytes : LIMITS.jsonCsvMarkdownBytes
  if (mode === "public_url") return null
  return byteLength > max ? "PAYLOAD_TOO_LARGE" : null
}

export function responseByteLimit(contentType: string): number {
  const type = contentType.toLowerCase()
  if (
    type.includes("json") ||
    type.includes("csv") ||
    type.includes("markdown") ||
    type.includes("text/plain")
  ) {
    return LIMITS.jsonCsvMarkdownBytes
  }
  return LIMITS.htmlBytes
}

/** Walk the JSON body. A credential-shaped key anywhere in the tree is forbidden. */
export function rejectCredentialFields(value: unknown): "IMPORT_CREDENTIALS_FORBIDDEN" | "INVALID_INPUT" | null {
  const state = { nodes: 0 }
  return walk(value, 0, state)
}

export function canonicalPublicUrl(raw: string): string | null {
  const trimmed = raw.trim()
  if (!trimmed || trimmed.length > LIMITS.maxUrlLength) return null
  let url: URL
  try {
    url = new URL(trimmed)
  } catch {
    return null
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null
  if (url.username || url.password) return null
  url.hash = ""
  const canonical = url.toString()
  return canonical.length > LIMITS.maxUrlLength ? null : canonical
}

export function urlHasCredentials(raw: string): boolean {
  try {
    const url = new URL(raw.trim())
    return Boolean(url.username || url.password)
  } catch {
    return false
  }
}

function walk(value: unknown, depth: number, state: { nodes: number }): "IMPORT_CREDENTIALS_FORBIDDEN" | "INVALID_INPUT" | null {
  state.nodes += 1
  if (state.nodes > 2000 || depth > 8) return "INVALID_INPUT"
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = walk(item, depth + 1, state)
      if (found) return found
    }
    return null
  }
  if (!value || typeof value !== "object") return null
  for (const key of Object.keys(value)) {
    if (FORBIDDEN_KEYS.has(canonicalKey(key))) return "IMPORT_CREDENTIALS_FORBIDDEN"
    const found = walk((value as Record<string, unknown>)[key], depth + 1, state)
    if (found) return found
  }
  return null
}

function canonicalKey(key: string): string {
  return key.trim().toLowerCase().replace(/[_-]/g, "")
}
