import { describe, expect, it } from "vitest"
import { abilityFromScore, applyAbility, expectedScore, projectProgress, reviewCard } from "./model.ts"
import type { Mastery, ReviewCard, Session } from "./types.ts"

function card(overrides: Partial<ReviewCard> = {}): ReviewCard {
  return {
    id: "c",
    topicId: "os-paging",
    prompt: "三个页框",
    ease: 2.5,
    intervalDays: 1,
    repetitions: 0,
    lapses: 0,
    due: "2026-11-02",
    ...overrides,
  }
}

function session(date: string, before: number, after: number, id = date): Session {
  return {
    id,
    date,
    kind: "drill-done",
    topicId: "os-paging",
    detail: "",
    scoreBefore: before,
    scoreAfter: after,
  }
}

describe("ability", () => {
  it("seeds a rating from the rule score", () => {
    expect(abilityFromScore("os-paging", 0)).toEqual({ topicId: "os-paging", rating: 800, uncertainty: 80 })
    expect(abilityFromScore("os-paging", 32)).toEqual({ topicId: "os-paging", rating: 1120, uncertainty: 80 })
    expect(abilityFromScore("os-paging", 40)).toEqual({ topicId: "os-paging", rating: 1200, uncertainty: 80 })
  })

  it("uses the Elo expected score", () => {
    expect(expectedScore(1200, 1200)).toBe(0.5)
    expect(expectedScore(1600, 1200)).toBeGreaterThan(0.5)
    expect(expectedScore(800, 1200)).toBeLessThan(0.5)
    expect(expectedScore(1600, 1200) + expectedScore(1200, 1600)).toBeCloseTo(1, 12)
    const rating = 1120
    const difficulty = 1200
    expect(expectedScore(rating, difficulty)).toBeCloseTo(1 / (1 + 10 ** ((difficulty - rating) / 400)), 12)
  })

  it("moves the rating by a clamped k and floors uncertainty at 24", () => {
    const start = abilityFromScore("os-paging", 40)
    const up = applyAbility(start, true)
    const down = applyAbility(start, false, 1200)
    expect(up).toEqual({ topicId: "os-paging", rating: 1210, uncertainty: up.uncertainty })
    expect(down.rating).toBe(1190)
    expect(up.uncertainty).toBeCloseTo(73.6, 10)
    expect(down.uncertainty).toBeCloseTo(73.6, 10)
    expect(start).toEqual({ topicId: "os-paging", rating: 1200, uncertainty: 80 })

    const wide = applyAbility({ topicId: "t", rating: 1200, uncertainty: 400 }, true)
    expect(wide.rating).toBe(1216)
    const tight = applyAbility({ topicId: "t", rating: 1200, uncertainty: 24 }, false)
    expect(tight.rating).toBe(1192)
    expect(tight.uncertainty).toBe(24)

    const expected = expectedScore(1000, 1400)
    const stepped = applyAbility({ topicId: "t", rating: 1000, uncertainty: 100 }, true, 1400)
    expect(stepped.rating).toBe(Math.round((1000 + 25 * (1 - expected)) * 10) / 10)
    expect(stepped.uncertainty).toBeCloseTo(92, 10)
    expect(stepped.rating).toBe(Math.round(stepped.rating * 10) / 10)
  })
})

describe("review cards", () => {
  it("follows SM-2 for ease, lapses, and the first two successful intervals", () => {
    const fresh = card()
    const again = reviewCard(fresh, 5, "2026-11-02")
    expect(again.ease).toBeCloseTo(2.6, 8)
    expect(again.repetitions).toBe(1)
    expect(again.intervalDays).toBe(1)
    expect(again.lapses).toBe(0)
    expect(again.due).toBe("2026-11-03")
    expect(fresh.repetitions).toBe(0)

    const second = reviewCard(card({ repetitions: 1, intervalDays: 10 }), 4, "2026-11-02")
    expect(second.ease).toBeCloseTo(2.5, 8)
    expect(second.intervalDays).toBe(6)
    expect(second.repetitions).toBe(2)
    expect(second.due).toBe("2026-11-08")

    const later = reviewCard(card({ repetitions: 2, intervalDays: 10, ease: 2.5 }), 5, "2026-11-02")
    expect(later.ease).toBeCloseTo(2.6, 8)
    expect(later.intervalDays).toBe(26)
    expect(later.repetitions).toBe(3)
    expect(later.due).toBe("2026-11-28")

    const lapse = reviewCard(card({ repetitions: 4, intervalDays: 20, lapses: 1, ease: 2.5 }), 2, "2026-11-02")
    expect(lapse.ease).toBeCloseTo(2.18, 8)
    expect(lapse.repetitions).toBe(0)
    expect(lapse.intervalDays).toBe(1)
    expect(lapse.lapses).toBe(2)
    expect(lapse.due).toBe("2026-11-03")

    const floored = reviewCard(card({ ease: 1.5 }), 0, "2026-11-30")
    expect(floored.ease).toBeCloseTo(1.3, 8)
    expect(floored.due).toBe("2026-12-01")

    const leap = reviewCard(card(), 1, "2024-02-28")
    expect(leap.due).toBe("2024-02-29")
    expect(leap.lapses).toBe(1)
  })
})

describe("progress forecast", () => {
  const mastery: Mastery[] = [
    { topicId: "a", score: 10 },
    { topicId: "b", score: 11 },
  ]
  const baseline: Mastery[] = [
    { topicId: "a", score: 1 },
    { topicId: "b", score: 2 },
  ]

  it("averages mastery, groups velocity by day, and clamps the projection", () => {
    const sameDay = projectProgress({
      mastery,
      baseline,
      sessions: [session("2026-11-01", 0, 4, "a"), session("2026-11-01", 0, 8, "b")],
      goal: { examDate: "2026-11-12", target: 80 },
      today: "2026-11-02",
    })
    expect(sameDay.average).toBe(10.5)
    expect(sameDay.weakest).toBe(10)
    expect(sameDay.velocity).toBe(12)
    expect(sameDay.daysLeft).toBe(10)

    const split = projectProgress({
      mastery,
      baseline,
      sessions: [session("2026-11-03", 0, 8, "later"), session("2026-11-01", 0, 4, "earlier")],
      goal: { examDate: "2026-11-02", target: 11 },
      today: "2026-11-02",
    })
    expect(split.velocity).toBe(6)
    expect(split.daysLeft).toBe(0)
    expect(split.projected).toBe(11)
    expect(split.onTrack).toBe(true)

    const quiet = projectProgress({
      mastery,
      baseline,
      sessions: [],
      goal: null,
      today: "2026-11-02",
    })
    expect(quiet.velocity).toBe(0)
    expect(quiet.daysLeft).toBe(0)
    expect(quiet.projected).toBe(11)
    expect(quiet.onTrack).toBe(false)

    const past = projectProgress({
      mastery: [{ topicId: "a", score: 90 }],
      baseline: [{ topicId: "a", score: 90 }],
      sessions: [session("2026-11-01", 80, 90)],
      goal: { examDate: "2026-10-01", target: 96 },
      today: "2026-11-02",
    })
    expect(past.daysLeft).toBe(0)
    expect(past.projected).toBe(90)
    expect(past.onTrack).toBe(false)

    const high = projectProgress({
      mastery: [{ topicId: "a", score: 90 }],
      baseline: [{ topicId: "a", score: 40 }],
      sessions: [session("2026-11-01", 80, 90)],
      goal: { examDate: "2026-11-12", target: 96 },
      today: "2026-11-02",
    })
    expect(high.projected).toBe(96)
    expect(high.onTrack).toBe(true)

    const low = projectProgress({
      mastery: [{ topicId: "a", score: 10 }],
      baseline: [{ topicId: "a", score: 10 }],
      sessions: [session("2026-11-01", 20, 10)],
      goal: { examDate: "2026-11-12", target: 8 },
      today: "2026-11-02",
    })
    expect(low.velocity).toBe(-10)
    expect(low.projected).toBe(8)
    expect(low.onTrack).toBe(true)

    expect(projectProgress({
      mastery,
      baseline,
      sessions: [],
      goal: { examDate: "2024-03-01", target: 50 },
      today: "2024-02-27",
    }).daysLeft).toBe(3)
    expect(projectProgress({
      mastery,
      baseline,
      sessions: [],
      goal: { examDate: "2025-03-01", target: 50 },
      today: "2025-02-27",
    }).daysLeft).toBe(2)
  })
})
