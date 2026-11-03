import { abilityFromScore } from "../engine/model.ts"
import { hasExamEvidence, type AttemptEvent, type SourcePaper } from "./events.ts"
import { buildForecast, type ForecastDraft } from "./forecast.ts"
import { planDraft, type PlanDraft } from "./plan-view.ts"
import { ALGO_VERSION } from "./version.ts"
import { planAssignment, scoreOf, shrinkDaily, type PlanTopic } from "../engine/plan.ts"
import {
  applyTopicAbility,
  clampScore,
  DRILL_DONE_DELTA,
  itemScoreDelta,
  uploadCountsAsHit,
  uploadScoreDelta,
} from "../engine/score.ts"
import type { Ability, Daily, Goal, Mastery, Session } from "../engine/types.ts"

export interface TopicStateDraft {
  topicId: string
  score: number
  rating: number
  uncertainty: number
  nCorrect: number
  nWrong: number
  lastSeenAt: string | null
}

export interface DerivedState {
  algoVersion: typeof ALGO_VERSION
  /** `local` is the untouched RecordState projection. `replay` was rebuilt from attempts. */
  source: "local" | "replay"
  mastery: Mastery[]
  abilities: Ability[]
  skipStreak: number
  plan: PlanDraft | null
  forecast: ForecastDraft
  topics: TopicStateDraft[]
}

export interface ReplayInput {
  topics: readonly PlanTopic[]
  baseline: readonly Mastery[]
  attempts: readonly AttemptEvent[]
  today: string
  goal?: Goal | null
  sources?: readonly SourcePaper[]
}

interface ScoreDelta {
  date: string
  topicId: string
  scoreBefore: number
  scoreAfter: number
}

interface TopicTally {
  nCorrect: number
  nWrong: number
  lastSeenAt: string | null
}

interface Cursor {
  mastery: Mastery[]
  abilities: Ability[]
  skipStreak: number
  daily: Daily | null
  /** Days that already recorded a shrink or skip, so a later roll does not count them twice. */
  skipMarks: Set<string>
  deltas: ScoreDelta[]
  tallies: Map<string, TopicTally>
}

function tallyFor(cursor: Cursor, topicId: string): TopicTally {
  const existing = cursor.tallies.get(topicId)
  if (existing) return existing
  const created = { nCorrect: 0, nWrong: 0, lastSeenAt: null }
  cursor.tallies.set(topicId, created)
  return created
}

function see(cursor: Cursor, topicId: string, occurredAt: string) {
  tallyFor(cursor, topicId).lastSeenAt = occurredAt
}

function replaceScore(mastery: Mastery[], topicId: string, score: number): Mastery[] | null {
  if (!mastery.some((item) => item.topicId === topicId)) return null
  return mastery.map((item) => (item.topicId === topicId ? { ...item, score: clampScore(score) } : item))
}

function pushDelta(cursor: Cursor, date: string, topicId: string, scoreBefore: number, scoreAfter: number) {
  cursor.deltas.push({ date, topicId, scoreBefore, scoreAfter })
}

function openPlan(cursor: Cursor, topics: readonly PlanTopic[], date: string): Daily {
  return planAssignment({
    topics,
    mastery: cursor.mastery,
    skipStreak: cursor.skipStreak,
    date,
  })
}

/**
 * Move the open plan forward the way rollTo does: one missed open day counts
 * as a single skip, and only when that day has no shrink/skip event yet.
 * A profile created locally with no attempts is not invented here — the first
 * attempt's local_day is the first day replay knows about.
 */
function rollToDay(cursor: Cursor, topics: readonly PlanTopic[], day: string) {
  if (topics.length === 0) return
  if (!cursor.daily) {
    cursor.daily = openPlan(cursor, topics, day)
    return
  }
  if (day <= cursor.daily.date) return
  if (cursor.daily.status === "open" && !cursor.skipMarks.has(cursor.daily.date)) {
    const topicId = cursor.daily.topicId
    const before = scoreOf(cursor.mastery, topicId)
    cursor.skipStreak += 1
    cursor.skipMarks.add(cursor.daily.date)
    pushDelta(cursor, cursor.daily.date, topicId, before, before)
  }
  cursor.daily = openPlan(cursor, topics, day)
}

function replanIfWeakestMoved(cursor: Cursor, topics: readonly PlanTopic[], previousTopicId: string) {
  if (!cursor.daily || cursor.daily.status !== "open") return
  const next = openPlan(cursor, topics, cursor.daily.date)
  if (next.topicId === previousTopicId) return
  cursor.daily = next
}

function applyShrink(cursor: Cursor, topics: readonly PlanTopic[], event: AttemptEvent) {
  if (!cursor.daily || cursor.daily.status !== "open") return
  const topic = topics.find((item) => item.id === cursor.daily?.topicId)
  if (!topic) return
  const before = scoreOf(cursor.mastery, topic.id)
  cursor.skipStreak += 1
  cursor.skipMarks.add(cursor.daily.date)
  cursor.daily = shrinkDaily(cursor.daily, topic)
  pushDelta(cursor, cursor.daily.date, topic.id, before, before)
  see(cursor, topic.id, event.occurredAt)
}

function applySkip(cursor: Cursor, event: AttemptEvent) {
  if (!cursor.daily) return
  const rolled = event.payload?.reason === "rolled"
  const topicId = cursor.daily.topicId
  const before = scoreOf(cursor.mastery, topicId)
  if (rolled) {
    if (!cursor.skipMarks.has(cursor.daily.date)) {
      cursor.skipStreak += 1
      cursor.skipMarks.add(cursor.daily.date)
      pushDelta(cursor, cursor.daily.date, topicId, before, before)
    }
    see(cursor, topicId, event.occurredAt)
    return
  }
  if (cursor.daily.status !== "open") return
  cursor.skipStreak += 1
  cursor.skipMarks.add(cursor.daily.date)
  cursor.daily = { ...cursor.daily, status: "skipped" }
  pushDelta(cursor, cursor.daily.date, topicId, before, before)
  see(cursor, topicId, event.occurredAt)
}

function applyDone(cursor: Cursor, event: AttemptEvent) {
  if (!cursor.daily || cursor.daily.status !== "open") return
  const topicId = cursor.daily.topicId
  const before = scoreOf(cursor.mastery, topicId)
  // Payload score_delta is ignored. finishToday always adds DRILL_DONE_DELTA.
  const after = clampScore(before + DRILL_DONE_DELTA)
  const mastery = replaceScore(cursor.mastery, topicId, after)
  if (mastery) cursor.mastery = mastery
  cursor.skipStreak = 0
  cursor.daily = { ...cursor.daily, status: "done" }
  pushDelta(cursor, cursor.daily.date, topicId, before, after)
  see(cursor, topicId, event.occurredAt)
}

interface GradedItem {
  topicId: string
  correct: boolean
  difficulty: number
}

function gradedItems(event: AttemptEvent): GradedItem[] {
  const payload = event.payload ?? {}
  if (event.kind === "mock" && Array.isArray(payload.items) && payload.items.length > 0) {
    const items: GradedItem[] = []
    for (const item of payload.items) {
      const topicId = item.topic_id ?? event.topicId
      if (!topicId || typeof item.correct !== "boolean") continue
      const difficulty = typeof item.difficulty === "number" ? item.difficulty : typeof payload.difficulty === "number" ? payload.difficulty : 1200
      items.push({ topicId, correct: item.correct, difficulty })
    }
    return items
  }
  if ((event.kind === "mock" || event.kind === "drill_item") && event.topicId && typeof payload.correct === "boolean") {
    const difficulty = typeof payload.difficulty === "number" ? payload.difficulty : 1200
    return [{ topicId: event.topicId, correct: payload.correct, difficulty }]
  }
  return []
}

function applyGraded(cursor: Cursor, topics: readonly PlanTopic[], event: AttemptEvent) {
  const items = gradedItems(event)
  if (items.length === 0) return
  const previousTopicId = cursor.daily?.topicId
  for (const item of items) {
    if (!cursor.mastery.some((row) => row.topicId === item.topicId)) continue
    const before = scoreOf(cursor.mastery, item.topicId)
    const after = clampScore(before + itemScoreDelta(item.correct))
    const mastery = replaceScore(cursor.mastery, item.topicId, after)
    if (mastery) cursor.mastery = mastery
    cursor.abilities = applyTopicAbility(cursor.abilities, item.topicId, item.correct, before, item.difficulty)
    const tally = tallyFor(cursor, item.topicId)
    if (item.correct) tally.nCorrect += 1
    else tally.nWrong += 1
    tally.lastSeenAt = event.occurredAt
    pushDelta(cursor, event.localDay, item.topicId, before, after)
  }
  if (previousTopicId) replanIfWeakestMoved(cursor, topics, previousTopicId)
}

function applyUpload(cursor: Cursor, topics: readonly PlanTopic[], event: AttemptEvent) {
  const payload = event.payload ?? {}
  const topicId = payload.topic_id ?? event.topicId
  if (!topicId || !cursor.mastery.some((row) => row.topicId === topicId)) return
  const correct = payload.correct_count
  const total = payload.total ?? (typeof correct === "number" && typeof payload.wrong_count === "number" ? correct + payload.wrong_count : undefined)
  if (!Number.isInteger(total) || total == null || total < 1 || total > 50) return
  if (!Number.isInteger(correct) || correct == null || correct < 0 || correct > total) return
  const previousTopicId = cursor.daily?.topicId
  const before = scoreOf(cursor.mastery, topicId)
  const after = clampScore(before + uploadScoreDelta(correct, total))
  const mastery = replaceScore(cursor.mastery, topicId, after)
  if (mastery) cursor.mastery = mastery
  cursor.abilities = applyTopicAbility(cursor.abilities, topicId, uploadCountsAsHit(correct, total), before)
  const tally = tallyFor(cursor, topicId)
  tally.nCorrect += correct
  tally.nWrong += total - correct
  tally.lastSeenAt = event.occurredAt
  pushDelta(cursor, event.localDay, topicId, before, after)
  if (previousTopicId) replanIfWeakestMoved(cursor, topics, previousTopicId)
}

function applyEvent(cursor: Cursor, topics: readonly PlanTopic[], event: AttemptEvent) {
  switch (event.kind) {
    case "drill_shrink":
      applyShrink(cursor, topics, event)
      return
    case "drill_skip":
      applySkip(cursor, event)
      return
    case "drill_done":
      applyDone(cursor, event)
      return
    case "drill_item":
    case "mock":
      applyGraded(cursor, topics, event)
      return
    case "upload":
    case "import_grade":
      applyUpload(cursor, topics, event)
      return
    default:
      return
  }
}

function sortAttempts(attempts: readonly AttemptEvent[]): AttemptEvent[] {
  return [...attempts].sort((left, right) => {
    const time = left.occurredAt.localeCompare(right.occurredAt)
    if (time !== 0) return time
    return left.id.localeCompare(right.id)
  })
}

function sessionsFrom(deltas: readonly ScoreDelta[]): Session[] {
  return deltas.map((item, index) => ({
    id: `replay-${index}`,
    date: item.date,
    kind: "mock",
    topicId: item.topicId,
    detail: "",
    scoreBefore: item.scoreBefore,
    scoreAfter: item.scoreAfter,
  }))
}

function topicDrafts(topics: readonly PlanTopic[], cursor: Cursor): TopicStateDraft[] {
  return topics.map((topic) => {
    const ability = cursor.abilities.find((item) => item.topicId === topic.id) ?? abilityFromScore(topic.id, scoreOf(cursor.mastery, topic.id))
    const tally = cursor.tallies.get(topic.id)
    return {
      topicId: topic.id,
      score: scoreOf(cursor.mastery, topic.id),
      rating: ability.rating,
      uncertainty: ability.uncertainty,
      nCorrect: tally?.nCorrect ?? 0,
      nWrong: tally?.nWrong ?? 0,
      lastSeenAt: tally?.lastSeenAt ?? null,
    }
  })
}

export function replayAttempts(input: ReplayInput): DerivedState {
  const topics = input.topics
  const cursor: Cursor = {
    mastery: input.baseline.map((item) => ({ topicId: item.topicId, score: item.score })),
    abilities: input.baseline.map((item) => abilityFromScore(item.topicId, item.score)),
    skipStreak: 0,
    daily: null,
    skipMarks: new Set<string>(),
    deltas: [],
    tallies: new Map<string, TopicTally>(),
  }
  for (const event of sortAttempts(input.attempts)) {
    rollToDay(cursor, topics, event.localDay)
    applyEvent(cursor, topics, event)
  }
  if (topics.length > 0) rollToDay(cursor, topics, input.today)
  const sessions = sessionsFrom(cursor.deltas)
  return {
    algoVersion: ALGO_VERSION,
    source: "replay",
    mastery: cursor.mastery,
    abilities: cursor.abilities,
    skipStreak: cursor.skipStreak,
    plan: cursor.daily ? planDraft(cursor.daily) : null,
    forecast: buildForecast({
      mastery: cursor.mastery,
      baseline: input.baseline,
      sessions,
      goal: input.goal,
      today: input.today,
      available: hasExamEvidence(input.attempts, input.sources ?? []),
    }),
    topics: topicDrafts(topics, cursor),
  }
}

export function deriveFromRecord(
  state: {
    mastery: Mastery[]
    baseline: Mastery[]
    abilities?: Ability[]
    sessions: Session[]
    daily: Daily
    skipStreak: number
    goal?: Goal | null
  },
  today: string,
): DerivedState {
  const abilities = state.abilities?.map((item) => ({ ...item })) ?? state.mastery.map((item) => abilityFromScore(item.topicId, item.score))
  const mastery = state.mastery.map((item) => ({ ...item }))
  // Local sessions have no paper_kind. Historical qianbei-record-v1 stays uncalibrated.
  const forecast = buildForecast({
    mastery,
    baseline: state.baseline,
    sessions: state.sessions,
    goal: state.goal,
    today,
    available: false,
  })
  const topics: TopicStateDraft[] = mastery.map((item) => {
    const ability = abilities.find((entry) => entry.topicId === item.topicId) ?? abilityFromScore(item.topicId, item.score)
    return {
      topicId: item.topicId,
      score: item.score,
      rating: ability.rating,
      uncertainty: ability.uncertainty,
      nCorrect: 0,
      nWrong: 0,
      lastSeenAt: null,
    }
  })
  return {
    algoVersion: ALGO_VERSION,
    source: "local",
    mastery,
    abilities,
    skipStreak: state.skipStreak,
    plan: planDraft(state.daily),
    forecast,
    topics,
  }
}
