import { rollTo } from "../engine/agent.ts"
import { abilityFromScore } from "../engine/model.ts"
import type { RecordState } from "../engine/types.ts"
import { todayKey } from "./day.ts"

const KEY = "qianbei-record-v1"

function isScoredTopicList(value: unknown): boolean {
  if (!Array.isArray(value)) return false
  return value.every((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return false
    const row = item as { topicId?: unknown; score?: unknown }
    return typeof row.topicId === "string" && typeof row.score === "number" && Number.isFinite(row.score)
  })
}

function isDaily(value: unknown): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false
  const daily = value as { date?: unknown; status?: unknown; topicId?: unknown }
  return (
    typeof daily.date === "string" &&
    (daily.status === "open" || daily.status === "done" || daily.status === "skipped") &&
    typeof daily.topicId === "string"
  )
}

function isSession(value: unknown): boolean {
  if (!value || typeof value !== "object") return false
  const row = value as Record<string, unknown>
  return typeof row.id === "string" && typeof row.date === "string" && typeof row.topicId === "string" &&
    ["drill-done", "drill-shrink", "drill-skip", "mock", "upload"].includes(String(row.kind)) &&
    typeof row.detail === "string" && typeof row.scoreBefore === "number" && Number.isFinite(row.scoreBefore) &&
    typeof row.scoreAfter === "number" && Number.isFinite(row.scoreAfter)
}

export function readable(value: unknown): value is RecordState {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false
  const state = value as Partial<RecordState>
  return (state.examId === "os" || state.examId === "network" || state.examId === "ds") &&
    ["start", "basic", "uneven", "polish"].includes(state.level ?? "") && Array.isArray(state.sessions) && state.sessions.every(isSession) &&
    Array.isArray(state.answeredIds) && isScoredTopicList(state.mastery) && isScoredTopicList(state.baseline) && isDaily(state.daily)
}

export function loadRecord(): RecordState | null {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return null
    const parsed: unknown = JSON.parse(raw)
    if (!readable(parsed)) return null
    const seeded = Array.isArray(parsed.abilities)
      ? parsed
      : { ...parsed, abilities: parsed.mastery.map((item) => abilityFromScore(item.topicId, item.score)) }
    return rollTo(seeded, todayKey())
  } catch {
    return null
  }
}

export function saveRecord(state: RecordState | null) {
  if (!state) {
    localStorage.removeItem(KEY)
    return
  }
  localStorage.setItem(KEY, JSON.stringify(state))
}
