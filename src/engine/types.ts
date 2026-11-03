export type ExamId = "os" | "network" | "ds"

export type LevelId = "start" | "basic" | "uneven" | "polish"

export type SessionKind = "drill-done" | "drill-shrink" | "drill-skip" | "mock" | "upload"

export interface Topic {
  id: string
  name: string
  drill: string
  minimum: string
}

export interface ExamDef {
  id: ExamId
  name: string
  topics: Topic[]
}

export interface LevelDef {
  id: LevelId
  name: string
  detail: string
  voice: string
}

export interface Question {
  id: string
  examId: ExamId
  topicId: string
  prompt: string
  choices: string[]
  answer: number
  notes: string[]
}

export interface Mastery {
  topicId: string
  score: number
}

export interface Session {
  id: string
  date: string
  kind: SessionKind
  topicId: string
  detail: string
  scoreBefore: number
  scoreAfter: number
}

export interface Daily {
  date: string
  topicId: string
  minutes: number
  instruction: string
  reason: string
  ruleId: "LOWEST_TOPIC" | "SKIP_TRIM" | "SKIP_SHRINK"
  status: "open" | "done" | "skipped"
}

export interface ReviewCard {
  id: string
  topicId: string
  prompt: string
  ease: number
  intervalDays: number
  repetitions: number
  lapses: number
  due: string
}

export interface Ability {
  topicId: string
  rating: number
  uncertainty: number
}

export interface MistakeNote {
  id: string
  date: string
  topicId: string
  text: string
  source: "mock" | "upload" | "drill"
}

export interface Goal {
  examDate: string
  target: number
}

export interface RecordState {
  examId: ExamId
  level: LevelId
  baseline: Mastery[]
  mastery: Mastery[]
  sessions: Session[]
  daily: Daily
  skipStreak: number
  answeredIds: string[]
  goal?: Goal | null
  cards?: ReviewCard[]
  abilities?: Ability[]
  mistakes?: MistakeNote[]
}

export interface GradeItem {
  questionId: string
  topicId: string
  chosen: number
  correct: boolean
  note: string
  before: number
  after: number
}
