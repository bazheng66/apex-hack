/**
 * Local stand-in for the read-only algo display contract.
 * Plan `companion_hint` / `companionHint` comes from the algo plan when that
 * field is present. The local hint is only the fallback.
 * These functions do not write scores.
 *
 * Force a state in the UI with `?hint=encourage|urge|celebrate|sleepy`.
 */
import { companionHint, planDraft } from "../algo/plan-view.ts"
import { nextPaper, scoreOf, shiftDate } from "../engine/agent.ts"
import { topicById } from "../engine/catalog.ts"
import type { RecordState } from "../engine/types.ts"
import { COPY, isCompanionHint, normalizeCopyKeys, type CompanionHint } from "./companion.ts"
import { bestStreak, currentStreak, dayCounted, lastActiveDate } from "./streak.ts"

const FULL_TARGET = 4

export interface PlanItemView {
  topic_id: string
  topic_name: string
  target_n: number
  done_n: number
  reason: "high_weight_low_mastery" | "due_review" | "calibration" | "weak_streak"
  p_mastery: number
  forget_urgency: number
  next_due_at: string | null
}

export interface DailyPlanView {
  plan_date: string
  exam_id: string
  capacity: number
  shortened: boolean
  shorten_reason: string | null
  items: PlanItemView[]
  companion_hint: CompanionHint
  copy_keys: string[]
}

export interface StreakView {
  current: number
  best: number
  last_active_date: string | null
  timezone: string
  rules: string
}

export interface MasteryDeltaView {
  topic_id: string
  before: number
  after: number
}

export interface PassForecastView {
  available: boolean
  pass_p_low: number | null
  pass_p_high: number | null
  message: string
}

export interface SessionSubmitView {
  session_id: string
  correct_n: number
  total_n: number
  delta_mastery: MasteryDeltaView[]
  streak: { current: number; best: number; broke: boolean }
  calibrated: boolean
  pass_forecast: PassForecastView
  companion_hint: CompanionHint
  copy_keys: string[]
}

export const STREAK_RULES = "专项做完、模拟交卷、自交记入各算一天。缩短和放下不计。"

/** Read `companion_hint` or `companionHint`. Unknown values are ignored. */
export function readCompanionHint(source: unknown): CompanionHint | null {
  if (!source || typeof source !== "object") return null
  const record = source as { companion_hint?: unknown; companionHint?: unknown }
  const value = record.companion_hint ?? record.companionHint
  return typeof value === "string" && isCompanionHint(value) ? value : null
}

/** Official plan hint. Used only when a plan or API payload has no hint field. */
export function hintForDaily(state: Pick<RecordState, "daily">): CompanionHint {
  return companionHint(state.daily)
}

export function hintForSubmit(input: {
  beforeStreak: number
  afterStreak: number
  correctN: number
  totalN: number
}): CompanionHint {
  if (input.afterStreak > input.beforeStreak) return "celebrate"
  if (input.totalN > 0 && input.correctN * 2 < input.totalN) return "urge"
  return "encourage"
}

function targetCount(minutes: number): number {
  if (minutes <= 12) return FULL_TARGET / 2
  if (minutes <= 18) return 3
  return FULL_TARGET
}

function masteryP(score: number): number {
  const clamped = Math.min(100, Math.max(0, score))
  return Math.round(clamped) / 100
}

function cardDue(state: RecordState, topicId: string, today: string): boolean {
  return (state.cards ?? []).some((card) => card.topicId === topicId && card.due <= today)
}

function nextDueAt(state: RecordState, topicId: string): string | null {
  const dates = (state.cards ?? [])
    .filter((card) => card.topicId === topicId)
    .map((card) => card.due)
    .sort()
  return dates[0] ?? null
}

function forgetUrgency(state: RecordState, topicId: string, today: string): number {
  if (cardDue(state, topicId, today)) return 0.85
  if (state.skipStreak >= 2) return 0.7
  if (state.skipStreak === 1) return 0.45
  const score = scoreOf(state.mastery, topicId)
  return Math.round((1 - score / 100) * 35) / 100
}

function itemReason(state: RecordState, topicId: string, today: string): PlanItemView["reason"] {
  if (state.skipStreak > 0 || state.daily.ruleId !== "LOWEST_TOPIC") return "weak_streak"
  if (cardDue(state, topicId, today)) return "due_review"
  return "high_weight_low_mastery"
}

function planCopyKeys(state: RecordState, today: string): string[] {
  const keys: string[] = []
  const daily = state.daily
  if (daily.ruleId === "LOWEST_TOPIC") keys.push("plan_lowest")
  if (daily.ruleId === "SKIP_TRIM") keys.push("plan_trim")
  if (daily.ruleId === "SKIP_SHRINK" && daily.status === "open") {
    keys.push("plan_shrink")
    keys.push("shortened_ok")
  }
  if (daily.status === "done") {
    keys.push("day_done")
    if (dayCounted(state.sessions, today)) keys.push("streak_up")
  }
  if (daily.status === "skipped") {
    keys.push("shortened_stop")
    keys.push("day_skipped")
  }
  if (daily.status !== "done" && currentStreak(state.sessions, today) === 0 && lastActiveDate(state.sessions)) {
    keys.push("streak_broke")
  }
  const tomorrow = shiftDate(today, 1)
  if ((state.cards ?? []).some((card) => card.due === tomorrow)) keys.push("review_due_tomorrow")
  return normalizeCopyKeys(keys)
}

export function mockDailyPlan(state: RecordState, today: string, upstream?: unknown): DailyPlanView {
  const daily = state.daily
  const topic = topicById(state.examId, daily.topicId)
  const target = targetCount(daily.minutes)
  const shortened = daily.status === "skipped" || daily.ruleId === "SKIP_SHRINK"
  const realPlan = planDraft(daily)
  return {
    plan_date: daily.date,
    exam_id: state.examId,
    capacity: daily.minutes,
    shortened,
    shorten_reason: shortened
      ? daily.status === "skipped"
        ? "再次缩短，今天不再加任务"
        : "首次缩短，收到 12 分钟"
      : null,
    items: [
      {
        topic_id: topic.id,
        topic_name: topic.name,
        target_n: target,
        done_n: daily.status === "done" ? target : 0,
        reason: itemReason(state, topic.id, today),
        p_mastery: masteryP(scoreOf(state.mastery, topic.id)),
        forget_urgency: forgetUrgency(state, topic.id, today),
        next_due_at: nextDueAt(state, topic.id),
      },
    ],
    companion_hint: readCompanionHint(upstream) ?? readCompanionHint(realPlan) ?? hintForDaily(state),
    copy_keys: planCopyKeys(state, today),
  }
}

export function mockStreak(state: Pick<RecordState, "sessions">, today: string): StreakView {
  const current = currentStreak(state.sessions, today)
  return {
    current,
    best: Math.max(bestStreak(state.sessions), current),
    last_active_date: lastActiveDate(state.sessions),
    timezone: "Asia/Shanghai",
    rules: STREAK_RULES,
  }
}

export function masteryDeltas(
  items: readonly { topicId: string; before: number; after: number }[],
): MasteryDeltaView[] {
  const map = new Map<string, { before: number; after: number }>()
  for (const item of items) {
    const existing = map.get(item.topicId)
    if (!existing) map.set(item.topicId, { before: item.before, after: item.after })
    else existing.after = item.after
  }
  return [...map].map(([topic_id, value]) => ({ topic_id, before: value.before, after: value.after }))
}

function unavailableForecast(): PassForecastView {
  return {
    available: false,
    pass_p_low: null,
    pass_p_high: null,
    message: COPY.uncalibrated_band,
  }
}

export function mockSessionSubmit(input: {
  before: RecordState
  after: RecordState
  today: string
  sessionId: string
  correctN: number
  totalN: number
  deltas: readonly { topicId: string; before: number; after: number }[]
  upstream?: unknown
}): SessionSubmitView {
  const beforeStreak = currentStreak(input.before.sessions, input.today)
  const afterStreak = currentStreak(input.after.sessions, input.today)
  const broke = beforeStreak > 0 && afterStreak < beforeStreak
  const keys: string[] = []
  if (input.totalN > 0 && input.correctN > 0 && input.correctN * 2 >= input.totalN) keys.push("good_progress")
  if (input.totalN > 0 && input.correctN < input.totalN) keys.push("tough_miss")
  if (afterStreak > beforeStreak) keys.push("streak_up")
  if (broke) keys.push("streak_broke")
  const tomorrow = shiftDate(input.today, 1)
  const alreadyDue = new Set(
    (input.before.cards ?? []).filter((card) => card.due === tomorrow).map((card) => card.id),
  )
  if ((input.after.cards ?? []).some((card) => card.due === tomorrow && !alreadyDue.has(card.id))) {
    keys.push("review_due_tomorrow")
  }
  keys.push("uncalibrated_band")
  if (input.before.daily.status === "open" && input.before.daily.topicId !== input.after.daily.topicId) {
    keys.push("plan_switched")
  }
  if (nextPaper(input.after).length === 0) keys.push("all_open_questions_done")
  if (input.after.daily.status === "done") keys.push("day_done")
  if (input.after.daily.status === "skipped") keys.push("day_skipped")
  return {
    session_id: input.sessionId,
    correct_n: input.correctN,
    total_n: input.totalN,
    delta_mastery: masteryDeltas(input.deltas),
    streak: { current: afterStreak, best: Math.max(bestStreak(input.after.sessions), afterStreak), broke },
    calibrated: false,
    pass_forecast: unavailableForecast(),
    companion_hint:
      readCompanionHint(input.upstream) ??
      hintForSubmit({
        beforeStreak,
        afterStreak,
        correctN: input.correctN,
        totalN: input.totalN,
      }),
    copy_keys: normalizeCopyKeys(keys),
  }
}

/** A band only. A single pass rate stays hidden, including before calibration. */
export function forecastRange(forecast: PassForecastView): string | null {
  if (!forecast.available || forecast.pass_p_low == null || forecast.pass_p_high == null) return null
  if (forecast.pass_p_low >= forecast.pass_p_high) return null
  const low = Math.round(forecast.pass_p_low * 100)
  const high = Math.round(forecast.pass_p_high * 100)
  return `通过区间 ${low}%–${high}%`
}

export function submitSummary(view: Pick<SessionSubmitView, "correct_n" | "total_n" | "streak">): string {
  const ratio = `${view.correct_n}/${view.total_n}`
  if (view.streak.broke) return `${ratio} · 连胜中断`
  if (view.streak.current > 0) return `${ratio} · 连续 ${view.streak.current} 天`
  return ratio
}
