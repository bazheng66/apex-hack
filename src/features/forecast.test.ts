import { describe, expect, it } from "vitest"
import { forecastLine, projectProgress } from "./forecast.ts"

const mastery = [{ score: 40 }, { score: 80 }]

describe("projectProgress", () => {
  it("averages mastery, means daily score deltas, and caps how far the pace carries", () => {
    const projection = projectProgress({
      mastery,
      sessions: [
        { date: "2026-11-01", scoreBefore: 40, scoreAfter: 44 },
        { date: "2026-11-01", scoreBefore: 80, scoreAfter: 78 },
        { date: "2026-11-02", scoreBefore: 44, scoreAfter: 50 },
      ],
      today: "2026-11-03",
      examDate: "2026-11-13",
      target: 90,
    })
    expect(projection.average).toBe(60)
    expect(projection.weakest).toBe(40)
    expect(projection.velocity).toBe(4)
    expect(projection.daysLeft).toBe(10)
    expect(projection.projected).toBe(80)
    expect(projection.onTrack).toBe(false)
  })

  it("is not on track when the capped projection misses the target", () => {
    const projection = projectProgress({
      mastery,
      sessions: [{ date: "2026-11-01", scoreBefore: 40, scoreAfter: 44 }],
      today: "2026-11-03",
      examDate: "2026-11-13",
      target: 97,
    })
    expect(projection.projected).toBe(80)
    expect(projection.onTrack).toBe(false)
  })

  it("uses velocity 0 when there are no sessions", () => {
    const projection = projectProgress({
      mastery: [{ score: 50 }, { score: 50 }, { score: 50 }],
      sessions: [],
      today: "2026-11-03",
      examDate: "2026-11-03",
      target: 80,
    })
    expect(projection.velocity).toBe(0)
    expect(projection.daysLeft).toBe(0)
    expect(projection.projected).toBe(50)
    expect(projection.onTrack).toBe(false)
  })

  it("does not project past an exam date that has already arrived", () => {
    const projection = projectProgress({
      mastery: [{ score: 40 }, { score: 60 }],
      sessions: [{ date: "2026-11-01", scoreBefore: 40, scoreAfter: 50 }],
      today: "2026-11-03",
      examDate: "2026-10-01",
      target: 80,
    })
    expect(projection.daysLeft).toBe(0)
    expect(projection.projected).toBe(50)
  })

  it("clamps a falling projection to 8", () => {
    const projection = projectProgress({
      mastery: [{ score: 10 }],
      sessions: [{ date: "2026-11-01", scoreBefore: 18, scoreAfter: 10 }],
      today: "2026-11-03",
      examDate: "2026-11-08",
      target: 60,
    })
    expect(projection.velocity).toBe(-8)
    expect(projection.daysLeft).toBe(5)
    expect(projection.projected).toBe(8)
    expect(projection.onTrack).toBe(false)
  })

  it("rounds the projected average and counts whole UTC days", () => {
    const projection = projectProgress({
      mastery: [{ score: 40 }, { score: 41 }],
      sessions: [{ date: "2026-11-02", scoreBefore: 40, scoreAfter: 41 }],
      today: "2026-11-03",
      examDate: "2026-11-04",
      target: 42,
    })
    expect(projection.average).toBe(40.5)
    expect(projection.velocity).toBe(1)
    expect(projection.projected).toBe(42)
    expect(projection.onTrack).toBe(true)
    expect(
      projectProgress({
        mastery: [{ score: 80 }],
        sessions: [],
        today: "2024-02-28",
        examDate: "2024-03-01",
        target: 80,
      }).daysLeft,
    ).toBe(2)
    expect(
      projectProgress({
        mastery: [{ score: 50 }],
        sessions: [],
        today: "2026-11-03",
        examDate: "2026-12-01",
        target: 50,
      }).daysLeft,
    ).toBe(28)
  })

  it("says there is no target when the goal is missing", () => {
    expect(forecastLine({ mastery, sessions: [], today: "2026-11-03", goal: null })).toBe("还没有目标分")
    expect(forecastLine({ mastery, sessions: [], today: "2026-11-03" })).toBe("还没有目标分")
  })

  it("reports a range that narrows as practice days accumulate", () => {
    const flat = [{ score: 40 }, { score: 60 }]
    const one = projectProgress({
      mastery: flat,
      sessions: [{ date: "2026-11-01", scoreBefore: 40, scoreAfter: 41 }],
      today: "2026-11-03",
      examDate: "2026-11-08",
      target: 80,
    })
    expect(one.samples).toBe(1)
    expect(one.projected).toBe(55)
    expect(one.low).toBe(43)
    expect(one.high).toBe(67)

    const many = projectProgress({
      mastery: flat,
      sessions: Array.from({ length: 9 }, (_, index) => ({
        date: `2026-11-0${index + 1}`,
        scoreBefore: 40,
        scoreAfter: 41,
      })),
      today: "2026-11-03",
      examDate: "2026-11-08",
      target: 80,
    })
    expect(many.samples).toBe(9)
    expect(many.high - many.low).toBe(6)
    expect(many.high - many.low).toBeLessThan(one.high - one.low)
  })

  it("mentions the missing practice record instead of inventing a number", () => {
    const line = forecastLine({
      mastery,
      sessions: [],
      today: "2026-11-03",
      goal: { examDate: "2026-11-13", target: 80 },
    })
    expect(line).toContain("还没有练习记录")
    expect(line).not.toContain("大约到")
  })

  it("weights chapters by how much of the paper they carry", () => {
    const paper = {
      questions: 30,
      difficulty: "normal" as const,
      shares: [
        { topicId: "paging", percent: 75 },
        { topicId: "sync", percent: 25 },
      ],
    }
    const rows = [
      { topicId: "paging", score: 40 },
      { topicId: "sync", score: 80 },
    ]
    const projection = projectProgress({
      mastery: rows,
      sessions: [{ date: "2026-11-01", scoreBefore: 40, scoreAfter: 44 }],
      today: "2026-11-03",
      examDate: "2026-11-08",
      target: 80,
      paper,
    })
    expect(projection.expected).toBe(50)
    expect(projection.average).toBe(50)
    expect(projection.samples).toBe(1)
    expect(forecastLine({ mastery: rows, sessions: [{ date: "2026-11-01", scoreBefore: 40, scoreAfter: 44 }], today: "2026-11-03", goal: { examDate: "2026-11-08", target: 80 }, paper })).toContain("按各章占比折算")
  })

  it("tilts the expectation for paper difficulty", () => {
    const rows = [
      { topicId: "paging", score: 50 },
      { topicId: "sync", score: 50 },
    ]
    const base = { questions: 30, shares: [{ topicId: "paging", percent: 50 }, { topicId: "sync", percent: 50 }] }
    const normal = projectProgress({ mastery: rows, sessions: [], today: "2026-11-03", examDate: "2026-11-08", target: 60, paper: { ...base, difficulty: "normal" } })
    const hard = projectProgress({ mastery: rows, sessions: [], today: "2026-11-03", examDate: "2026-11-08", target: 60, paper: { ...base, difficulty: "hard" } })
    const easy = projectProgress({ mastery: rows, sessions: [], today: "2026-11-03", examDate: "2026-11-08", target: 60, paper: { ...base, difficulty: "easy" } })
    expect(normal.expected).toBe(50)
    expect(hard.expected).toBe(44)
    expect(easy.expected).toBe(55)
  })
})
