import { safePageUrl } from "../engine/extract.ts"

export const OPENING_TEXT = "把题拍给我，或让我去公开页面上找一道能核对出处的真题。"
export const UNWRITTEN = "这句话没有写成。分数没有动。"
export const UNREAD = "这张图我没有看清。换一张更正的，或把题干打在下面。"
export const UNFETCHED = "真题页面暂时没有抓到。"
export const NO_STEM = "这次没有抽到能核对的题干。"
export const TEXT_NOT_SENT = "这句话没有送出去。分数没有动。"
export const IMAGE_NOT_SEEN = "这张图没有看成。分数没有动。"
export const PAST_NOT_FETCHED = "真题没有取回来。分数没有动。"

export interface TalkSource {
  title: string
  url: string
}

export interface TalkTurn {
  id: string
  role: "senior" | "user"
  text: string
  image?: string
  seen?: string
  source?: TalkSource
  questions?: { stem: string }[]
  topicId?: string
  recorded?: boolean
  recordedStems?: string[]
}

export interface PastDraft {
  line: string
  source: TalkSource | null
  questions: { stem: string }[]
}

export type WaitKind = "text" | "image" | "past"

export function sendFailure(kind: WaitKind): string {
  if (kind === "image") return IMAGE_NOT_SEEN
  if (kind === "past") return PAST_NOT_FETCHED
  return TEXT_NOT_SENT
}

export function storageKey(examId: string) {
  return `qianbei-talk-${examId}`
}

export function openingTurn(): TalkTurn {
  return { id: "open", role: "senior", text: OPENING_TEXT }
}

export function waitingCopy(kind: WaitKind): string {
  if (kind === "image") return "在看这张卷面。"
  if (kind === "past") return "在公开页面上找题干。"
  return "在看你这句话。"
}

export function imageFileError(file: { type: string; size: number }): string | null {
  if (!["image/jpeg", "image/png", "image/gif", "image/webp"].includes(file.type)) return "只收 JPEG、PNG、GIF、WebP。"
  if (file.size > 4 * 1024 * 1024) return "图片请小于 4MB。"
  return null
}

export function lineWhenNoStem(line: string): string {
  const text = line.replace(/\s+/g, " ").trim()
  if (text && /没有|没能|没抓|看不清|暂时没/.test(text)) return text
  return NO_STEM
}

export function visionTurn(id: string, note: { seen: string; comment: string } | null): TalkTurn {
  const comment = typeof note?.comment === "string" ? boundedCopy(note.comment, 400) : ""
  if (!comment) return { id, role: "senior", text: UNREAD }
  const seen = typeof note?.seen === "string" ? boundedCopy(note.seen, 240) : ""
  return seen ? { id, role: "senior", text: comment, seen } : { id, role: "senior", text: comment }
}

export function pastTurn(id: string, topicId: string, paper: PastDraft | null): TalkTurn {
  if (!paper) return { id, role: "senior", text: UNFETCHED }
  const incoming = Array.isArray(paper.questions) ? paper.questions : []
  const questions = incoming.flatMap((item) => {
    if (!item || typeof item.stem !== "string") return []
    const stem = boundedCopy(item.stem, 220)
    return stem ? [{ stem }] : []
  })
  if (questions.length === 0) return { id, role: "senior", text: lineWhenNoStem(paper.line) }
  const source = readSource(paper.source)
  const text = paper.line.trim() || "这是从公开页面上抽到的题干。点开出处核对。"
  return source ? { id, role: "senior", text, source, questions, topicId } : { id, role: "senior", text, questions, topicId }
}

export function stemRecorded(turn: TalkTurn, stem: string): boolean {
  return turn.recorded === true || (turn.recordedStems?.includes(stem) ?? false)
}

export function withStemRecorded(turn: TalkTurn, stem: string): TalkTurn {
  if (stemRecorded(turn, stem)) return turn
  return { ...turn, recordedStems: [...(turn.recordedStems ?? []), stem] }
}

export function priorHistory(items: TalkTurn[]): { role: "user" | "senior"; text: string }[] {
  return items.slice(-6).map((item) => ({ role: item.role, text: storedText(item.text) }))
}

export function turnsForStorage(items: TalkTurn[]): TalkTurn[] {
  return items.slice(-24).map((item) => {
    const stored: TalkTurn = { ...item, text: storedText(item.text) }
    delete stored.image
    if (stored.seen) {
      const seen = boundedCopy(stored.seen, 240)
      if (seen) stored.seen = seen
      else delete stored.seen
    }
    if (stored.questions) {
      const questions = stored.questions.flatMap((question) => {
        const stem = typeof question.stem === "string" ? boundedCopy(question.stem, 220) : ""
        return stem ? [{ stem }] : []
      })
      if (questions.length > 0) stored.questions = questions
      else delete stored.questions
    }
    return stored
  })
}

function storedText(text: string): string {
  if (/^data:image\/(?:jpeg|png|gif|webp);base64,/i.test(text.trim())) return ""
  return text
}

function boundedCopy(text: string, max: number): string {
  const trimmed = text.trim().slice(0, max)
  if (/^data:image\//i.test(trimmed)) return ""
  return trimmed
}

export function readStoredTurns(raw: string | null): TalkTurn[] {
  if (!raw) return [openingTurn()]
  try {
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return [openingTurn()]
    const turns = parsed.flatMap((item) => normalizeTurn(item))
    return turns.length > 0 ? turns : [openingTurn()]
  } catch {
    return [openingTurn()]
  }
}

function readSource(value: unknown): TalkSource | undefined {
  if (!value || typeof value !== "object") return undefined
  const row = value as { title?: unknown; url?: unknown }
  if (typeof row.url !== "string") return undefined
  const url = safePageUrl(row.url)
  if (!url) return undefined
  const title = typeof row.title === "string" ? row.title.trim() : ""
  return { title: title || "来源页面", url }
}

function normalizeTurn(item: unknown): TalkTurn[] {
  if (!item || typeof item !== "object") return []
  const row = item as Partial<TalkTurn>
  if ((row.role !== "senior" && row.role !== "user") || typeof row.text !== "string" || typeof row.id !== "string") return []
  const questions = Array.isArray(row.questions)
    ? row.questions.flatMap((question) => {
        if (!question || typeof question !== "object") return []
        const stem = (question as { stem?: unknown }).stem
        if (typeof stem !== "string") return []
        const clean = boundedCopy(stem, 220)
        return clean ? [{ stem: clean }] : []
      })
    : []
  const recordedStems = Array.isArray(row.recordedStems)
    ? row.recordedStems.filter((stem): stem is string => typeof stem === "string" && stem.trim().length > 0)
    : []
  const seen = typeof row.seen === "string" ? boundedCopy(row.seen, 240) : ""
  const turn: TalkTurn = { id: row.id, role: row.role, text: storedText(row.text) }
  if (seen) turn.seen = seen
  const source = readSource(row.source)
  if (source) turn.source = source
  if (questions.length > 0) turn.questions = questions
  if (typeof row.topicId === "string" && row.topicId) turn.topicId = row.topicId
  if (row.recorded === true) turn.recorded = true
  if (recordedStems.length > 0) turn.recordedStems = recordedStems
  return [turn]
}
