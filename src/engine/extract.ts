function parseRecord(slice: string): Record<string, unknown> | null {
  const repaired = withoutTrailingCommas(slice)
  const candidates = repaired === slice ? [slice] : [slice, repaired]
  for (const candidate of candidates) {
    try {
      const value: unknown = JSON.parse(candidate)
      if (!value || typeof value !== "object" || Array.isArray(value)) continue
      return value as Record<string, unknown>
    } catch {
      // A trailing comma is tried on the next candidate.
    }
  }
  return null
}

function withoutTrailingCommas(slice: string): string {
  let current = slice
  let next = current.replace(/,\s*([}\]])/g, "$1")
  while (next !== current) {
    current = next
    next = current.replace(/,\s*([}\]])/g, "$1")
  }
  return current
}

function matchingBrace(text: string, start: number): number {
  let depth = 0
  let inString = false
  let escaped = false
  for (let index = start; index < text.length; index += 1) {
    const ch = text[index]
    if (inString) {
      if (escaped) escaped = false
      else if (ch === "\\") escaped = true
      else if (ch === "\"") inString = false
      continue
    }
    if (ch === "\"") {
      inString = true
      continue
    }
    if (ch === "{") depth += 1
    else if (ch === "}") {
      depth -= 1
      if (depth === 0) return index
    }
  }
  return -1
}

function objectsInText(text: string): Record<string, unknown>[] {
  const found: Record<string, unknown>[] = []
  for (let index = 0; index < text.length; index += 1) {
    if (text[index] !== "{") continue
    const end = matchingBrace(text, index)
    if (end < 0) continue
    const value = parseRecord(text.slice(index, end + 1))
    if (!value) continue
    found.push(value)
    index = end
  }
  return found
}

function jsonObjects(raw: string): Record<string, unknown>[] {
  const fenced: string[] = []
  for (const match of raw.matchAll(/```(?:json)?\s*([\s\S]*?)```/g)) {
    if (match[1]) fenced.push(match[1])
  }
  return [...fenced.flatMap((body) => objectsInText(body)), ...objectsInText(raw)]
}

export function extractJsonObject(raw: string): Record<string, unknown> | null {
  const objects = jsonObjects(raw)
  if (objects.length === 0) return null
  return objects.reduce((best, item) => (JSON.stringify(item).length > JSON.stringify(best).length ? item : best))
}

export function clipText(value: unknown, max: number): string {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max)
}

function stemsFrom(parsed: Record<string, unknown>): { stem: string }[] {
  const list = Array.isArray(parsed.questions) ? parsed.questions : []
  const stems: { stem: string }[] = []
  for (const item of list) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue
    const rawStem = (item as { stem?: unknown }).stem
    if (typeof rawStem !== "string") continue
    const stem = clipText(rawStem, 220)
    if (stem.length < 12) continue
    stems.push({ stem })
    if (stems.length === 2) break
  }
  return stems
}

export function questionsFromModel(raw: string): { stem: string }[] {
  const ranked = jsonObjects(raw)
    .filter((item) => item.found !== false)
    .sort((a, b) => JSON.stringify(b).length - JSON.stringify(a).length)
  for (const parsed of ranked) {
    const stems = stemsFrom(parsed)
    if (stems.length > 0) return stems
  }
  return []
}

function isBlockedHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/\.+$/, "")
  if (
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host.endsWith(".local") ||
    host.endsWith(".internal") ||
    host === "localhost.localdomain" ||
    host.endsWith(".localhost.localdomain")
  ) {
    return true
  }
  if (/^(127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[0-1])\.|0\.0\.0\.0|169\.254\.)/.test(host)) return true
  return !host.includes(".")
}

export function safePageUrl(value: string): string | null {
  try {
    const url = new URL(value)
    if (url.protocol !== "https:" && url.protocol !== "http:") return null
    if (url.username || url.password) return null
    if (isBlockedHost(url.hostname)) return null
    return url.toString()
  } catch {
    return null
  }
}

export function visionReading(raw: string): { seen: string; comment: string } {
  const ranked = jsonObjects(raw).sort((a, b) => JSON.stringify(b).length - JSON.stringify(a).length)
  for (const parsed of ranked) {
    const comment = clipText(parsed.comment, 400)
    if (!comment) continue
    return { seen: clipText(parsed.seen, 240), comment }
  }
  return { seen: "", comment: clipText(raw, 400) }
}
