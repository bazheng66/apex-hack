import { describe, expect, it } from "vitest"
import { planDraft } from "../algo/plan-view.ts"
import { createDemo, createProfile, deferToday, finishToday, gradePaper, nextPaper, recordUpload, rollTo, shiftDate } from "../engine/agent.ts"
import { QUESTIONS } from "../engine/catalog.ts"
import { forecastRange, mockDailyPlan, mockSessionSubmit, mockStreak, submitSummary } from "./algo-display.ts"
import { COPY } from "./companion.ts"

const today = "2026-11-03"

function wrongChoices(state: ReturnType<typeof createProfile>) {
  const choices: Record<string, number> = {}
  for (const question of nextPaper(state)) {
    choices[question.id] = question.answer === 0 ? 1 : 0
  }
  return choices
}

function rightChoices(state: ReturnType<typeof createProfile>) {
  const choices: Record<string, number> = {}
  for (const question of nextPaper(state)) choices[question.id] = question.answer
  return choices
}

describe("mock daily plan", () => {
  it("opens a normal day on encourage and does not write the record", () => {
    const state = createDemo(today)
    const snapshot = structuredClone(state)
    const plan = mockDailyPlan(state, today)
    expect(state).toEqual(snapshot)
    expect(plan.companion_hint).toBe("encourage")
    expect(plan.plan_date).toBe(today)
    expect(plan.exam_id).toBe("os")
    expect(plan.shortened).toBe(false)
    expect(plan.shorten_reason).toBeNull()
    expect(plan.capacity).toBe(25)
    expect(plan.items[0]).toMatchObject({
      topic_id: "os-paging",
      topic_name: "页面置换",
      target_n: 4,
      done_n: 0,
      reason: "due_review",
    })
    expect(plan.items[0]?.p_mastery).toBe(0.32)
    expect(plan.copy_keys).toContain("plan_lowest")
    expect(plan.copy_keys).not.toContain("streak_broke")
  })

  it("treats the first shorten as urge and halves the question target", () => {
    const state = createProfile("network", "basic", today)
    const open = mockDailyPlan(state, today)
    const once = deferToday(state)
    const plan = mockDailyPlan(once, today)
    expect(open.companion_hint).toBe("encourage")
    expect(open.capacity).toBe(25)
    expect(plan.companion_hint).toBe("urge")
    expect(plan.shortened).toBe(true)
    expect(plan.capacity).toBe(12)
    expect(plan.shorten_reason).toContain("12")
    expect(plan.items[0]?.target_n).toBe((open.items[0]?.target_n ?? 0) / 2)
    expect(plan.copy_keys).toEqual(expect.arrayContaining(["plan_shrink", "shortened_ok"]))
    expect(once.mastery).toEqual(state.mastery)
  })

  it("treats a second shorten as sleepy", () => {
    const state = deferToday(deferToday(createProfile("network", "basic", today)))
    const plan = mockDailyPlan(state, today)
    expect(state.daily.status).toBe("skipped")
    expect(plan.companion_hint).toBe("sleepy")
    expect(plan.shortened).toBe(true)
    expect(plan.copy_keys).toEqual(expect.arrayContaining(["shortened_stop", "day_skipped"]))
    expect(plan.items[0]?.done_n).toBe(0)
  })

  it("celebrates a finished drill that extends the streak", () => {
    const state = finishToday(createDemo(today))
    const plan = mockDailyPlan(state, today)
    expect(plan.companion_hint).toBe("celebrate")
    expect(plan.items[0]?.done_n).toBe(plan.items[0]?.target_n)
    expect(plan.copy_keys).toEqual(expect.arrayContaining(["day_done", "streak_up", "plan_lowest"]))
    const streak = mockStreak(state, today)
    expect(streak.current).toBeGreaterThan(mockStreak(createDemo(today), today).current)
    expect(streak.best).toBeGreaterThanOrEqual(streak.current)
    expect(streak.timezone).toBe("Asia/Shanghai")
    expect(streak.last_active_date).toBe(today)
  })

  it("reads the real plan hint, including urge after a trim", () => {
    const trimmed = rollTo(createProfile("ds", "polish", "2026-11-02"), today)
    const trimPlan = mockDailyPlan(trimmed, today, planDraft(trimmed.daily))
    expect(planDraft(trimmed.daily).companionHint).toBe("urge")
    expect(trimPlan.companion_hint).toBe("urge")
    expect(trimPlan.shortened).toBe(false)
    expect(trimPlan.capacity).toBe(18)
    expect(trimPlan.items[0]?.target_n).toBe(3)
    expect(trimPlan.copy_keys).toContain("plan_trim")

    const demo = createDemo(today)
    const broken = {
      ...demo,
      sessions: demo.sessions.map((session) => ({ ...session, date: shiftDate(today, -5) })),
    }
    const plan = mockDailyPlan(broken, today)
    expect(plan.companion_hint).toBe(planDraft(broken.daily).companionHint)
    expect(plan.companion_hint).toBe("encourage")
    expect(plan.copy_keys).toContain("streak_broke")
    expect(mockStreak(broken, today).current).toBe(0)
  })

  it("prefers an upstream hint and falls back when the field is missing or unknown", () => {
    const state = createProfile("os", "uneven", today)
    expect(mockDailyPlan(state, today, { companion_hint: "sleepy" }).companion_hint).toBe("sleepy")
    expect(mockDailyPlan(state, today, { companionHint: "celebrate" }).companion_hint).toBe("celebrate")
    expect(mockDailyPlan(state, today, { companion_hint: "nope" }).companion_hint).toBe("encourage")
    expect(mockDailyPlan(state, today, { minutes: 25 }).companion_hint).toBe("encourage")
    expect(mockDailyPlan(state, today).companion_hint).toBe(planDraft(state.daily).companionHint)
  })
})

describe("mock session submit", () => {
  it("celebrates a submit that starts the streak and hides a pass rate", () => {
    const before = createProfile("os", "uneven", today)
    const graded = gradePaper(before, rightChoices(before), today)
    const view = mockSessionSubmit({
      before,
      after: graded.state,
      today,
      sessionId: graded.state.sessions.at(-1)?.id ?? "",
      correctN: graded.items.filter((item) => item.correct).length,
      totalN: graded.items.length,
      deltas: graded.items,
    })
    expect(view.companion_hint).toBe("celebrate")
    expect(view.correct_n).toBe(view.total_n)
    expect(view.streak.broke).toBe(false)
    expect(view.streak.current).toBeGreaterThan(0)
    expect(view.calibrated).toBe(false)
    expect(view.pass_forecast).toEqual({
      available: false,
      pass_p_low: null,
      pass_p_high: null,
      message: COPY.uncalibrated_band,
    })
    expect(view.copy_keys).toEqual(expect.arrayContaining(["good_progress", "streak_up", "uncalibrated_band"]))
    expect(view.copy_keys).not.toContain("tough_miss")
    expect(view.delta_mastery.every((delta) => delta.after >= delta.before)).toBe(true)
    expect(submitSummary(view)).toContain("连续")
    expect(forecastRange(view.pass_forecast)).toBeNull()
    expect(forecastRange({ available: true, pass_p_low: 0.42, pass_p_high: 0.42, message: "单点" })).toBeNull()
    expect(forecastRange({ available: true, pass_p_low: 0.4, pass_p_high: 0.7, message: COPY.calibrated_on_track })).toBe(
      "通过区间 40%–70%",
    )
  })

  it("urges when the day is already counted and most answers are wrong", () => {
    const started = finishToday(createProfile("os", "uneven", today))
    const graded = gradePaper(started, wrongChoices(started), today)
    const view = mockSessionSubmit({
      before: started,
      after: graded.state,
      today,
      sessionId: graded.state.sessions.at(-1)?.id ?? "local",
      correctN: graded.items.filter((item) => item.correct).length,
      totalN: graded.items.length,
      deltas: graded.items,
    })
    expect(view.companion_hint).toBe("urge")
    expect(view.correct_n).toBe(0)
    expect(view.copy_keys).toContain("tough_miss")
    expect(view.copy_keys).toContain("review_due_tomorrow")
    expect(view.copy_keys).not.toContain("streak_up")
    expect(view.streak.broke).toBe(false)
  })

  it("names a switched plan and the last open questions", () => {
    const before = createProfile("os", "basic", today)
    const uploaded = recordUpload(before, { topicId: "os-schedule", correct: 5, total: 5, mistake: "", today })
    expect(uploaded.ok).toBe(true)
    if (!uploaded.ok) return
    const view = mockSessionSubmit({
      before,
      after: uploaded.state,
      today,
      sessionId: uploaded.state.sessions.at(-1)?.id ?? "",
      correctN: 5,
      totalN: 5,
      deltas: [
        {
          topicId: "os-schedule",
          before: before.mastery.find((item) => item.topicId === "os-schedule")?.score ?? 0,
          after: uploaded.state.mastery.find((item) => item.topicId === "os-schedule")?.score ?? 0,
        },
      ],
    })
    expect(view.copy_keys).toContain("plan_switched")
    expect(view.companion_hint).toBe("celebrate")
    expect(view.delta_mastery).toEqual([
      {
        topic_id: "os-schedule",
        before: before.mastery.find((item) => item.topicId === "os-schedule")?.score,
        after: uploaded.state.mastery.find((item) => item.topicId === "os-schedule")?.score,
      },
    ])

    const closed = {
      ...before,
      answeredIds: QUESTIONS.filter((question) => question.examId === before.examId).map((question) => question.id),
    }
    const done = mockSessionSubmit({
      before,
      after: closed,
      today,
      sessionId: "local-closed",
      correctN: 1,
      totalN: 1,
      deltas: [],
    })
    expect(done.copy_keys).toContain("all_open_questions_done")
    expect(nextPaper(closed)).toHaveLength(0)
  })

  it("uses a submit payload hint when the API includes one", () => {
    const before = createProfile("os", "uneven", today)
    const graded = gradePaper(before, rightChoices(before), today)
    const view = mockSessionSubmit({
      before,
      after: graded.state,
      today,
      sessionId: "local",
      correctN: graded.items.filter((item) => item.correct).length,
      totalN: graded.items.length,
      deltas: graded.items,
      upstream: { companion_hint: "sleepy" },
    })
    expect(view.companion_hint).toBe("sleepy")
    const missing = mockSessionSubmit({
      before,
      after: graded.state,
      today,
      sessionId: "local",
      correctN: graded.items.filter((item) => item.correct).length,
      totalN: graded.items.length,
      deltas: graded.items,
      upstream: { session_id: "local" },
    })
    expect(missing.companion_hint).toBe("celebrate")
  })
})
