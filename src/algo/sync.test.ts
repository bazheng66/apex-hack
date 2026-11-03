import type { SupabaseClient } from "@supabase/supabase-js"
import { describe, expect, it, vi } from "vitest"
import { createProfile, finishToday } from "../engine/agent.ts"
import { examById } from "../engine/catalog.ts"
import { deriveFromRecord, persistDerivedFromRecord } from "./index.ts"

const today = "2026-11-02"

interface Op {
  table: string
  method: "select" | "upsert" | "insert" | "update" | "delete"
  payload?: unknown
}

function topicRows() {
  return examById("os").topics.map((topic, index) => ({
    id: topic.id,
    slug: topic.id,
    name: topic.name,
    drill_prompt: null,
    minimum_prompt: null,
    sort_order: index,
  }))
}

function fake(seed: {
  userId?: string | null
  exam?: { id: string; level_hint: string | null; exam_date: string | null; target_score: number | null } | null
  topics?: unknown[]
  attempts?: unknown[]
  sources?: unknown[]
}) {
  const ops: Op[] = []
  const client = {
    auth: {
      getSession: async () => ({
        data: { session: seed.userId ? { user: { id: seed.userId } } : null },
        error: null,
      }),
    },
    from(table: string) {
      const query = {
        select() {
          ops.push({ table, method: "select" })
          return query
        },
        eq() {
          return query
        },
        order() {
          return query
        },
        maybeSingle() {
          return Promise.resolve({ data: table === "exams" ? (seed.exam ?? null) : null, error: null })
        },
        upsert(payload: unknown) {
          ops.push({ table, method: "upsert", payload })
          return Promise.resolve({ data: null, error: null })
        },
        insert(payload: unknown) {
          ops.push({ table, method: "insert", payload })
          return Promise.resolve({ data: null, error: null })
        },
        update(payload: unknown) {
          ops.push({ table, method: "update", payload })
          return Promise.resolve({ data: null, error: null })
        },
        delete() {
          ops.push({ table, method: "delete" })
          return Promise.resolve({ data: null, error: null })
        },
        then(onFulfilled: (value: { data: unknown; error: null }) => unknown, onRejected?: (reason: unknown) => unknown) {
          let data: unknown = []
          if (table === "topics") data = seed.topics ?? []
          if (table === "attempts") data = seed.attempts ?? []
          if (table === "sources") data = seed.sources ?? []
          return Promise.resolve({ data, error: null }).then(onFulfilled, onRejected)
        },
      }
      return query
    },
  }
  return { client: client as unknown as SupabaseClient, ops }
}

describe("persist derived rows", () => {
  it("keeps the local record when there is no cloud client or no attempts", async () => {
    const done = finishToday(createProfile("os", "uneven", today))
    const offline = await persistDerivedFromRecord(done, { client: null, today })
    expect(offline.persisted).toBe(false)
    expect(offline.reason).toBe("no-client")
    expect(offline.algoVersion).toBe("score-elo-v1")
    expect(offline.derived.source).toBe("local")
    expect(offline.derived.mastery).toEqual(done.mastery)
    expect(offline.derived.forecast.available).toBe(false)
    expect(offline.derived.forecast.calibrated).toBe(false)

    const { client, ops } = fake({
      userId: "user-1",
      exam: { id: "exam-1", level_hint: "uneven", exam_date: null, target_score: null },
      topics: topicRows(),
      attempts: [],
      sources: [],
    })
    const empty = await persistDerivedFromRecord(done, { client, today })
    expect(empty.persisted).toBe(false)
    expect(empty.reason).toBe("no-attempts")
    expect(empty.derived.mastery).toEqual(done.mastery)
    expect(empty.derived.forecast.available).toBe(false)
    expect(ops.some((op) => op.method === "upsert" || op.method === "insert" || op.method === "update" || op.method === "delete")).toBe(false)
    expect(deriveFromRecord(done, today).plan?.status).toBe("done")
  })

  it("upserts topic state, forecast, and plan, and only selects attempts", async () => {
    const state = createProfile("os", "uneven", today)
    const before = state.mastery.map((item) => ({ ...item }))
    const { client, ops } = fake({
      userId: "user-1",
      exam: { id: "exam-1", level_hint: "uneven", exam_date: "2026-12-01", target_score: 80 },
      topics: topicRows(),
      attempts: [
        {
          id: "mock-1",
          topic_id: "os-paging",
          source_id: null,
          kind: "mock",
          paper_kind: null,
          occurred_at: "2026-11-02T01:00:00.000Z",
          local_day: today,
          payload: { chosen: 0, correct: false },
        },
      ],
      sources: [{ id: "src-1", paper_kind: "practice" }],
    })
    const result = await persistDerivedFromRecord(state, { client, today })
    expect(result.persisted).toBe(true)
    expect(result.reason).toBe("upserted")
    expect(result.derived.source).toBe("replay")
    expect(result.derived.mastery.find((item) => item.topicId === "os-paging")?.score).toBe(36)
    expect(state.mastery).toEqual(before)

    const attemptOps = ops.filter((op) => op.table === "attempts")
    expect(attemptOps.map((op) => op.method)).toEqual(["select"])
    expect(ops.some((op) => op.method === "update" || op.method === "delete")).toBe(false)

    const topics = ops.find((op) => op.table === "user_topic_state")
    expect(topics?.method).toBe("upsert")
    expect(topics?.payload).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          user_id: "user-1",
          exam_id: "exam-1",
          topic_id: "os-paging",
          score: 36,
          n_wrong: 1,
          p_mastery: null,
          half_life_days: null,
          algo_version: "score-elo-v1",
        }),
      ]),
    )

    const forecast = ops.find((op) => op.table === "user_exam_forecast")
    expect(forecast?.payload).toEqual(
      expect.objectContaining({
        user_id: "user-1",
        exam_id: "exam-1",
        weakest: 36,
        available: false,
        calibrated: false,
        pass_p_low: null,
        pass_p_high: null,
        algo_version: "score-elo-v1",
      }),
    )

    const plan = ops.find((op) => op.table === "plans")
    expect(plan?.payload).toEqual(
      expect.objectContaining({
        user_id: "user-1",
        exam_id: "exam-1",
        topic_id: "os-paging",
        local_day: today,
        minutes: 25,
        rule_id: "LOWEST_TOPIC",
        status: "open",
        shortened: false,
        companion_hint: "encourage",
      }),
    )
    expect(ops.find((op) => op.table === "algo_runs")?.payload).toEqual(
      expect.objectContaining({ algo_version: "score-elo-v1", user_id: "user-1", exam_id: "exam-1" }),
    )
  })

  it("marks the forecast available once a diagnostic attempt exists, without a pass rate", async () => {
    const state = createProfile("os", "uneven", today)
    const { client, ops } = fake({
      userId: "user-1",
      exam: { id: "exam-1", level_hint: "uneven", exam_date: null, target_score: null },
      topics: topicRows(),
      attempts: [
        {
          id: "diag-1",
          topic_id: "os-paging",
          source_id: null,
          kind: "drill_item",
          paper_kind: "diagnostic",
          occurred_at: "2026-11-02T01:00:00.000Z",
          local_day: today,
          payload: { correct: true },
        },
      ],
      sources: [],
    })
    const result = await persistDerivedFromRecord(state, { client, today })
    expect(result.persisted).toBe(true)
    expect(result.derived.forecast.available).toBe(true)
    expect(result.derived.forecast.calibrated).toBe(false)
    expect(result.derived.forecast.passPLow).toBeNull()
    expect(ops.find((op) => op.table === "user_exam_forecast")?.payload).toEqual(
      expect.objectContaining({ available: true, calibrated: false, pass_p_low: null, pass_p_high: null }),
    )
    expect(ops.filter((op) => op.table === "attempts").every((op) => op.method === "select")).toBe(true)
  })

  it("does not write when the session is missing", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    const { client, ops } = fake({ userId: null })
    const result = await persistDerivedFromRecord(createProfile("os", "start", today), { client, today })
    expect(result.persisted).toBe(false)
    expect(result.reason).toBe("no-user")
    expect(result.derived.source).toBe("local")
    expect(ops).toEqual([])
    expect(warn).not.toHaveBeenCalled()
    warn.mockRestore()
  })
})
