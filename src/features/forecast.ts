import type { Goal } from "../engine/types.ts"

export interface ProgressInput {
  mastery: { score: number }[]
  sessions: { date: string; scoreBefore: number; scoreAfter: number }[]
  today: string
  examDate: string
  target: number
}

export interface ProgressProjection {
  average: number
  weakest: number
  velocity: number
  daysLeft: number
  projected: number
  onTrack: boolean
  /** How wide the honest range is, based on how many days we have seen. */
  low: number
  high: number
  samples: number
}

function utcMidnight(day: string): number {
  const [year, month, date] = day.split("-").map(Number)
  if (!year || !month || !date) return Number.NaN
  return Date.UTC(year, month - 1, date)
}

function daysUntil(today: string, examDate: string): number {
  const diff = utcMidnight(examDate) - utcMidnight(today)
  if (!Number.isFinite(diff)) return 0
  return Math.max(0, Math.round(diff / 86_400_000))
}

/** Few samples mean a wide range; there is no confident point estimate early on. */
function spreadFor(samples: number): number {
  if (samples < 2) return 12
  if (samples < 4) return 8
  if (samples < 8) return 5
  return 3
}

function clampScore(score: number): number {
  return Math.min(96, Math.max(8, score))
}

export function projectProgress(input: ProgressInput): ProgressProjection {
  const scores = input.mastery.map((item) => item.score)
  const average = scores.length === 0 ? 0 : scores.reduce((sum, score) => sum + score, 0) / scores.length
  const weakest = scores.length === 0 ? 0 : Math.min(...scores)
  const byDate = new Map<string, number>()
  for (const session of input.sessions) {
    byDate.set(session.date, (byDate.get(session.date) ?? 0) + (session.scoreAfter - session.scoreBefore))
  }
  const daily = [...byDate.values()]
  const velocity = daily.length === 0 ? 0 : daily.reduce((sum, value) => sum + value, 0) / daily.length
  const daysLeft = daysUntil(input.today, input.examDate)
  const projected = Math.min(96, Math.max(8, Math.round(average + velocity * daysLeft)))
  const spread = spreadFor(daily.length)
  return {
    average,
    weakest,
    velocity,
    daysLeft,
    projected,
    onTrack: projected >= input.target,
    low: clampScore(Math.round(projected - spread)),
    high: clampScore(Math.round(projected + spread)),
    samples: daily.length,
  }
}

export function forecastLine(input: {
  mastery: { score: number }[]
  sessions: { date: string; scoreBefore: number; scoreAfter: number }[]
  today: string
  goal?: Goal | null
}): string {
  if (!input.goal) return "还没有目标分"
  const projection = projectProgress({
    mastery: input.mastery,
    sessions: input.sessions,
    today: input.today,
    examDate: input.goal.examDate,
    target: input.goal.target,
  })
  const reach = projection.onTrack ? `够得到 ${input.goal.target}` : `还不到 ${input.goal.target}`
  if (projection.samples === 0) {
    return `最弱的一块现在是 ${projection.weakest}。离考试还有 ${projection.daysLeft} 天，还没有练习记录，先按今天的专项走。`
  }
  return `最弱的一块现在是 ${projection.weakest}。离考试还有 ${projection.daysLeft} 天，按现在的节奏大概 ${projection.low}–${projection.high} 分，${reach}。样本 ${projection.samples} 天，练得越多区间越窄。`
}
