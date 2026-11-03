import { clipText, safePageUrl } from "./extract.js"

/** User-facing lines from the import-bank draft. Kept here so the panel and tests share one source. */
export const IMPORT_COPY = {
  title: "导入题库",
  note: "只收录你提供的公开页面里实际出现的题，不补写选项和答案。",
  start: "开始导入",
  reading: "正在读取页面…",
  missBefore: "这个链接里没读到题。换一个公开页，或用「",
  missLink: "需登录站点",
  missAfter: "」方式。",
  badUrl: "先贴一个 http 或 https 的公开页。",
  gatedTitle: "这个站点要登录才能看题",
  gatedLead: "浏览器这边登不进你的账号。你可以：",
  step1: "在已登录的页面复制题目，或导出后粘贴 HTML，也可上传 JSON / CSV / Markdown。",
  step2: "（预留）用书签脚本或扩展一键打包——稍后提供。",
  placeholder: "把题目 HTML 或纯文本贴这里",
  pasteTab: "粘贴内容",
  uploadTab: "上传文件",
  collect: "收录",
  pickFile: "选择文件",
  uploadNote: "只存你上传的来源",
  uploadAccept: "接受 .json、.csv、.md、.html，一次一个文件。",
  acknowledge: "我知道了",
  back: "换公开链接再试",
  badFormat: "格式没认出来。可改成 JSON（题干+选项）或 Markdown 列表再试。",
  close: "关闭",
} as const

export function missLine(): string {
  return `${IMPORT_COPY.missBefore}${IMPORT_COPY.missLink}${IMPORT_COPY.missAfter}`
}

export function publicSuccess(count: number): string {
  return `读到 ${count} 题 · 来源已记下`
}

export function localSuccess(count: number): string {
  return `已从粘贴/文件收录 ${count} 题`
}

export type ImportHint = "json" | "csv" | "md" | "html"
export type GateReason = "forbidden" | "empty" | "login"
export type ImportOutcome = "ok" | "gated" | "miss"
export type ImportReason = "ok" | GateReason | "timeout" | "none" | "unreachable" | "bad-url"

export interface ImportedStem {
  stem: string
}

export interface ImportFetchResult {
  outcome: ImportOutcome
  reason: ImportReason
  questions: ImportedStem[]
}

export interface StoredImport {
  id: string
  kind: "url" | "file" | "paste"
  source: string
  questions: ImportedStem[]
  savedAt: string
}

const MIN_STEM = 8
const MAX_STEM = 480
const MAX_QUESTIONS = 80
const MAX_INPUT = 1_000_000
const STEM_KEYS = ["stem", "question", "prompt", "题干", "题目", "问题"]
const LIST_KEYS = new Set(["questions", "items", "list", "problems", "stems", "题目", "题干"])
const CHOICE_KEYS = ["options", "choices", "answers", "answer", "选项", "答案"]
const LOGIN_PHRASE =
  /请先登录|请登录|登录后(?:查看|可见|才能|浏览)|需要登录|必须登录|账号登录|sign in to|log in to|please (?:log|sign) in|login required|authentication required/i
const NOISE = /^(首页|登录|注册|下一页|上一页|提交|返回|目录|更多|关于|copyright|sign in|log in|login)$/i
const MARKED =
  /^(?:第\s*\d+\s*题\s*[.、:：]?\s*|[(（]\s*\d+\s*[)）]\s*[.、:：]?\s*|\d{1,3}\s*[.、)）]\s+|[一二三四五六七八九十]+\s*[、.]\s*|[-*•]\s+)(.+)$/

export function bankStorageKey(examId: string): string {
  return `qianbei-bank-${examId}`
}

export function fileHint(name: string): ImportHint | null {
  const ext = name.toLowerCase().split(".").pop() ?? ""
  if (ext === "json") return "json"
  if (ext === "csv") return "csv"
  if (ext === "md" || ext === "markdown") return "md"
  if (ext === "html" || ext === "htm") return "html"
  return null
}

export function parseImportedBank(raw: string, hint?: ImportHint): ImportedStem[] {
  const text = raw.replace(/^\uFEFF/, "").slice(0, MAX_INPUT)
  const trimmed = text.trim()
  if (!trimmed) return []
  if (hint === "json") return cap(stemsFromJson(trimmed))
  if (hint === "csv") return cap(stemsFromCsv(trimmed))
  if (hint === "html") return cap(stemsFromHtml(trimmed))
  if (hint === "md") return cap(stemsFromMarkdown(trimmed))

  const json = stemsFromJson(trimmed)
  if (json.length > 0) return cap(json)
  if (looksLikeCsv(trimmed)) {
    const csv = stemsFromCsv(trimmed)
    if (csv.length > 0) return cap(csv)
  }
  if (looksLikeHtml(trimmed)) return cap(stemsFromHtml(trimmed))
  return cap(stemsFromMarkdown(trimmed))
}

/** Public pages only keep lines that read as questions, so a login wall's links are not a bank. */
export function parsePublicPage(raw: string): ImportedStem[] {
  return parseImportedBank(raw).filter((item) => looksLikeQuestion(item.stem) && !isChromePrompt(item.stem))
}

export function gateReason(status: number, body: string): GateReason | null {
  if (status === 401 || status === 403) return "forbidden"
  const visibleHtml = withoutChrome(body)
  const visible = visibleText(body)
  const hasPassword = /type\s*=\s*["']password["']/i.test(visibleHtml) || /<input[^>]+password/i.test(visibleHtml)
  const phrase = LOGIN_PHRASE.test(visible)
  const questions = hasPassword || phrase ? parsePublicPage(body) : []
  const examQuestions = questions.filter((item) => examLike(item.stem))
  if (hasPassword && examQuestions.length === 0) return "login"
  if (phrase && examQuestions.length === 0 && visible.length < 1800) return "login"
  if (visible.length < 40) return "empty"
  return null
}

export interface LoadedPage {
  kind: "http"
  status: number
  body: string
}

export type LoadedDocument = LoadedPage | { kind: "timeout" } | { kind: "unreachable" }

export function resultFromDocument(loaded: LoadedDocument): ImportFetchResult {
  if (loaded.kind === "timeout") return { outcome: "miss", reason: "timeout", questions: [] }
  if (loaded.kind === "unreachable") return { outcome: "miss", reason: "unreachable", questions: [] }
  const gate = gateReason(loaded.status, loaded.body)
  if (gate) return { outcome: "gated", reason: gate, questions: [] }
  if (loaded.status < 200 || loaded.status >= 400) return { outcome: "miss", reason: "none", questions: [] }
  const questions = parsePublicPage(loaded.body)
  if (questions.length === 0) return { outcome: "miss", reason: "none", questions: [] }
  return { outcome: "ok", reason: "ok", questions }
}

export type PageFetch = (url: string, init: { redirect: "manual"; signal: AbortSignal; headers: Record<string, string> }) => Promise<Response>

const MAX_BYTES = 1_000_000
const MAX_HOPS = 3

export async function loadPublicDocument(url: string, fetchPage: PageFetch, timeoutMs = 8000): Promise<LoadedDocument> {
  const first = safePageUrl(url)
  if (!first) return { kind: "unreachable" }
  let current = first
  for (let hop = 0; hop <= MAX_HOPS; hop += 1) {
    let response: Response
    try {
      response = await fetchPage(current, {
        redirect: "manual",
        signal: AbortSignal.timeout(timeoutMs),
        headers: {
          Accept: "text/html,application/xhtml+xml,application/json;q=0.9,text/plain;q=0.8,*/*;q=0.5",
          "User-Agent": "Testpass/0.1",
        },
      })
    } catch (error) {
      const name = error instanceof Error ? error.name : ""
      if (name === "TimeoutError" || name === "AbortError") return { kind: "timeout" }
      return { kind: "unreachable" }
    }
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location")
      if (!location) return { kind: "unreachable" }
      let next: string
      try {
        next = new URL(location, current).toString()
      } catch {
        return { kind: "unreachable" }
      }
      const safe = safePageUrl(next.split("#")[0] ?? next)
      if (!safe) return { kind: "unreachable" }
      current = safe
      continue
    }
    if (response.url) {
      const safeFinal = safePageUrl(response.url.split("#")[0] ?? response.url)
      if (!safeFinal) return { kind: "unreachable" }
    }
    const status = response.status
    const buffer = new Uint8Array(await response.arrayBuffer())
    const sliced = buffer.byteLength > MAX_BYTES ? buffer.slice(0, MAX_BYTES) : buffer
    const probe = new TextDecoder("utf-8", { fatal: false }).decode(sliced.slice(0, 2000))
    const body = decodeDocument(sliced, response.headers.get("content-type") ?? "", probe)
    return { kind: "http", status, body }
  }
  return { kind: "unreachable" }
}

export function parseStoredImports(raw: string | null): StoredImport[] {
  if (!raw) return []
  try {
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.flatMap((item) => {
      if (!item || typeof item !== "object" || Array.isArray(item)) return []
      const row = item as Partial<StoredImport>
      if (row.kind !== "url" && row.kind !== "file" && row.kind !== "paste") return []
      if (typeof row.id !== "string" || typeof row.source !== "string" || typeof row.savedAt !== "string") return []
      const questions = Array.isArray(row.questions)
        ? row.questions.flatMap((question) => {
            if (!question || typeof question !== "object") return []
            const stem = clipStem((question as { stem?: unknown }).stem)
            return stem ? [{ stem }] : []
          })
        : []
      if (questions.length === 0) return []
      return [{ id: row.id, kind: row.kind, source: row.source.slice(0, 500), questions: questions.slice(0, MAX_QUESTIONS), savedAt: row.savedAt }]
    })
  } catch {
    return []
  }
}

export function mergeStoredImport(current: StoredImport[], next: StoredImport): StoredImport[] {
  const questions = next.questions.flatMap((item) => {
    const stem = clipStem(item.stem)
    return stem ? [{ stem }] : []
  })
  if (questions.length === 0) return current.slice(-20)
  const stored: StoredImport = {
    id: next.id,
    kind: next.kind,
    source: next.source.replace(/\s+/g, " ").trim().slice(0, 500),
    questions: questions.slice(0, MAX_QUESTIONS),
    savedAt: next.savedAt,
  }
  return [...current, stored].slice(-20)
}

function cap(items: ImportedStem[]): ImportedStem[] {
  const seen = new Set<string>()
  const kept: ImportedStem[] = []
  for (const item of items) {
    const stem = clipStem(item.stem)
    if (!stem || seen.has(stem)) continue
    seen.add(stem)
    kept.push({ stem })
    if (kept.length === MAX_QUESTIONS) break
  }
  return kept
}

function clipStem(value: unknown): string {
  const flat = String(value ?? "").replace(/\s+/g, " ").trim()
  if (flat.length < MIN_STEM || flat.length > 600) return ""
  const stem = clipText(flat, MAX_STEM)
  if (NOISE.test(stem) || isChromePrompt(stem) || /^https?:\/\//i.test(stem)) return ""
  return stem
}

function stemsFromJson(raw: string): ImportedStem[] {
  const found: string[] = []
  const candidates = [raw.trim()]
  for (const match of raw.matchAll(/```(?:json)?\s*([\s\S]*?)```/g)) {
    if (match[1]) candidates.push(match[1])
  }
  for (const candidate of candidates) {
    try {
      const value: unknown = JSON.parse(candidate)
      walkJson(value, found, 0, null)
    } catch {
      // The next candidate may be fenced JSON inside a longer note.
    }
    if (found.length > 0) break
  }
  return found.map((stem) => ({ stem }))
}

function walkJson(value: unknown, out: string[], depth: number, key: string | null) {
  if (depth > 6 || out.length >= MAX_QUESTIONS) return
  if (Array.isArray(value)) {
    const strings = value.filter((item): item is string => typeof item === "string")
    if (strings.length === value.length && strings.length > 0 && (key === null || LIST_KEYS.has(key))) {
      for (const item of strings) pushStem(out, item)
      return
    }
    for (const item of value) walkJson(item, out, depth + 1, key)
    return
  }
  if (!value || typeof value !== "object") return
  const record = value as Record<string, unknown>
  const stem = stemOf(record)
  if (stem) {
    pushStem(out, stem)
    return
  }
  for (const [childKey, child] of Object.entries(record)) walkJson(child, out, depth + 1, childKey)
}

function stemOf(record: Record<string, unknown>): string | null {
  for (const key of STEM_KEYS) {
    if (typeof record[key] === "string" && record[key].trim()) return record[key]
  }
  if (typeof record.q === "string" && CHOICE_KEYS.some((key) => key in record)) return record.q
  return null
}

function pushStem(out: string[], value: string) {
  const stem = clipStem(value)
  if (!stem || out.includes(stem)) return
  out.push(stem)
}

function looksLikeCsv(text: string): boolean {
  if (text.startsWith("{") || text.startsWith("[") || /<\/?[a-z][\s\S]*>/i.test(text)) return false
  const first = text.split(/\r?\n/).find((line) => line.trim()) ?? ""
  return /[,，\t]/.test(first) && /题干|题目|问题|stem|question|prompt/i.test(first)
}

function stemsFromCsv(raw: string): ImportedStem[] {
  const lines = raw.split(/\r?\n/).filter((line) => line.trim())
  if (lines.length === 0) return []
  const delimiter = delimiterOf(lines[0] ?? "")
  const rows = lines.map((line) => splitDelimited(line, delimiter))
  const header = (rows[0] ?? []).map((cell) => cell.replace(/^\uFEFF/, "").trim().toLowerCase())
  const index = header.findIndex((cell) => ["stem", "question", "prompt", "题干", "题目", "问题"].includes(cell))
  const body = index >= 0 ? rows.slice(1) : rows
  const column = index >= 0 ? index : 0
  return body.flatMap((row) => {
    const stem = clipStem(row[column] ?? "")
    return stem ? [{ stem }] : []
  })
}

function delimiterOf(line: string): "," | "\t" | "，" {
  if (line.includes("\t")) return "\t"
  if (line.includes(",") && !line.includes("，")) return ","
  if (line.includes("，") && !line.includes(",")) return "，"
  return ","
}

function splitDelimited(line: string, delimiter: string): string[] {
  const cells: string[] = []
  let current = ""
  let quoted = false
  for (let index = 0; index < line.length; index += 1) {
    const ch = line[index]
    if (quoted) {
      if (ch === '"') {
        if (line[index + 1] === '"') {
          current += '"'
          index += 1
        } else quoted = false
      } else current += ch ?? ""
      continue
    }
    if (ch === '"') {
      quoted = true
      continue
    }
    if (ch === delimiter) {
      cells.push(current.trim())
      current = ""
      continue
    }
    current += ch ?? ""
  }
  cells.push(current.trim())
  return cells
}

function looksLikeHtml(text: string): boolean {
  return /<\/?[a-z][^>]*>/i.test(text)
}

function stemsFromHtml(html: string): ImportedStem[] {
  const fromScripts = scriptStems(html)
  if (fromScripts.length > 0) return fromScripts
  const cleaned = withoutChrome(html)
  const items = listItems(cleaned)
  const explicit = items.filter((item) => looksLikeQuestion(unwrapMarker(item)) || NUMBERED.test(normalizeLine(item)))
  if (explicit.length > 0) return explicit.map((item) => ({ stem: unwrapMarker(item) }))
  return stemsFromLines(visibleLines(cleaned))
}

function scriptStems(html: string): ImportedStem[] {
  const found: ImportedStem[] = []
  for (const match of html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)) {
    found.push(...stemsFromJson(match[1] ?? ""))
  }
  return found
}

function unwrapMarker(value: string): string {
  const line = normalizeLine(value)
  const match = line.match(MARKED)
  return (match?.[1] ?? line).trim()
}

function stemsFromMarkdown(raw: string): ImportedStem[] {
  const fenced: ImportedStem[] = []
  const body = raw.replace(/```(?:json)?\s*([\s\S]*?)```/g, (_, code: string) => {
    fenced.push(...stemsFromJson(code))
    return "\n"
  })
  if (fenced.length > 0) return fenced
  return stemsFromLines(
    body
      .split(/\n+/)
      .map((line) => line.trim())
      .filter(Boolean),
  )
}

function stemsFromLines(lines: string[]): ImportedStem[] {
  const marked = lines.flatMap((line) => {
    const match = normalizeLine(line).match(MARKED)
    return match?.[1] ? [match[1]] : []
  })
  const chosen = marked.length > 0 ? marked : lines.map(normalizeLine).filter((line) => line.length <= 240 && looksLikeQuestion(line))
  return chosen.flatMap((line) => {
    const stem = clipStem(line)
    return stem ? [{ stem }] : []
  })
}

function normalizeLine(line: string): string {
  return line
    .replace(/^#{1,6}\s+/, "")
    .replace(/\*\*/g, "")
    .replace(/\s+/g, " ")
    .trim()
}

const NUMBERED =
  /^(?:第\s*\d+\s*题\s*[.、:：]?|[(（]\s*\d+\s*[)）]\s*[.、:：]?|\d{1,3}\s*[.、)）]|[一二三四五六七八九十]+\s*[、.])/

function looksLikeQuestion(line: string): boolean {
  if (line.length < MIN_STEM || line.length > 240) return false
  if (/[？?]$/.test(line)) return true
  return /(?:哪一|哪些|什么|为什么|是否|下列|不正确|正确的是|填空|简述|试述)/.test(line)
}

function isChromePrompt(line: string): boolean {
  return /forgot password|sign in to|log in to|create an account|manage cookies|cookie policy|privacy policy|联系我们|忘记密码|创建账户|注册账号|管理 cookie/i.test(line)
}

function examLike(stem: string): boolean {
  if (isChromePrompt(stem)) return false
  if (/(?:哪一|哪些|什么|为什么|是否|下列|不正确|正确的是|填空|简述|试述)/.test(stem)) return true
  if (/[？]$/.test(stem)) return stem.length >= MIN_STEM
  if (/\?$/.test(stem)) return stem.length >= 36
  return false
}

function withoutChrome(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<nav[\s\S]*?<\/nav>/gi, " ")
    .replace(/<footer[\s\S]*?<\/footer>/gi, " ")
    .replace(/<header[\s\S]*?<\/header>/gi, " ")
}

function listItems(html: string): string[] {
  const items: string[] = []
  for (const match of html.matchAll(/<li[^>]*>([\s\S]*?)<\/li>/gi)) {
    const text = stripTags(match[1] ?? "")
    if (text) items.push(text)
  }
  return items
}

function visibleLines(html: string): string[] {
  const broken = html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|h[1-6]|tr|blockquote|dt|dd)>/gi, "\n")
  return stripTags(broken)
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean)
}

function visibleText(html: string): string {
  return stripTags(withoutChrome(html)).replace(/\s+/g, " ").trim()
}

function stripTags(html: string): string {
  return decodeEntities(html.replace(/<[^>]+>/g, " ")).replace(/[ \t]+\n/g, "\n").replace(/[ \t]{2,}/g, " ").trim()
}

function decodeEntities(value: string): string {
  return value
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&#(\d+);/g, (_, digits: string) => safeCodePoint(Number(digits)))
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => safeCodePoint(parseInt(hex, 16)))
}

function safeCodePoint(code: number): string {
  if (!Number.isFinite(code) || code < 0 || code > 0x10ffff) return ""
  try {
    return String.fromCodePoint(code)
  } catch {
    return ""
  }
}

function decodeDocument(bytes: Uint8Array, contentType: string, probe: string): string {
  const charset = (
    /charset=([^;]+)/i.exec(contentType)?.[1] ??
    /charset=["']?([^"'>\s/]+)/i.exec(probe)?.[1] ??
    ""
  )
    .trim()
    .replace(/['"]/g, "")
    .toLowerCase()
  if (charset === "gb2312" || charset === "gbk" || charset === "gb18030") {
    try {
      return new TextDecoder("gbk").decode(bytes)
    } catch {
      return new TextDecoder("utf-8", { fatal: false }).decode(bytes)
    }
  }
  return new TextDecoder("utf-8", { fatal: false }).decode(bytes)
}
