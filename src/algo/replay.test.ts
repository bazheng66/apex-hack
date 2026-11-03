import { describe, expect, it } from "vitest"
import { createProfile, deferToday, finishToday, gradePaper, recordUpload, rollTo } from "../engine/agent.ts"
import { examById } from "../engine/catalog.ts"
import { abilityFromScore, applyAbility } from "../engine/model.ts"
import type { Daily } from "../engine/types.ts"
import { ALGO_VERSION, replayAttempts, sessionKindToAttemptKind, type AttemptEvent, type PlanDraft } from "./index.ts"

const today = "2026-11-02"

function attempt(partial: Partial<AttemptEvent> & Pick<AttemptEvent, "id" | "kind" | "localDay" | "occurredAt">): AttemptEvent {
  return { topicId: null, payload: {}, ...partial }
}

function expectSamePlan(actual: PlanDraft | null, daily: Daily) {
  expect(actual).toMatchObject({
    localDay: daily.date,
    topicId: daily.topicId,
    minutes: daily.minutes,
    instruction: daily.instruction,
    reason: daily.reason,
    ruleId: daily.ruleId,
    status: daily.status,
  })
}

describe("replay attempts into scores", () => {
  it("matches a wrong mock: score −4, Elo update, other topics unchanged", () => {
    const state = createProfile("os", "uneven", today)
    const graded = gradePaper(state, { "os-2": 0 }, today)
    const baseline = state.baseline.map((item) => ({ ...item }))
    const derived = replayAttempts({
      topics: examById("os").topics,
      baseline,
      today,
      attempts: [
        attempt({
          id: "mock-os-2",
          kind: "mock",
          topicId: "os-paging",
          localDay: today,
          occurredAt: "2026-11-02T01:00:00.000Z",
          payload: { chosen: 0, correct: false },
        }),
      ],
    })
    expect(derived.algoVersion).toBe(ALGO_VERSION)
    expect(derived.mastery).toEqual(graded.state.mastery)
    expect(derived.abilities).toEqual(graded.state.abilities)
    expect(derived.topics.find((topic) => topic.topicId === "os-paging")).toMatchObject({
      score: 36,
      rating: 1190,
      nWrong: 1,
      nCorrect: 0,
    })
    expect(scoreOf(derived.mastery, "os-paging")).toBe(36)
    expect(baseline).toEqual(state.baseline)
  })

  it("adds 4 for a finished drill and leaves Elo on the seeded rating", () => {
    const state = createProfile("os", "uneven", today)
    const done = finishToday(state)
    const derived = replayAttempts({
      topics: examById("os").topics,
      baseline: state.baseline,
      today,
      attempts: [
        attempt({
          id: "done",
          kind: "drill_done",
          topicId: "os-paging",
          localDay: today,
          occurredAt: "2026-11-02T02:00:00.000Z",
          payload: { minutes: 25, score_delta: 20 },
        }),
      ],
    })
    expect(derived.mastery).toEqual(done.mastery)
    expect(derived.abilities).toEqual(state.abilities)
    expect(derived.skipStreak).toBe(0)
    expect(derived.plan?.status).toBe("done")
    expect(derived.plan?.companionHint).toBe("celebrate")
    expect(scoreOf(derived.mastery, "os-paging")).toBe(44)
  })

  it("matches an upload that moves today's topic, including the Elo hit", () => {
    const state = createProfile("os", "basic", today)
    const uploaded = recordUpload(state, { topicId: "os-schedule", correct: 5, total: 5, mistake: "", today })
    expect(uploaded.ok).toBe(true)
    if (!uploaded.ok) return
    const derived = replayAttempts({
      topics: examById("os").topics,
      baseline: state.baseline,
      today,
      attempts: [
        attempt({
          id: "up",
          kind: "upload",
          topicId: "os-schedule",
          localDay: today,
          occurredAt: "2026-11-02T03:00:00.000Z",
          payload: { correct_count: 5, total: 5 },
        }),
      ],
    })
    expect(derived.mastery).toEqual(uploaded.state.mastery)
    expect(derived.abilities).toEqual(uploaded.state.abilities)
    expectSamePlan(derived.plan, uploaded.state.daily)
    expect(derived.topics.find((topic) => topic.topicId === "os-schedule")).toMatchObject({ nCorrect: 5, nWrong: 0 })
  })

  it("clamps mastery to 8 and 96", () => {
    const topics = examById("os").topics
    const low = replayAttempts({
      topics,
      baseline: topics.map((topic) => ({ topicId: topic.id, score: topic.id === "os-paging" ? 8 : 50 })),
      today,
      attempts: [
        attempt({
          id: "low",
          kind: "drill_item",
          topicId: "os-paging",
          localDay: today,
          occurredAt: "2026-11-02T01:00:00.000Z",
          payload: { correct: false },
        }),
      ],
    })
    expect(scoreOf(low.mastery, "os-paging")).toBe(8)

    const high = replayAttempts({
      topics,
      baseline: topics.map((topic) => ({ topicId: topic.id, score: topic.id === "os-paging" ? 94 : 96 })),
      today,
      attempts: [
        attempt({
          id: "high",
          kind: "drill_done",
          topicId: "os-paging",
          localDay: today,
          occurredAt: "2026-11-02T01:00:00.000Z",
        }),
      ],
    })
    expect(scoreOf(high.mastery, "os-paging")).toBe(96)

    const capped = replayAttempts({
      topics,
      baseline: topics.map((topic) => ({ topicId: topic.id, score: topic.id === "os-paging" ? 90 : 50 })),
      today,
      attempts: [
        attempt({
          id: "cap",
          kind: "mock",
          topicId: "os-paging",
          localDay: today,
          occurredAt: "2026-11-02T01:00:00.000Z",
          payload: { correct: true, difficulty: 1400 },
        }),
      ],
    })
    expect(scoreOf(capped.mastery, "os-paging")).toBe(96)
    expect(capped.abilities.find((item) => item.topicId === "os-paging")).toEqual(applyAbility(abilityFromScore("os-paging", 90), true, 1400))
  })

  it("applies events by occurred_at, not by array order", () => {
    const state = createProfile("os", "basic", today)
    const seeded = abilityFromScore("os-schedule", 36)
    const derived = replayAttempts({
      topics: examById("os").topics,
      baseline: state.baseline,
      today,
      attempts: [
        attempt({
          id: "later",
          kind: "mock",
          topicId: "os-schedule",
          localDay: today,
          occurredAt: "2026-11-02T05:00:00.000Z",
          payload: { correct: false },
        }),
        attempt({
          id: "earlier",
          kind: "import_grade",
          topicId: "os-schedule",
          localDay: today,
          occurredAt: "2026-11-02T04:00:00.000Z",
          payload: { correct_count: 2, wrong_count: 0 },
        }),
      ],
    })
    const afterUpload = applyAbility(seeded, true, 1200)
    expect(derived.abilities.find((item) => item.topicId === "os-schedule")).toEqual(applyAbility(afterUpload, false, 1200))
    expect(scoreOf(derived.mastery, "os-schedule")).toBe(40)
  })

  it("maps local session kinds onto attempt kinds", () => {
    expect(sessionKindToAttemptKind("drill-done")).toBe("drill_done")
    expect(sessionKindToAttemptKind("drill-shrink")).toBe("drill_shrink")
    expect(sessionKindToAttemptKind("drill-skip")).toBe("drill_skip")
    expect(sessionKindToAttemptKind("mock")).toBe("mock")
    expect(sessionKindToAttemptKind("upload")).toBe("upload")
  })
})

describe("plan shrink sequence", () => {
  it("follows LOWEST_TOPIC, then SKIP_TRIM, then SKIP_SHRINK", () => {
    const opened = createProfile("os", "start", "2026-11-01")
    const topics = examById("os").topics
    const baseline = opened.baseline

    const fresh = replayAttempts({ topics, baseline, attempts: [], today: "2026-11-01" })
    expectSamePlan(fresh.plan, opened.daily)
    expect(fresh.plan).toMatchObject({ minutes: 25, ruleId: "LOWEST_TOPIC", shortened: false, companionHint: "encourage" })

    const missed = rollTo(opened, today)
    const trimmed = replayAttempts({
      topics,
      baseline,
      today,
      attempts: [
        attempt({
          id: "rolled",
          kind: "drill_skip",
          topicId: opened.daily.topicId,
          localDay: "2026-11-01",
          occurredAt: "2026-11-02T00:30:00.000Z",
          payload: { reason: "rolled" },
        }),
      ],
    })
    expect(trimmed.skipStreak).toBe(missed.skipStreak)
    expectSamePlan(trimmed.plan, missed.daily)
    expect(trimmed.plan).toMatchObject({ minutes: 18, ruleId: "SKIP_TRIM", shortened: true, companionHint: "urge" })

    const closed = deferToday(deferToday(createProfile("os", "start", "2026-11-01")))
    const shrunk = rollTo(closed, today)
    const replayed = replayAttempts({
      topics,
      baseline,
      today,
      attempts: [
        attempt({
          id: "shrink",
          kind: "drill_shrink",
          topicId: opened.daily.topicId,
          localDay: "2026-11-01",
          occurredAt: "2026-11-01T10:00:00.000Z",
        }),
        attempt({
          id: "user-skip",
          kind: "drill_skip",
          topicId: opened.daily.topicId,
          localDay: "2026-11-01",
          occurredAt: "2026-11-01T11:00:00.000Z",
          payload: { reason: "user" },
        }),
      ],
    })
    expect(replayed.skipStreak).toBe(shrunk.skipStreak)
    expectSamePlan(replayed.plan, shrunk.daily)
    expect(replayed.plan).toMatchObject({ minutes: 12, ruleId: "SKIP_SHRINK", shortened: true, companionHint: "urge", status: "open" })
  })

  it("shrinks the open day to 12 minutes, then closes it, without moving the score", () => {
    const state = createProfile("network", "basic", today)
    const shrunk = deferToday(state)
    const closed = deferToday(shrunk)
    const topics = examById("network").topics
    const once = replayAttempts({
      topics,
      baseline: state.baseline,
      today,
      attempts: [
        attempt({
          id: "shrink",
          kind: "drill_shrink",
          topicId: state.daily.topicId,
          localDay: today,
          occurredAt: "2026-11-02T09:00:00.000Z",
        }),
      ],
    })
    expect(once.mastery).toEqual(shrunk.mastery)
    expectSamePlan(once.plan, shrunk.daily)
    expect(once.plan).toMatchObject({ minutes: 12, ruleId: "SKIP_SHRINK", status: "open", shortened: true, companionHint: "urge" })

    const twice = replayAttempts({
      topics,
      baseline: state.baseline,
      today,
      attempts: [
        attempt({
          id: "shrink",
          kind: "drill_shrink",
          topicId: state.daily.topicId,
          localDay: today,
          occurredAt: "2026-11-02T09:00:00.000Z",
        }),
        attempt({
          id: "skip",
          kind: "drill_skip",
          topicId: state.daily.topicId,
          localDay: today,
          occurredAt: "2026-11-02T09:30:00.000Z",
          payload: { reason: "user" },
        }),
      ],
    })
    expect(twice.skipStreak).toBe(closed.skipStreak)
    expect(twice.mastery).toEqual(closed.mastery)
    expectSamePlan(twice.plan, closed.daily)
    expect(twice.plan).toMatchObject({ status: "skipped", companionHint: "sleepy", shortened: true, minutes: 12 })
  })

  it("keeps a trimmed plan after the drill is finished and clears the skip streak", () => {
    const opened = createProfile("ds", "polish", "2026-11-01")
    const missed = rollTo(opened, today)
    const done = finishToday(missed)
    const derived = replayAttempts({
      topics: examById("ds").topics,
      baseline: opened.baseline,
      today,
      attempts: [
        attempt({
          id: "rolled",
          kind: "drill_skip",
          topicId: opened.daily.topicId,
          localDay: "2026-11-01",
          occurredAt: "2026-11-02T00:10:00.000Z",
          payload: { reason: "rolled" },
        }),
        attempt({
          id: "done",
          kind: "drill_done",
          topicId: missed.daily.topicId,
          localDay: today,
          occurredAt: "2026-11-02T01:00:00.000Z",
        }),
      ],
    })
    expect(derived.mastery).toEqual(done.mastery)
    expect(derived.skipStreak).toBe(0)
    expectSamePlan(derived.plan, done.daily)
    expect(derived.plan).toMatchObject({ status: "done", shortened: true, companionHint: "celebrate", minutes: 18 })
    expect(derived.abilities).toEqual(missed.abilities)
  })
})

describe("forecast availability", () => {
  const topics = examById("os").topics
  const baseline = createProfile("os", "uneven", today).baseline
  const practice = attempt({
    id: "practice",
    kind: "mock",
    topicId: "os-paging",
    localDay: today,
    occurredAt: "2026-11-02T01:00:00.000Z",
    paperKind: "practice",
    payload: { correct: false },
  })

  it("stays unavailable and uncalibrated without diagnostic or standard evidence", () => {
    const derived = replayAttempts({
      topics,
      baseline,
      today,
      attempts: [practice],
      sources: [{ id: "src-practice", paperKind: "practice" }],
    })
    expect(derived.forecast.available).toBe(false)
    expect(derived.forecast.calibrated).toBe(false)
    expect(derived.forecast.passPLow).toBeNull()
    expect(derived.forecast.passPHigh).toBeNull()
    expect(derived.forecast.algoVersion).toBe("score-elo-v1")
    expect(derived.forecast.weakest).toBe(36)
  })

  it("flips available for a diagnostic attempt, a standard payload, or a source row, still without a pass rate", () => {
    const diagnostic = replayAttempts({
      topics,
      baseline,
      today,
      attempts: [{ ...practice, id: "diag", paperKind: "diagnostic" }],
    })
    expect(diagnostic.forecast.available).toBe(true)
    expect(diagnostic.forecast.calibrated).toBe(false)
    expect(diagnostic.forecast.passPLow).toBeNull()
    expect(diagnostic.forecast.passPHigh).toBeNull()

    const fromPayload = replayAttempts({
      topics,
      baseline,
      today,
      attempts: [{ ...practice, id: "std", paperKind: null, payload: { correct: false, paper_kind: "standard" } }],
    })
    expect(fromPayload.forecast.available).toBe(true)
    expect(fromPayload.forecast.calibrated).toBe(false)

    const fromSource = replayAttempts({
      topics,
      baseline,
      today,
      attempts: [{ ...practice, sourceId: "paper-1" }],
      sources: [{ id: "paper-1", paperKind: "standard" }],
    })
    expect(fromSource.forecast.available).toBe(true)

    const sourceOnly = replayAttempts({
      topics,
      baseline,
      today,
      attempts: [],
      sources: [{ paperKind: "diagnostic" }],
    })
    expect(sourceOnly.forecast.available).toBe(true)
    expect(sourceOnly.forecast.calibrated).toBe(false)
    expect(sourceOnly.forecast.passPHigh).toBeNull()
  })
})

function scoreOf(mastery: { topicId: string; score: number }[], topicId: string) {
  return mastery.find((item) => item.topicId === topicId)?.score ?? -1
}
