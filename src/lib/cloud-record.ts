import type { SupabaseClient } from "@supabase/supabase-js"
import { sessionKindToAttemptKind } from "../algo/events.ts"
import { replayAttempts } from "../algo/replay.ts"
import { deferToday, finishToday, gradePaper, recordUpload, rollTo } from "../engine/agent.ts"
import { examById } from "../engine/catalog.ts"
import type { RecordState, Session } from "../engine/types.ts"
import { todayKey } from "./day.ts"
import { readable } from "./storage.ts"

export interface CloudRecord { id: string; revision: number; state: RecordState | null }
export class RecordConflict extends Error {}

function checked<T>({ data, error }: { data: T; error: { message: string; code?: string } | null }): T {
  if (error?.code === "PT409") throw new RecordConflict("另一处记录已更新，正在合并。")
  if (error) throw new Error(error.message)
  return data
}

/** Stable UUIDs make a retry, including a reload after a lost response, an insert no-op. */
export async function eventUuid(userId: string, examId: string, sessionId: string): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${userId}/${examId}/${sessionId}`)))
  digest[6] = (digest[6]! & 15) | 80
  digest[8] = (digest[8]! & 63) | 128
  const hex = [...digest.slice(0, 16)].map((n) => n.toString(16).padStart(2, "0")).join("")
  return `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`
}

export async function attemptRows(state: RecordState, userId: string, examId: string) {
  return Promise.all(state.sessions.map(async (event, index) => ({
    client_event_id: await eventUuid(userId, examId, event.id),
    topic_slug: event.topicId,
    kind: sessionKindToAttemptKind(event.kind),
    // Legacy sessions have no timestamp or raw answers. Preserve that fact and their snapshot.
    occurred_at: event.occurredAt ?? new Date(Date.parse(`${event.date}T12:00:00+08:00`) + index).toISOString(),
    local_day: event.date,
    payload: { ...event.payload, items: event.payload?.items?.map((item) => ({ ...item, topic_id: undefined })), local_session: event, legacy_snapshot: !event.payload },
  })))
}

export async function findCloudRecord(client: SupabaseClient, userId: string, slug?: string): Promise<CloudRecord | null> {
  let query = client.from("exams").select("id,record_state,record_revision").eq("user_id", userId)
  if (slug) query = query.eq("slug", slug)
  else {
    const profile = checked(await client.from("users").select("active_exam_id").eq("id", userId).maybeSingle())
    if (!profile?.active_exam_id) return null
    query = query.eq("id", profile.active_exam_id)
  }
  const row = checked(await query.maybeSingle())
  if (!row) return null
  if (row.record_state !== null && !readable(row.record_state)) throw new Error("云端记录格式无法读取，已保留本地副本。")
  return { id: row.id, revision: row.record_revision, state: row.record_state }
}

export async function ensureCloudExam(client: SupabaseClient, userId: string, state: RecordState): Promise<CloudRecord> {
  checked(await client.from("users").upsert({ id: userId }, { onConflict: "id", ignoreDuplicates: true }))
  checked(await client.from("exams").upsert({ user_id: userId, slug: state.examId, name: examById(state.examId).name }, { onConflict: "user_id,slug", ignoreDuplicates: true }))
  const exam = await findCloudRecord(client, userId, state.examId)
  if (!exam) throw new Error("考试记录尚未创建。")
  checked(await client.from("topics").upsert(examById(state.examId).topics.map((topic, index) => ({
    user_id: userId, exam_id: exam.id, slug: topic.id, name: topic.name,
    drill_prompt: topic.drill, minimum_prompt: topic.minimum, sort_order: index,
  })), { onConflict: "exam_id,slug", ignoreDuplicates: true }))
  return exam
}

export async function saveCloudRecord(client: SupabaseClient, userId: string, cloud: CloudRecord, state: RecordState): Promise<number> {
  return checked(await client.rpc("save_record_state", {
    p_exam_id: cloud.id, p_revision: cloud.revision, p_state: state,
    p_attempts: await attemptRows(state, userId, cloud.id),
  })) as number
}

/** Reapply unsent actions on the latest snapshot; never silently discard either tab's events. */
export function mergeCloudRecord(remote: RecordState, local: RecordState): RecordState {
  if (remote.examId !== local.examId) throw new RecordConflict("考试记录不一致，本地副本已保留。")
  const combined = [...new Map([...remote.sessions, ...local.sessions].map((event) => [event.id, event])).values()]
  // With raw inputs, replay both tabs in event order so clamping and Elo agree
  // with the cloud projection, regardless of which response arrived first.
  if (combined.length && combined.every((event) => event.payload || event.kind.startsWith("drill-"))) {
    const derived = replayAttempts({
      topics: examById(remote.examId).topics, baseline: remote.baseline, today: todayKey(), goal: local.goal,
      attempts: combined.map((event, index) => ({
        id: event.id, topicId: event.topicId, kind: sessionKindToAttemptKind(event.kind),
        occurredAt: event.occurredAt ?? new Date(Date.parse(`${event.date}T12:00:00+08:00`) + index).toISOString(),
        localDay: event.date, payload: event.payload ?? (event.id.endsWith("-rolled") ? { reason: "rolled" } : {}),
      })),
    })
    const plan = derived.plan
    return { ...remote, goal: local.goal, mastery: derived.mastery, abilities: derived.abilities, skipStreak: derived.skipStreak,
      sessions: combined.sort((a, b) => a.date.localeCompare(b.date) || (a.occurredAt ?? "").localeCompare(b.occurredAt ?? "") || a.id.localeCompare(b.id)),
      answeredIds: [...new Set([...remote.answeredIds, ...local.answeredIds])],
      cards: [...new Map([...(remote.cards ?? []), ...(local.cards ?? [])].map((card) => [card.id, card])).values()],
      mistakes: [...new Map([...(remote.mistakes ?? []), ...(local.mistakes ?? [])].map((note) => [note.id, note])).values()],
      daily: plan ? { date: plan.localDay, topicId: plan.topicId, minutes: plan.minutes, instruction: plan.instruction, reason: plan.reason, ruleId: plan.ruleId, status: plan.status } : remote.daily,
    }
  }
  const known = new Set(remote.sessions.map((s) => s.id))
  let merged = remote
  for (const event of local.sessions.filter((s) => !known.has(s.id))) {
    if (event.date < merged.daily.date) throw new RecordConflict("旧版离线记录与云端日期冲突，本地副本已保留。请先导出后重新载入。")
    const before = rollTo(merged, event.date)
    let next: RecordState
    if (event.kind === "drill-done") next = finishToday(before)
    else if (event.kind === "drill-shrink" || event.kind === "drill-skip") {
      next = event.id.endsWith("-rolled") ? before : deferToday(before)
    } else if (event.kind === "upload" && event.payload?.correct_count !== undefined && event.payload.total !== undefined) {
      const result = recordUpload(before, { topicId: event.topicId, correct: event.payload.correct_count, total: event.payload.total, mistake: event.payload.mistake_text ?? "", today: event.date })
      if (!result.ok) throw new RecordConflict(result.message)
      next = result.state
    } else if (event.kind === "mock" && event.payload?.items?.[0]?.item_id && event.payload.chosen !== undefined) {
      const questionId = event.payload.items[0].item_id
      next = gradePaper(before, { [questionId]: event.payload.chosen }, event.date).state
    } else throw new RecordConflict("旧版记录与云端同时发生变化。本地副本已保留，请先导出后重新载入。")
    // Keep the original client identity, even when an action is now redundant.
    const generated = next.sessions.filter((s) => !before.sessions.some((old) => old.id === s.id))
    const projected: Session = generated.at(-1) ? { ...generated.at(-1)!, id: event.id, occurredAt: event.occurredAt, payload: event.payload } : event
    merged = { ...next, sessions: [...before.sessions, projected] }
    known.add(event.id)
  }
  return rollTo({ ...merged, goal: local.goal }, todayKey())
}
