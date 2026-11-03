import type { Ability, Goal, Mastery, ReviewCard, Session } from "./types.ts"

export function abilityFromScore(topicId: string, score: number): Ability {
  return { topicId, rating: 800 + score * 10, uncertainty: 80 }
}

export function expectedScore(rating: number, difficulty: number): number {
  return 1 / (1 + 10 ** ((difficulty - rating) / 400))
}

function clamp(value: number, low: number, high: number): number {
  return Math.max(low, Math.min(high, value))
}

function round1(value: number): number {
  return Math.round(value * 10) / 10
}

export function applyAbility(ability: Ability, correct: boolean, difficulty = 1200): Ability {
  const k = clamp(ability.uncertainty / 4, 16, 32)
  const expected = expectedScore(ability.rating, difficulty)
  const rating = round1(ability.rating + k * ((correct ? 1 : 0) - expected))
  const uncertainty = Math.max(24, ability.uncertainty * 0.92)
  return { topicId: ability.topicId, rating, uncertainty }
}

function utcMidnight(day: string): number {
  const [year, month, date] = day.split("-").map(Number)
  return Date.UTC(year ?? 2026, (month ?? 1) - 1, date ?? 1)
}

function shiftDate(day: string, delta: number): string {
  const value = new Date(utcMidnight(day))
  value.setUTCDate(value.getUTCDate() + delta)
  return value.toISOString().slice(0, 10)
}

export function reviewCard(card: ReviewCard, grade: number, today: string): ReviewCard {
  const gap = 5 - grade
  const ease = Math.max(1.3, card.ease + (0.1 - gap * (0.08 + gap * 0.02)))
  if (grade < 3) {
    return {
      ...card,
      ease,
      repetitions: 0,
      intervalDays: 1,
      lapses: card.lapses + 1,
      due: shiftDate(today, 1),
    }
  }
  if (card.repetitions === 0) {
    return { ...card, ease, repetitions: 1, intervalDays: 1, due: shiftDate(today, 1) }
  }
  if (card.repetitions === 1) {
    return { ...card, ease, repetitions: 2, intervalDays: 6, due: shiftDate(today, 6) }
  }
  const intervalDays = Math.max(1, Math.round(card.intervalDays * ease))
  return {
    ...card,
    ease,
    repetitions: card.repetitions + 1,
    intervalDays,
    due: shiftDate(today, intervalDays),
  }
}

export interface ProgressForecast {
  average: number
  weakest: number
  velocity: number
  daysLeft: number
  projected: number
  onTrack: boolean
}

function mean(values: number[]): number {
  if (values.length === 0) return 0
  return values.reduce((sum, value) => sum + value, 0) / values.length
}

function dailyVelocity(sessions: Session[]): number {
  if (sessions.length === 0) return 0
  const totals = new Map<string, number>()
  for (const item of sessions) {
    totals.set(item.date, (totals.get(item.date) ?? 0) + (item.scoreAfter - item.scoreBefore))
  }
  return mean([...totals.values()])
}

export function projectProgress(input: {
  mastery: Mastery[]
  baseline: Mastery[]
  sessions: Session[]
  goal?: Goal | null
  today: string
}): ProgressForecast {
  const { mastery, sessions, goal, today } = input
  const scores = mastery.map((item) => item.score)
  const average = mean(scores)
  const weakest = scores.length === 0 ? 0 : Math.min(...scores)
  const velocity = dailyVelocity(sessions)
  const daysLeft = goal == null ? 0 : Math.max(0, Math.round((utcMidnight(goal.examDate) - utcMidnight(today)) / 86_400_000))
  const projected = clamp(Math.round(average + velocity * daysLeft), 8, 96)
  return {
    average,
    weakest,
    velocity,
    daysLeft,
    projected,
    onTrack: goal != null && projected >= goal.target,
  }
}
