import { describe, expect, it } from "vitest"
import { createDemo, createProfile, deferToday, finishToday, gradePaper, nextPaper, planDay, progressReading, recordUpload, rollTo, seniorLine, shiftDate, weakest } from "./agent.ts"
import { EXAMS, QUESTIONS } from "./catalog.ts"
import { abilityFromScore, applyAbility } from "./model.ts"

const today = "2026-11-02"

describe("catalog", () => {
  it("gives every exam four topics and four reviewed questions", () => {
    for (const exam of EXAMS) {
      expect(exam.topics).toHaveLength(4)
      const questions = QUESTIONS.filter((question) => question.examId === exam.id)
      expect(questions).toHaveLength(4)
      for (const question of questions) {
        expect(question.choices).toHaveLength(4)
        expect(question.notes).toHaveLength(4)
        expect(question.answer).toBeGreaterThanOrEqual(0)
        expect(question.answer).toBeLessThan(4)
        expect(exam.topics.some((topic) => topic.id === question.topicId)).toBe(true)
      }
    }
  })
})

describe("daily assignment", () => {
  it("starts an uneven operating-systems student on the weakest topic", () => {
    const state = createProfile("os", "uneven", today)
    expect(weakest(state).topic.id).toBe("os-paging")
    expect(state.daily.ruleId).toBe("LOWEST_TOPIC")
    expect(state.daily.minutes).toBe(25)
    expect(state.daily.instruction).toContain("FIFO")
    expect(seniorLine(state)).toContain("页面置换")
  })

  it("shrinks the next day after a missed open drill", () => {
    const state = createProfile("os", "start", "2026-11-01")
    const rolled = rollTo(state, today)
    expect(rolled.skipStreak).toBe(1)
    expect(rolled.daily.date).toBe(today)
    expect(rolled.daily.ruleId).toBe("SKIP_TRIM")
    expect(rolled.daily.minutes).toBe(18)
    expect(rolled.sessions.at(-1)?.kind).toBe("drill-skip")
  })

  it("cuts today to 12 minutes when the student cannot start, then closes the day", () => {
    const state = createProfile("network", "basic", today)
    const shrunk = deferToday(state)
    expect(shrunk.daily.status).toBe("open")
    expect(shrunk.daily.minutes).toBe(12)
    expect(shrunk.daily.ruleId).toBe("SKIP_SHRINK")
    expect(scoreOfTopic(shrunk, shrunk.daily.topicId)).toBe(scoreOfTopic(state, state.daily.topicId))
    const closed = deferToday(shrunk)
    expect(closed.daily.status).toBe("skipped")
    expect(seniorLine(closed)).toContain("明天还是它")
  })

  it("raises the topic by 4 when the drill is finished and clears the skip streak", () => {
    const missed = rollTo(createProfile("ds", "polish", "2026-11-01"), today)
    const done = finishToday(missed)
    expect(done.skipStreak).toBe(0)
    expect(done.daily.status).toBe("done")
    expect(scoreOfTopic(done, missed.daily.topicId)).toBe(scoreOfTopic(missed, missed.daily.topicId) + 4)
    expect(done.sessions.at(-1)?.kind).toBe("drill-done")
  })
})

describe("mock and upload", () => {
  it("grades a wrong paging answer down and does not reveal the note before grading", () => {
    const state = createProfile("os", "uneven", today)
    const paper = nextPaper(state)
    expect(paper[0]?.id).toBe("os-2")
    expect(paper[0]?.prompt).not.toContain("FIFO 淘汰 1")
    const graded = gradePaper(state, { "os-2": 0 }, today)
    const item = graded.items[0]
    expect(item?.correct).toBe(false)
    expect(item?.before).toBe(40)
    expect(item?.after).toBe(36)
    expect(item?.note).toContain("并不相同")
    expect(graded.state.answeredIds).toContain("os-2")
    expect(nextPaper(graded.state).some((question) => question.id === "os-2")).toBe(false)
  })

  it("moves today's drill when an upload makes another topic weaker", () => {
    const state = createProfile("os", "basic", today)
    expect(state.daily.topicId).toBe("os-schedule")
    const uploaded = recordUpload(state, {
      topicId: "os-schedule",
      correct: 5,
      total: 5,
      mistake: "",
      today,
    })
    expect(uploaded.ok).toBe(true)
    if (!uploaded.ok) return
    expect(uploaded.state.mastery.find((item) => item.topicId === "os-schedule")?.score).toBe(44)
    expect(uploaded.state.daily.topicId).toBe("os-deadlock")
    expect(uploaded.line).toContain("改到")
  })

  it("rejects an impossible upload", () => {
    const state = createProfile("ds", "start", today)
    const result = recordUpload(state, { topicId: "ds-tree", correct: 4, total: 3, mistake: "", today })
    expect(result.ok).toBe(false)
  })
})

describe("demo record", () => {
  it("opens on paging and already has a visible drop", () => {
    const state = createDemo(today)
    expect(state.daily.topicId).toBe("os-paging")
    expect(state.daily.status).toBe("open")
    expect(state.sessions).toHaveLength(2)
    expect(progressReading(state)).toContain("页面置换")
    expect(progressReading(state)).toContain("降到")
    expect(planDay(state, today).topicId).toBe("os-paging")
  })
})

describe("skip streak", () => {
  it("counts a deferred day once when the calendar rolls", () => {
    const state = createProfile("os", "start", "2026-11-01")
    const deferred = deferToday(state)
    const rolled = rollTo(deferred, "2026-11-02")
    expect(deferred.skipStreak).toBe(1)
    expect(rolled.skipStreak).toBe(1)
    expect(rolled.daily.date).toBe("2026-11-02")
    expect(rolled.daily.ruleId).toBe("SKIP_TRIM")
    expect(rolled.daily.minutes).toBe(18)
    expect(rolled.sessions.filter((item) => item.kind === "drill-skip")).toHaveLength(0)
  })

  it("still counts a second refusal on the same day", () => {
    const state = createProfile("os", "start", "2026-11-01")
    const closed = deferToday(deferToday(state))
    const rolled = rollTo(closed, "2026-11-02")
    expect(closed.skipStreak).toBe(2)
    expect(closed.daily.status).toBe("skipped")
    expect(rolled.skipStreak).toBe(2)
    expect(rolled.daily.ruleId).toBe("SKIP_SHRINK")
    expect(rolled.daily.minutes).toBe(12)
  })
})

describe("student model", () => {
  it("starts abilities from the rule scores and leaves the card pile empty", () => {
    const state = createProfile("os", "uneven", today)
    expect(state.goal).toBeUndefined()
    expect(state.cards).toEqual([])
    expect(state.mistakes).toEqual([])
    expect(state.abilities).toEqual(state.mastery.map((item) => abilityFromScore(item.topicId, item.score)))
  })

  it("seeds the demo from the finished scores, with the paging card due today", () => {
    const state = createDemo(today)
    expect(state.goal).toBeUndefined()
    expect(state.mastery.find((item) => item.topicId === "os-paging")?.score).toBe(32)
    expect(state.abilities).toEqual(state.mastery.map((item) => abilityFromScore(item.topicId, item.score)))
    expect(state.abilities?.find((item) => item.topicId === "os-paging")?.rating).toBe(1120)
    expect(state.abilities?.find((item) => item.topicId === "os-sync")?.rating).toBe(1580)
    expect(state.mistakes).toEqual([
      {
        id: "demo-paging",
        date: shiftDate(today, -1),
        topicId: "os-paging",
        text: "三个页框那题选成了 FIFO 和 LRU 同一次淘汰。",
        source: "mock",
      },
    ])
    expect(state.cards).toEqual([
      {
        id: "demo-paging-card",
        topicId: "os-paging",
        prompt: "三个页框那题把 FIFO 和 LRU 的第一次淘汰看成了同一页。",
        ease: 2.5,
        intervalDays: 1,
        repetitions: 0,
        lapses: 1,
        due: today,
      },
    ])
  })

  it("keeps a finished drill on the rule score and leaves Elo untouched", () => {
    const state = createProfile("os", "uneven", today)
    const done = finishToday(state)
    expect(scoreOfTopic(done, "os-paging")).toBe(44)
    expect(done.abilities).toEqual(state.abilities)
    expect(done.cards).toEqual(state.cards)
    expect(done.mistakes).toEqual(state.mistakes)
    const graded = gradePaper(done, { "os-2": 0 }, today)
    expect(scoreOfTopic(graded.state, "os-paging")).toBe(40)
    expect(graded.state.abilities?.find((item) => item.topicId === "os-paging")?.rating).toBe(1190)
  })

  it("writes a mistake and a card only when the mock answer is wrong", () => {
    const state = createProfile("os", "uneven", today)
    const paper = nextPaper(state)
    const wrong = gradePaper(state, { "os-2": 0 }, today)
    const item = wrong.items[0]
    expect(item?.after).toBe(36)
    expect(state.abilities?.find((entry) => entry.topicId === "os-paging")?.rating).toBe(1200)
    expect(wrong.state.abilities?.find((entry) => entry.topicId === "os-paging")).toEqual({
      topicId: "os-paging",
      rating: 1190,
      uncertainty: wrong.state.abilities?.find((entry) => entry.topicId === "os-paging")?.uncertainty,
    })
    expect(wrong.state.abilities?.find((entry) => entry.topicId === "os-paging")?.uncertainty).toBeCloseTo(73.6, 8)
    expect(wrong.state.abilities?.find((entry) => entry.topicId === "os-sync")?.rating).toBe(1540)
    expect(wrong.state.mistakes).toEqual([
      {
        id: `${today}-mock-os-2`,
        date: today,
        topicId: "os-paging",
        text: item?.note,
        source: "mock",
      },
    ])
    expect(wrong.state.cards).toEqual([
      {
        id: `${today}-card-os-2`,
        topicId: "os-paging",
        prompt: paper[0]?.prompt,
        ease: 2.5,
        intervalDays: 1,
        repetitions: 0,
        lapses: 1,
        due: shiftDate(today, 1),
      },
    ])

    const primed = {
      ...state,
      cards: wrong.state.cards,
    }
    const again = gradePaper(primed, { "os-2": 0 }, today)
    expect(again.state.cards).toHaveLength(1)
    expect(again.state.mistakes).toHaveLength(1)

    const right = gradePaper(state, { "os-2": 1 }, today)
    expect(right.items[0]?.after).toBe(48)
    expect(right.state.cards).toEqual([])
    expect(right.state.mistakes).toEqual([])
    expect(right.state.abilities?.find((entry) => entry.topicId === "os-paging")?.rating).toBe(1210)
  })

  it("treats an upload as a hit only at 60 percent, and does not reuse a session id", () => {
    const state = createProfile("os", "basic", today)
    const seeded = abilityFromScore("os-schedule", 36)
    const passed = recordUpload(state, {
      topicId: "os-schedule",
      correct: 3,
      total: 5,
      mistake: "时间片写长了",
      today,
    })
    expect(passed.ok).toBe(true)
    if (!passed.ok) return
    expect(passed.state.mastery.find((item) => item.topicId === "os-schedule")?.score).toBe(36)
    expect(passed.state.abilities?.find((item) => item.topicId === "os-schedule")).toEqual(applyAbility(seeded, true, 1200))
    expect(passed.state.sessions.at(-1)?.id).toBe("2026-11-02-upload-os-schedule-0-3-5")
    expect(passed.state.mistakes).toEqual([
      {
        id: "2026-11-02-upload-0",
        date: today,
        topicId: "os-schedule",
        text: "时间片写长了",
        source: "upload",
      },
    ])
    expect(passed.state.cards).toEqual([
      {
        id: "2026-11-02-upload-card-0",
        topicId: "os-schedule",
        prompt: "时间片写长了",
        ease: 2.5,
        intervalDays: 1,
        repetitions: 0,
        lapses: 1,
        due: "2026-11-03",
      },
    ])

    const repeated = recordUpload(passed.state, {
      topicId: "os-schedule",
      correct: 3,
      total: 5,
      mistake: "时间片写长了",
      today,
    })
    expect(repeated.ok).toBe(true)
    if (!repeated.ok) return
    expect(repeated.state.sessions.at(-1)?.id).toBe("2026-11-02-upload-os-schedule-1-3-5")
    expect(repeated.state.cards).toHaveLength(1)
    expect(repeated.state.mistakes).toHaveLength(2)
    expect(repeated.state.abilities?.find((item) => item.topicId === "os-schedule")).toEqual(
      applyAbility(applyAbility(seeded, true, 1200), true, 1200),
    )

    const missed = recordUpload(state, {
      topicId: "os-schedule",
      correct: 2,
      total: 5,
      mistake: "   ",
      today,
    })
    expect(missed.ok).toBe(true)
    if (!missed.ok) return
    expect(missed.state.mastery.find((item) => item.topicId === "os-schedule")?.score).toBe(32)
    expect(missed.state.abilities?.find((item) => item.topicId === "os-schedule")).toEqual(applyAbility(seeded, false, 1200))
    expect(missed.state.cards).toEqual([])
    expect(missed.state.mistakes).toEqual([])
  })
})

function scoreOfTopic(state: { mastery: { topicId: string; score: number }[] }, topicId: string) {
  return state.mastery.find((item) => item.topicId === topicId)?.score ?? -1
}
