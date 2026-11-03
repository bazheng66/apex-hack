import type { SessionKind } from "../engine/types.ts"

/**
 * localStorage `qianbei-record-v1` session kinds map onto append-only attempts:
 *   drill-done → drill_done
 *   drill-shrink → drill_shrink
 *   drill-skip → drill_skip
 *   mock → mock
 *   upload → upload
 * Cloud-only kinds (not stored on Session): drill_item, import_grade.
 */
export const SESSION_KIND_TO_ATTEMPT = {
  "drill-done": "drill_done",
  "drill-shrink": "drill_shrink",
  "drill-skip": "drill_skip",
  mock: "mock",
  upload: "upload",
} as const satisfies Record<SessionKind, AttemptKind>

export type AttemptKind =
  | "drill_item"
  | "drill_done"
  | "drill_shrink"
  | "drill_skip"
  | "mock"
  | "upload"
  | "import_grade"

export type PaperKind = "practice" | "diagnostic" | "standard"

export interface AttemptItem {
  item_id?: string
  topic_id?: string
  chosen?: number
  correct?: boolean
  note?: string
  difficulty?: number
}

export interface AttemptPayload {
  chosen?: number
  correct?: boolean
  before?: number
  after?: number
  note?: string
  difficulty?: number
  paper_kind?: PaperKind | null
  minutes?: number
  score_delta?: number
  minutes_before?: number
  minutes_after?: number
  reason?: "rolled" | "user" | string
  items?: AttemptItem[]
  correct_count?: number
  wrong_count?: number
  total?: number
  mistake_text?: string
  topic_id?: string
}

/** One append-only attempt. Replay reads these; it never writes them back. */
export interface AttemptEvent {
  id: string
  topicId: string | null
  sourceId?: string | null
  kind: AttemptKind
  paperKind?: PaperKind | null
  occurredAt: string
  localDay: string
  payload?: AttemptPayload
}

export interface SourcePaper {
  id?: string
  paperKind: PaperKind | null
}

const ATTEMPT_KINDS = new Set<AttemptKind>([
  "drill_item",
  "drill_done",
  "drill_shrink",
  "drill_skip",
  "mock",
  "upload",
  "import_grade",
])

export function sessionKindToAttemptKind(kind: SessionKind): AttemptKind {
  return SESSION_KIND_TO_ATTEMPT[kind]
}

export function isAttemptKind(value: unknown): value is AttemptKind {
  return typeof value === "string" && ATTEMPT_KINDS.has(value as AttemptKind)
}

export function isPaperKind(value: unknown): value is PaperKind {
  return value === "practice" || value === "diagnostic" || value === "standard"
}

export function isCalibrationPaper(kind: PaperKind | null | undefined): boolean {
  return kind === "diagnostic" || kind === "standard"
}

function payloadOf(attempt: AttemptEvent): AttemptPayload {
  return attempt.payload ?? {}
}

/** Column, then payload, then the linked source. Null means practice, not evidence. */
export function paperKindOf(attempt: AttemptEvent, sources: readonly SourcePaper[] = []): PaperKind | null {
  if (isPaperKind(attempt.paperKind)) return attempt.paperKind
  const payloadKind = payloadOf(attempt).paper_kind
  if (isPaperKind(payloadKind)) return payloadKind
  if (!attempt.sourceId) return null
  const source = sources.find((item) => item.id === attempt.sourceId)
  return source && isPaperKind(source.paperKind) ? source.paperKind : null
}

/**
 * Exam-forecast evidence. Practice and null paper_kind do not count.
 * A source row alone counts, even before any attempt references it.
 */
export function hasExamEvidence(attempts: readonly AttemptEvent[], sources: readonly SourcePaper[] = []): boolean {
  if (sources.some((source) => isCalibrationPaper(source.paperKind))) return true
  return attempts.some((attempt) => isCalibrationPaper(paperKindOf(attempt, sources)))
}
