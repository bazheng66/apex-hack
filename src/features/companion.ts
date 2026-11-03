import type { CompanionHint as PlanCompanionHint } from "../algo/plan-view.ts"

/** Read-only companion copy. Scoring stays in the engine. */
export type CompanionHint = PlanCompanionHint

/** Confirmed lines. Do not paraphrase. */
export const COMPANION_LINE: Record<CompanionHint, string> = {
  encourage: "今天这几道，先轻松拿下～",
  urge: "这块有点紧，再刷几道就稳了",
  celebrate: "漂亮！连胜续上了",
  sleepy: "今天先歇会儿，计划已帮你收短",
}

export const HINT_LABEL: Record<CompanionHint, string> = {
  encourage: "鼓励",
  urge: "着急",
  celebrate: "庆祝",
  sleepy: "困了",
}

export const COMPANION_HINTS: readonly CompanionHint[] = ["encourage", "urge", "celebrate", "sleepy"]

export type CopyKey =
  | "plan_lowest"
  | "plan_trim"
  | "plan_shrink"
  | "plan_switched"
  | "good_progress"
  | "tough_miss"
  | "review_due_tomorrow"
  | "streak_up"
  | "streak_broke"
  | "shortened_ok"
  | "shortened_stop"
  | "uncalibrated_band"
  | "calibrated_on_track"
  | "calibrated_behind"
  | "day_done"
  | "day_skipped"
  | "all_open_questions_done"

/** Unknown copy_keys use this. Never throw. */
export const COPY_FALLBACK = "按今天这一步来就好。"

export const COPY: Record<CopyKey, string> = {
  plan_lowest: "今天只排最低的一块。",
  plan_trim: "昨天没做完，今天先收短一点。",
  plan_shrink: "今天做不动，任务已经收到最小。",
  plan_switched: "专项改到现在更低的一块。",
  good_progress: "这几道做对了，往前走了一点。",
  tough_miss: "这道没稳住，回头再看一眼。",
  review_due_tomorrow: "明天有一题该再见面。",
  streak_up: "连胜又多了一天。",
  streak_broke: "连胜断了，今天可以重新记上。",
  shortened_ok: "计划已收短，还留着最小的一问。",
  shortened_stop: "今天先停，不再加新任务。",
  uncalibrated_band: "校准还没完成，先不给单点通过率。",
  calibrated_on_track: "校准之后，通过区间还在目标里。",
  calibrated_behind: "校准之后，通过区间偏后。",
  day_done: "今天的专项做完了。",
  day_skipped: "今天的专项先放下了。",
  all_open_questions_done: "这一场的开放题都做完了。",
}

const COPY_ORDER: readonly CopyKey[] = [
  "plan_lowest",
  "plan_trim",
  "plan_shrink",
  "plan_switched",
  "good_progress",
  "tough_miss",
  "review_due_tomorrow",
  "streak_up",
  "streak_broke",
  "shortened_ok",
  "shortened_stop",
  "uncalibrated_band",
  "calibrated_on_track",
  "calibrated_behind",
  "day_done",
  "day_skipped",
  "all_open_questions_done",
]

export function isCompanionHint(value: string | null | undefined): value is CompanionHint {
  return !!value && (COMPANION_HINTS as readonly string[]).includes(value)
}

export function isCopyKey(value: string): value is CopyKey {
  return Object.prototype.hasOwnProperty.call(COPY, value)
}

export function copyLine(key: string): string {
  return isCopyKey(key) ? COPY[key] : COPY_FALLBACK
}

/** Known keys stay in contract order. Unknown keys collapse to one fallback later. */
export function normalizeCopyKeys(keys: readonly string[]): string[] {
  const known = new Set<string>()
  const unknown: string[] = []
  for (const key of keys) {
    if (isCopyKey(key)) known.add(key)
    else if (!unknown.includes(key)) unknown.push(key)
  }
  return [...COPY_ORDER.filter((key) => known.has(key)), ...unknown]
}

export function copyLines(keys: readonly string[]): string[] {
  const lines: string[] = []
  const seen = new Set<string>()
  let usedFallback = false
  for (const key of normalizeCopyKeys(keys)) {
    if (!isCopyKey(key)) {
      if (usedFallback) continue
      usedFallback = true
      lines.push(COPY_FALLBACK)
      continue
    }
    const line = COPY[key]
    if (seen.has(line)) continue
    seen.add(line)
    lines.push(line)
  }
  return lines
}

/**
 * Review override. `/today?hint=urge` (encourage | urge | celebrate | sleepy)
 * changes only the companion state. Scores stay on the record.
 */
export function hintFromSearch(search: string): CompanionHint | null {
  const query = search.startsWith("?") ? search.slice(1) : search
  const value = new URLSearchParams(query).get("hint")
  return isCompanionHint(value) ? value : null
}

export function presentHint(derived: CompanionHint, search: string): { hint: CompanionHint; forced: boolean } {
  const override = hintFromSearch(search)
  if (!override) return { hint: derived, forced: false }
  return { hint: override, forced: true }
}
