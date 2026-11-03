import { describe, expect, it } from "vitest"
import { shiftDate } from "../engine/agent.ts"
import { bestStreak, currentStreak, dayCounted, lastActiveDate, streakDays } from "./streak.ts"

const today = "2026-11-03"

function session(date: string, kind: "drill-done" | "drill-shrink" | "drill-skip" | "mock" | "upload") {
  return { date, kind }
}

describe("currentStreak", () => {
  it("counts consecutive drill, mock, and upload days ending today", () => {
    const sessions = [
      session(shiftDate(today, -2), "drill-done"),
      session(shiftDate(today, -1), "mock"),
      session(today, "upload"),
    ]
    expect(currentStreak(sessions, today)).toBe(3)
  })

  it("keeps the run through yesterday when today is not done yet", () => {
    const sessions = [1, 2, 3].map((offset) => session(shiftDate(today, -offset), "drill-done"))
    expect(dayCounted(sessions, today)).toBe(false)
    expect(currentStreak(sessions, today)).toBe(3)
  })

  it("is zero when the latest counted day is older than yesterday", () => {
    const sessions = [session(shiftDate(today, -2), "upload"), session(shiftDate(today, -5), "mock")]
    expect(currentStreak(sessions, today)).toBe(0)
  })

  it("stops at the first gap and ignores skip or shrink", () => {
    const sessions = [
      session(today, "drill-done"),
      session(shiftDate(today, -1), "drill-skip"),
      session(shiftDate(today, -2), "drill-shrink"),
      session(shiftDate(today, -3), "mock"),
    ]
    expect(currentStreak(sessions, today)).toBe(1)
  })

  it("counts a calendar day once", () => {
    const sessions = [session(today, "drill-done"), session(today, "mock"), session(shiftDate(today, -1), "upload")]
    expect(currentStreak(sessions, today)).toBe(2)
  })

  it("crosses a month boundary", () => {
    const march = "2026-03-01"
    const sessions = [0, 1, 2].map((offset) => session(shiftDate(march, -offset), "mock"))
    expect(sessions.map((item) => item.date)).toEqual(["2026-03-01", "2026-02-28", "2026-02-27"])
    expect(currentStreak(sessions, march)).toBe(3)
  })
})

describe("bestStreak", () => {
  it("is zero with no counted day", () => {
    expect(bestStreak([])).toBe(0)
    expect(lastActiveDate([])).toBeNull()
    expect(bestStreak([session(today, "drill-skip")])).toBe(0)
  })

  it("keeps the longest run even after it has ended", () => {
    const sessions = [
      session(shiftDate(today, -10), "drill-done"),
      session(shiftDate(today, -9), "mock"),
      session(shiftDate(today, -8), "upload"),
      session(shiftDate(today, -8), "drill-done"),
      session(shiftDate(today, -1), "drill-done"),
    ]
    expect(bestStreak(sessions)).toBe(3)
    expect(currentStreak(sessions, today)).toBe(1)
    expect(lastActiveDate(sessions)).toBe(shiftDate(today, -1))
  })
})

describe("streakDays", () => {
  it("marks the last seven days done, missed, or today", () => {
    const sessions = [session(shiftDate(today, -3), "drill-done"), session(today, "drill-skip")]
    const days = streakDays(sessions, today)
    expect(days).toHaveLength(7)
    expect(days[0]?.date).toBe(shiftDate(today, -6))
    expect(days[6]).toMatchObject({ date: today, mark: "today", counted: false })
    expect(days.find((day) => day.date === shiftDate(today, -3))).toMatchObject({ mark: "done", counted: true })
    expect(days.find((day) => day.date === shiftDate(today, -1))).toMatchObject({ mark: "missed", counted: false })
  })
})
