import type { Goal, PaperProfile } from "../engine/types.ts"

export interface ProgressInput {
  mastery: { topicId?: string; score: number }[]
  sessions: { date: string; scoreBefore: number; scoreAfter: number }[]
  today: string
  examDate: string
  target: number
  paper?: PaperProfile | null
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
  /** Present when the student described the paper they will sit. */
  expected: number | null
}

const DIFFICULTY_ADJUST: Record<PaperProfile["difficulty"], number> = { easy: 5, normal: 0, hard: -6 }
const DIFFICULTY_LABEL: Record<PaperProfile["difficulty"], string> = { easy: "偏易", normal: "正常", hard: "偏难" }

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

/** Weight each chapter by how much of the paper it carries, then tilt for paper difficulty. */
export function expectedScore(mastery: ProgressInput["mastery"], paper: PaperProfile): number {
  const byTopic = new Map(mastery.filter((row) => row.topicId).map((row) => [row.topicId as string, row.score]))
  const rows = paper.shares.filter((share) => share.percent > 0 && byTopic.has(share.topicId))
  if (rows.length === 0) {
    const flat = mastery.map((row) => row.score)
    return flat.length === 0 ? 0 : clampScore(Math.round(flat.reduce((sum, score) => sum + score, 0) / flat.length))
  }
  const total = rows.reduce((sum, share) => sum + share.percent, 0)
  const weighted = rows.reduce((sum, share) => sum + (byTopic.get(share.topicId) as number) * share.percent, 0) / total
  return clampScore(Math.round(weighted + DIFFICULTY_ADJUST[paper.difficulty]))
}

export function projectProgress(input: ProgressInput): ProgressProjection {
  const scores = input.mastery.map((item) => item.score)
  const flatAverage = scores.length === 0 ? 0 : scores.reduce((sum, score) => sum + score, 0) / scores.length
  const weakest = scores.length === 0 ? 0 : Math.min(...scores)
  const expected = input.paper ? expectedScore(input.mastery, input.paper) : null
  const average = expected ?? flatAverage
  const byDate = new Map<string, number>()
  for (const session of input.sessions) {
    byDate.set(session.date, (byDate.get(session.date) ?? 0) + (session.scoreAfter - session.scoreBefore))
  }
  const daily = [...byDate.values()]
  const velocity = daily.length === 0 ? 0 : daily.reduce((sum, value) => sum + value, 0) / daily.length
  const daysLeft = daysUntil(input.today, input.examDate)
  // A straight line over three weeks is not a forecast; cap how far the recent pace can carry.
  const delta = Math.max(-20, Math.min(20, velocity * daysLeft))
  const projected = clampScore(Math.round(average + delta))
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
    expected,
  }
}

function paperLead(paper: PaperProfile): string {
  return `这场卷子 ${paper.questions} 题、${DIFFICULTY_LABEL[paper.difficulty]}`
}

export function forecastLine(input: {
  mastery: { topicId?: string; score: number }[]
  sessions: { date: string; scoreBefore: number; scoreAfter: number }[]
  today: string
  goal?: Goal | null
  paper?: PaperProfile | null
}): string {
  if (!input.goal) return "还没有目标分"
  const projection = projectProgress({
    mastery: input.mastery,
    sessions: input.sessions,
    today: input.today,
    examDate: input.goal.examDate,
    target: input.goal.target,
    paper: input.paper,
  })
  const reach = projection.onTrack ? `够得到 ${input.goal.target}` : `还不到 ${input.goal.target}`
  if (projection.samples === 0) {
    const now = projection.expected === null ? "" : `按这张卷子的结构，你现在大概 ${projection.expected} 分。`
    return `${now}离考试还有 ${projection.daysLeft} 天，还没有练习记录，先按今天的专项走。`
  }
  const head = input.paper
    ? `${paperLead(input.paper)}，按各章占比折算，你现在大概 ${projection.expected} 分。`
    : `最弱的一块现在是 ${projection.weakest}。`
  return `${head}离考试还有 ${projection.daysLeft} 天，按现在的节奏大概 ${projection.low}–${projection.high} 分，${reach}。样本 ${projection.samples} 天，练得越多区间越窄。`
}
