import type { SupabaseClient } from "@supabase/supabase-js"
import { examById, scoresForLevel } from "../engine/catalog.ts"
import type { PlanTopic } from "../engine/plan.ts"
import type { ExamId, Goal, LevelId, Mastery, RecordState } from "../engine/types.ts"
import { todayKey } from "../lib/day.ts"
import { supabase } from "../lib/supabase.ts"
import { isAttemptKind, isPaperKind, type AttemptEvent, type AttemptPayload, type SourcePaper } from "./events.ts"
import { deriveFromRecord, replayAttempts, type DerivedState } from "./replay.ts"
import { ALGO_VERSION } from "./version.ts"

export interface SyncResult {
  persisted: boolean
  reason: "no-client" | "no-user" | "no-exam" | "no-attempts" | "upserted" | "error"
  algoVersion: typeof ALGO_VERSION
  derived: DerivedState
}

interface ExamRow {
  id: string
  level_hint: string | null
  exam_date: string | null
  target_score: number | string | null
}

interface TopicRow {
  id: string
  slug: string | null
  name: string
  drill_prompt: string | null
  minimum_prompt: string | null
  sort_order: number
}

interface CloudTopic extends PlanTopic {
  slug: string | null
}

const LEVELS = new Set<LevelId>(["start", "basic", "uneven", "polish"])

function isLevel(value: unknown): value is LevelId {
  return typeof value === "string" && LEVELS.has(value as LevelId)
}

function isExamId(value: string): value is ExamId {
  return value === "os" || value === "network" || value === "ds"
}

function asNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value
  if (typeof value === "string" && value.trim() && Number.isFinite(Number(value))) return Number(value)
  return null
}

function asPayload(value: unknown): AttemptPayload {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {}
  return value as AttemptPayload
}

function mapAttempt(row: Record<string, unknown>): AttemptEvent | null {
  if (typeof row.id !== "string" || !isAttemptKind(row.kind)) return null
  if (typeof row.occurred_at !== "string" || typeof row.local_day !== "string") return null
  return {
    id: row.id,
    topicId: typeof row.topic_id === "string" ? row.topic_id : null,
    sourceId: typeof row.source_id === "string" ? row.source_id : null,
    kind: row.kind,
    paperKind: isPaperKind(row.paper_kind) ? row.paper_kind : null,
    occurredAt: row.occurred_at,
    localDay: row.local_day.slice(0, 10),
    payload: asPayload(row.payload),
  }
}

function cloudTopics(examSlug: string, rows: TopicRow[]): CloudTopic[] {
  const catalog = isExamId(examSlug) ? examById(examSlug).topics : []
  return [...rows]
    .sort((left, right) => left.sort_order - right.sort_order || left.id.localeCompare(right.id))
    .map((row) => {
      const known = catalog.find((topic) => topic.id === row.slug)
      return {
        id: row.id,
        slug: row.slug,
        name: row.name,
        drill: row.drill_prompt?.trim() || known?.drill || row.name,
        minimum: row.minimum_prompt?.trim() || known?.minimum || row.name,
      }
    })
}

function baselineFor(topics: readonly CloudTopic[], state: RecordState, levelHint: string | null): Mastery[] {
  const level = isLevel(levelHint) ? levelHint : state.level
  const scores = scoresForLevel(level)
  return topics.map((topic, index) => {
    const local = state.baseline.find((item) => item.topicId === topic.slug || item.topicId === topic.id)
    return { topicId: topic.id, score: local?.score ?? scores[index] ?? scores[scores.length - 1] ?? 40 }
  })
}

function goalFor(state: RecordState, exam: ExamRow): Goal | null {
  if (state.goal) return state.goal
  const target = asNumber(exam.target_score)
  if (!exam.exam_date || target == null) return null
  return { examDate: exam.exam_date.slice(0, 10), target }
}

function assertOk<T>(result: { data: T; error: { message: string } | null }, label: string): T {
  if (result.error) throw new Error(`${label}: ${result.error.message}`)
  return result.data
}

async function writeDerived(client: SupabaseClient, userId: string, examId: string, derived: DerivedState) {
  const topicRows = derived.topics.map((topic) => ({
    user_id: userId,
    exam_id: examId,
    topic_id: topic.topicId,
    score: topic.score,
    rating: topic.rating,
    uncertainty: topic.uncertainty,
    p_mastery: null,
    half_life_days: null,
    last_seen_at: topic.lastSeenAt,
    next_due_at: null,
    n_correct: topic.nCorrect,
    n_wrong: topic.nWrong,
    algo_version: ALGO_VERSION,
  }))
  if (topicRows.length > 0) {
    assertOk(await client.from("user_topic_state").upsert(topicRows, { onConflict: "user_id,exam_id,topic_id" }), "user_topic_state")
  }
  const forecast = derived.forecast
  assertOk(
    await client.from("user_exam_forecast").upsert(
      {
        user_id: userId,
        exam_id: examId,
        average: forecast.average,
        weakest: forecast.weakest,
        velocity: forecast.velocity,
        projected: forecast.projected,
        pass_p_low: null,
        pass_p_high: null,
        calibrated: false,
        available: forecast.available,
        as_of: new Date().toISOString(),
        algo_version: ALGO_VERSION,
      },
      { onConflict: "user_id,exam_id" },
    ),
    "user_exam_forecast",
  )
  if (derived.plan) {
    const plan = derived.plan
    assertOk(
      await client.from("plans").upsert(
        {
          user_id: userId,
          exam_id: examId,
          topic_id: plan.topicId,
          local_day: plan.localDay,
          minutes: plan.minutes,
          instruction: plan.instruction,
          reason: plan.reason,
          rule_id: plan.ruleId,
          status: plan.status,
          shortened: plan.shortened,
          companion_hint: plan.companionHint,
        },
        { onConflict: "user_id,exam_id,local_day" },
      ),
      "plans",
    )
  }
  assertOk(
    await client.from("algo_runs").insert({
      user_id: userId,
      exam_id: examId,
      algo_version: ALGO_VERSION,
    }),
    "algo_runs",
  )
}

/**
 * Materialize derived rows from append-only attempts.
 * Selects attempts. Never updates or deletes them.
 * With no client, no user, no exam row, or no attempts, returns the local RecordState projection and writes nothing.
 */
export async function persistDerivedFromRecord(
  state: RecordState,
  options?: { client?: SupabaseClient | null; today?: string },
): Promise<SyncResult> {
  const today = options?.today ?? todayKey()
  const local = deriveFromRecord(state, today)
  const client = options === undefined ? supabase : (options.client ?? null)
  if (!client) return { persisted: false, reason: "no-client", algoVersion: ALGO_VERSION, derived: local }
  try {
    const session = await client.auth.getSession()
    if (session.error || !session.data.session?.user.id) {
      return { persisted: false, reason: "no-user", algoVersion: ALGO_VERSION, derived: local }
    }
    const userId = session.data.session.user.id
    const examResult = await client
      .from("exams")
      .select("id, level_hint, exam_date, target_score")
      .eq("user_id", userId)
      .eq("slug", state.examId)
      .maybeSingle()
    const exam = assertOk(examResult, "exams") as ExamRow | null
    if (!exam?.id) return { persisted: false, reason: "no-exam", algoVersion: ALGO_VERSION, derived: local }

    const [topicResult, attemptResult, sourceResult] = await Promise.all([
      client.from("topics").select("id, slug, name, drill_prompt, minimum_prompt, sort_order").eq("user_id", userId).eq("exam_id", exam.id).order("sort_order", { ascending: true }),
      client
        .from("attempts")
        .select("id, topic_id, source_id, kind, paper_kind, occurred_at, local_day, payload")
        .eq("user_id", userId)
        .eq("exam_id", exam.id)
        .order("occurred_at", { ascending: true })
        .order("id", { ascending: true }),
      client.from("sources").select("id, paper_kind").eq("user_id", userId).eq("exam_id", exam.id),
    ])
    const topicRows = (assertOk(topicResult, "topics") ?? []) as TopicRow[]
    const attemptRows = (assertOk(attemptResult, "attempts") ?? []) as Record<string, unknown>[]
    const sourceRows = (assertOk(sourceResult, "sources") ?? []) as { id: string; paper_kind: string | null }[]
    const attempts = attemptRows.map((row) => mapAttempt(row)).filter((row): row is AttemptEvent => row !== null)
    if (attempts.length === 0) return { persisted: false, reason: "no-attempts", algoVersion: ALGO_VERSION, derived: local }

    const topics = cloudTopics(state.examId, topicRows)
    const sources: SourcePaper[] = sourceRows.map((row) => ({
      id: row.id,
      paperKind: isPaperKind(row.paper_kind) ? row.paper_kind : null,
    }))
    const derived = replayAttempts({
      topics,
      baseline: baselineFor(topics, state, exam.level_hint),
      attempts,
      today,
      goal: goalFor(state, exam),
      sources,
    })
    await writeDerived(client, userId, exam.id, derived)
    return { persisted: true, reason: "upserted", algoVersion: ALGO_VERSION, derived }
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown error"
    console.warn("algo sync failed", message)
    return { persisted: false, reason: "error", algoVersion: ALGO_VERSION, derived: local }
  }
}

/** Fire-and-forget hook for finish / defer / grade. Local state is already saved by the caller. */
export function syncAfterLocalChange(state: RecordState): void {
  void persistDerivedFromRecord(state)
}
