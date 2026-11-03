/**
 * ScraplingParser is the public-URL parser port.
 * Scrapling itself is a Python fetcher and does not run inside this Node/Vercel
 * function. NodeScraplingAdapter keeps the item contract (prompt, choices,
 * stable external_key). import_jobs.parser stays "scrapling"; stats.parser_impl
 * records this adapter.
 */
import { createHash } from "node:crypto"
import { parsePublicPage } from "../../src/engine/import-bank.js"

export const SCRAPLING_IMPL = "node-html-adapter"
const MAX_ITEMS = 80
const MIN_PROMPT = 8
const MAX_PROMPT = 480
const MAX_CHOICE = 200
const MAX_CHOICES = 8

const STEM_KEYS = ["stem", "question", "prompt", "题干", "题目", "问题", "q"]
const CHOICE_KEYS = ["options", "choices", "选项"]
const ANSWER_KEYS = ["answer", "answer_text", "答案"]
const ANSWER_INDEX_KEYS = ["answer_index", "answerindex"]
const SKIP_KEYS = new Set(["cookie", "cookies", "authorization", "storagestate", "setcookie", "headers"])

export interface ScraplingParsedItem {
  external_key: string
  kind: "mcq" | "short" | "unknown"
  prompt: string
  choices: string[] | null
  answer_index: number | null
  answer_text: string | null
}

export interface ScraplingDocument {
  url: string
  contentType: string
  body: string
}

export interface ScraplingParseResult {
  items: ScraplingParsedItem[]
  seen: number
  truncated: boolean
}

export interface ScraplingParser {
  readonly id: "scrapling"
  readonly impl: string
  parse(document: ScraplingDocument): ScraplingParseResult
}

export function createNodeScraplingParser(): ScraplingParser {
  return {
    id: "scrapling",
    impl: SCRAPLING_IMPL,
    parse: parseWithNodeScrapling,
  }
}

export function parseWithNodeScrapling(document: ScraplingDocument): ScraplingParseResult {
  const found: ScraplingParsedItem[] = []
  const seen = new Set<string>()
  const push = (item: ScraplingParsedItem | null) => {
    if (!item || seen.has(item.external_key)) return
    seen.add(item.external_key)
    found.push(item)
  }
  collectStructured(document.body, push)
  const withoutScripts = document.body.replace(/<script[\s\S]*?<\/script>/gi, " ")
  for (const stem of parsePublicPage(withoutScripts)) {
    push(itemFromPrompt(stem.stem, null, null, null))
  }
  return {
    items: found.slice(0, MAX_ITEMS),
    seen: found.length,
    truncated: found.length > MAX_ITEMS,
  }
}

export function pageTitle(body: string, pageUrl: string): string {
  const match = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(body)
  const fromTag = match ? decodeEntities(stripTags(match[1] ?? "")).replace(/\s+/g, " ").trim() : ""
  if (fromTag) return fromTag.slice(0, 180)
  try {
    return new URL(pageUrl).hostname.replace(/\.+$/, "").slice(0, 180) || "public page"
  } catch {
    return "public page"
  }
}

export function externalKeyFor(prompt: string): string {
  const normalized = prompt.normalize("NFKC").replace(/\s+/g, " ").trim().toLowerCase()
  return `q_${createHash("sha256").update(normalized).digest("hex").slice(0, 40)}`
}

function collectStructured(body: string, push: (item: ScraplingParsedItem | null) => void) {
  const candidates = [body.trim()]
  for (const match of body.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
    const attrs = match[1] ?? ""
    const type = /type\s*=\s*["']([^"']+)["']/i.exec(attrs)?.[1] ?? ""
    if (type && !/json/i.test(type)) continue
    if (match[2]) candidates.push(match[2])
  }
  for (const match of body.matchAll(/```(?:json)?\s*([\s\S]*?)```/g)) {
    if (match[1]) candidates.push(match[1])
  }
  for (const candidate of candidates) {
    try {
      walk(JSON.parse(candidate) as unknown, push, 0)
    } catch {
      // The next candidate may be HTML or a fenced block.
    }
  }
}

function walk(value: unknown, push: (item: ScraplingParsedItem | null) => void, depth: number) {
  if (depth > 6) return
  if (Array.isArray(value)) {
    for (const item of value) walk(item, push, depth + 1)
    return
  }
  if (!value || typeof value !== "object") return
  const record = value as Record<string, unknown>
  const prompt = stemOf(record)
  if (prompt) {
    const choices = choicesOf(record)
    const answer = answerOf(record, choices)
    push(itemFromPrompt(prompt, choices, answer.answer_index, answer.answer_text))
    return
  }
  for (const [key, child] of Object.entries(record)) {
    if (SKIP_KEYS.has(key.toLowerCase().replace(/[_-]/g, ""))) continue
    walk(child, push, depth + 1)
  }
}

function stemOf(record: Record<string, unknown>): string | null {
  for (const key of STEM_KEYS) {
    const value = record[key]
    if (typeof value === "string" && value.trim()) {
      if (key === "q" && !CHOICE_KEYS.some((choice) => choice in record)) continue
      return value
    }
  }
  return null
}

function choicesOf(record: Record<string, unknown>): string[] | null {
  for (const key of CHOICE_KEYS) {
    const value = record[key]
    if (!Array.isArray(value)) continue
    const choices = value.flatMap((item) => {
      if (typeof item === "string") return clipChoice(item)
      if (!item || typeof item !== "object") return []
      const row = item as Record<string, unknown>
      const text = row.text ?? row.label ?? row.value ?? row.option
      return typeof text === "string" ? clipChoice(text) : []
    })
    return choices.length > 0 ? choices.slice(0, MAX_CHOICES) : null
  }
  return null
}

function answerOf(record: Record<string, unknown>, choices: string[] | null): { answer_index: number | null; answer_text: string | null } {
  for (const key of ANSWER_INDEX_KEYS) {
    const value = record[key]
    if (typeof value === "number" && Number.isInteger(value) && value >= 0 && (!choices || value < choices.length)) {
      return { answer_index: value, answer_text: choices?.[value] ?? null }
    }
  }
  for (const key of ANSWER_KEYS) {
    const value = record[key]
    if (typeof value === "number" && Number.isInteger(value) && value >= 0 && choices && value < choices.length) {
      return { answer_index: value, answer_text: choices[value] ?? null }
    }
    if (typeof value !== "string") continue
    const text = value.replace(/\s+/g, " ").trim()
    if (!text || text.length > MAX_CHOICE) continue
    const letter = /^([A-Ha-h])$/.exec(text)
    if (letter && choices) {
      const index = (letter[1] ?? "A").toUpperCase().charCodeAt(0) - 65
      if (index >= 0 && index < choices.length) return { answer_index: index, answer_text: choices[index] ?? null }
    }
    const index = choices?.findIndex((choice) => choice === text) ?? -1
    if (index >= 0) return { answer_index: index, answer_text: text }
    return { answer_index: null, answer_text: text }
  }
  return { answer_index: null, answer_text: null }
}

function itemFromPrompt(
  raw: string,
  choices: string[] | null,
  answerIndex: number | null,
  answerText: string | null,
): ScraplingParsedItem | null {
  const prompt = clipPrompt(raw)
  if (!prompt) return null
  const usable = choices && choices.length >= 2 ? choices : null
  const index = usable && answerIndex !== null && answerIndex < usable.length ? answerIndex : null
  return {
    external_key: externalKeyFor(prompt),
    kind: usable ? "mcq" : "short",
    prompt,
    choices: usable,
    answer_index: index,
    answer_text: answerText,
  }
}

function clipPrompt(value: string): string {
  const flat = decodeEntities(stripTags(value)).replace(/\s+/g, " ").trim()
  if (flat.length < MIN_PROMPT || flat.length > 600) return ""
  if (/^(首页|登录|注册|下一页|上一页|提交|返回|目录|更多|关于|copyright|sign in|log in|login)$/i.test(flat)) return ""
  if (/^https?:\/\//i.test(flat)) return ""
  return flat.slice(0, MAX_PROMPT)
}

function clipChoice(value: string): string[] {
  const flat = decodeEntities(stripTags(value)).replace(/\s+/g, " ").trim().slice(0, MAX_CHOICE)
  return flat ? [flat] : []
}

function stripTags(value: string): string {
  return value.replace(/<[^>]+>/g, " ")
}

function decodeEntities(value: string): string {
  return value
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
}
