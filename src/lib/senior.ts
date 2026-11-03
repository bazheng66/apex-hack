import { safePageUrl } from "../engine/extract.ts"

export interface TodayVoice {
  kind: "today"
  exam: string
  levelVoice: string
  topic: string
  score: number
  minutes: number
  status: string
  instruction: string
  reason: string
}

export interface ReviewVoice {
  kind: "review"
  exam: string
  items: {
    topic: string
    prompt: string
    chosen: string
    correct: boolean
    note: string
  }[]
}

export interface UploadVoice {
  kind: "upload"
  exam: string
  topic: string
  correct: number
  total: number
  score: number
  mistake: string
  ruleLine: string
}

export interface TalkVoice {
  kind: "talk"
  exam: string
  topic: string
  score: number
  text: string
  history: { role: "user" | "senior"; text: string }[]
}

export interface PastPaper {
  line: string
  source: { title: string; url: string } | null
  questions: { stem: string }[]
}

export interface VisionNote {
  seen: string
  comment: string
}

export type SeniorRequest = TodayVoice | ReviewVoice | UploadVoice | TalkVoice

export async function askSenior(body: SeniorRequest): Promise<string | null> {
  try {
    const response = await fetch("/api/senior", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    })
    if (!response.ok) return null
    const data = (await response.json()) as { line?: unknown }
    return typeof data.line === "string" && data.line.trim() ? data.line.trim() : null
  } catch {
    return null
  }
}

export async function askVision(image: string, exam: string, topic: string, note: string): Promise<VisionNote | null> {
  try {
    const response = await fetch("/api/see", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ image, exam, topic, note }),
    })
    if (!response.ok) return null
    const data = (await response.json()) as { seen?: unknown; comment?: unknown }
    if (typeof data.comment !== "string" || !data.comment.trim()) return null
    const comment = data.comment.trim().slice(0, 400)
    if (!comment || /^data:image\//i.test(comment)) return null
    const seen = typeof data.seen === "string" ? data.seen.trim().slice(0, 240) : ""
    return { seen: /^data:image\//i.test(seen) ? "" : seen, comment }
  } catch {
    return null
  }
}

export async function askPast(exam: string, topic: string): Promise<PastPaper | null> {
  try {
    const response = await fetch("/api/past", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ exam, topic }),
    })
    if (!response.ok) return null
    const data = (await response.json()) as {
      line?: unknown
      source?: { title?: unknown; url?: unknown } | null
      questions?: { stem?: unknown }[]
    }
    const questions = Array.isArray(data.questions)
      ? data.questions.flatMap((item) => {
          if (typeof item?.stem !== "string") return []
          const stem = item.stem.trim().slice(0, 220)
          if (!stem || /^data:image\//i.test(stem)) return []
          return [{ stem }]
        })
      : []
    const url = data.source && typeof data.source.url === "string" ? safePageUrl(data.source.url) : null
    const source =
      url && data.source && typeof data.source.title === "string" ? { title: data.source.title, url } : null
    return {
      line: typeof data.line === "string" ? data.line : "没有抓到可核对的题干。",
      source,
      questions,
    }
  } catch {
    return null
  }
}
