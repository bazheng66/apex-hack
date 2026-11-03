import { describe, expect, it } from "vitest"
import { reviewCard } from "./review.ts"
import type { ReviewCard } from "../engine/types.ts"

function card(partial: Partial<ReviewCard> = {}): ReviewCard {
  return {
    id: "c",
    topicId: "os-paging",
    prompt: "三个页框，谁先被淘汰？",
    ease: 2.5,
    intervalDays: 1,
    repetitions: 0,
    lapses: 0,
    due: "2026-11-01",
    ...partial,
  }
}

describe("reviewCard", () => {
  it("resets a miss and schedules the next day from today", () => {
    const next = reviewCard(card(), 0, "2026-11-03")
    expect(next.ease).toBeCloseTo(1.7, 5)
    expect(next.repetitions).toBe(0)
    expect(next.intervalDays).toBe(1)
    expect(next.lapses).toBe(1)
    expect(next.due).toBe("2026-11-04")
    expect(next.prompt).toBe("三个页框，谁先被淘汰？")
  })

  it("keeps ease at 1.3", () => {
    expect(reviewCard(card({ ease: 1.4 }), 0, "2026-11-03").ease).toBe(1.3)
    expect(reviewCard(card({ ease: 1.3, lapses: 2 }), 2, "2026-11-03")).toMatchObject({
      ease: 1.3,
      repetitions: 0,
      intervalDays: 1,
      lapses: 3,
    })
  })

  it("steps the first two successful reviews to 1 day, then 6", () => {
    const first = reviewCard(card(), 5, "2026-11-03")
    expect(first.ease).toBeCloseTo(2.6, 5)
    expect(first).toMatchObject({ repetitions: 1, intervalDays: 1, lapses: 0, due: "2026-11-04" })
    const second = reviewCard(first, 5, "2026-11-04")
    expect(second.ease).toBeCloseTo(2.7, 5)
    expect(second).toMatchObject({ repetitions: 2, intervalDays: 6, lapses: 0, due: "2026-11-10" })
  })

  it("treats a vague recall as a success and a grade under 3 as a lapse", () => {
    const vague = reviewCard(card(), 3, "2026-11-03")
    expect(vague.ease).toBeCloseTo(2.36, 5)
    expect(vague).toMatchObject({ repetitions: 1, intervalDays: 1, lapses: 0, due: "2026-11-04" })
    const lapse = reviewCard(card({ repetitions: 4, intervalDays: 12, lapses: 1 }), 1, "2026-11-30")
    expect(lapse).toMatchObject({ repetitions: 0, intervalDays: 1, lapses: 2, due: "2026-12-01" })
  })

  it("multiplies the interval by the updated ease after the second success", () => {
    const next = reviewCard(card({ ease: 2, intervalDays: 10, repetitions: 4 }), 5, "2026-11-03")
    const ease = Math.max(1.3, 2 + (0.1 - 0 * (0.08 + 0 * 0.02)))
    expect(next.ease).toBeCloseTo(ease, 8)
    expect(next.intervalDays).toBe(Math.max(1, Math.round(10 * next.ease)))
    expect(next.intervalDays).toBe(21)
    expect(next.repetitions).toBe(5)
    expect(next.due).toBe("2026-11-24")
    expect(next.lapses).toBe(0)
  })
})
