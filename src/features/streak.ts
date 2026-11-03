import { shiftDate } from "../engine/agent.ts"
import type { Session, SessionKind } from "../engine/types.ts"

const COUNTED = new Set<SessionKind>(["drill-done", "mock", "upload"])

export function dayCounted(sessions: Pick<Session, "date" | "kind">[], day: string): boolean {
  return sessions.some((session) => session.date === day && COUNTED.has(session.kind))
}

/** Consecutive counted days ending today, or ending yesterday if today is still open. */
export function currentStreak(sessions: Pick<Session, "date" | "kind">[], today: string): number {
  const yesterday = shiftDate(today, -1)
  const anchor = dayCounted(sessions, today) ? today : dayCounted(sessions, yesterday) ? yesterday : ""
  if (!anchor) return 0
  let count = 0
  let cursor = anchor
  while (dayCounted(sessions, cursor)) {
    count += 1
    cursor = shiftDate(cursor, -1)
  }
  return count
}

export interface StreakDay {
  date: string
  mark: "done" | "missed" | "today"
  counted: boolean
}

function countedDates(sessions: Pick<Session, "date" | "kind">[]): string[] {
  const dates = new Set<string>()
  for (const session of sessions) {
    if (COUNTED.has(session.kind)) dates.add(session.date)
  }
  return [...dates].sort()
}

export function lastActiveDate(sessions: Pick<Session, "date" | "kind">[]): string | null {
  return countedDates(sessions).at(-1) ?? null
}

/** Longest run of counted days. Display only; it does not decide today's plan. */
export function bestStreak(sessions: Pick<Session, "date" | "kind">[]): number {
  const dates = countedDates(sessions)
  let best = 0
  let run = 0
  let previous = ""
  for (const date of dates) {
    run = previous && shiftDate(previous, 1) === date ? run + 1 : 1
    if (run > best) best = run
    previous = date
  }
  return best
}

export function streakDays(sessions: Pick<Session, "date" | "kind">[], today: string): StreakDay[] {
  const days: StreakDay[] = []
  for (let offset = 6; offset >= 0; offset -= 1) {
    const date = shiftDate(today, -offset)
    const counted = dayCounted(sessions, date)
    days.push({
      date,
      counted,
      mark: date === today ? "today" : counted ? "done" : "missed",
    })
  }
  return days
}
