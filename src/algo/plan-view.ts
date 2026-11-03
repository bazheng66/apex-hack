import type { Daily } from "../engine/types.ts"

export type CompanionHint = "encourage" | "urge" | "celebrate" | "sleepy"

export interface PlanDraft {
  localDay: string
  topicId: string
  minutes: number
  instruction: string
  reason: string
  ruleId: Daily["ruleId"]
  status: Daily["status"]
  shortened: boolean
  companionHint: CompanionHint
}

export function companionHint(daily: Pick<Daily, "status" | "ruleId">): CompanionHint {
  if (daily.status === "done") return "celebrate"
  if (daily.status === "skipped") return "sleepy"
  if (daily.ruleId === "SKIP_TRIM" || daily.ruleId === "SKIP_SHRINK") return "urge"
  return "encourage"
}

export function planDraft(daily: Daily): PlanDraft {
  return {
    localDay: daily.date,
    topicId: daily.topicId,
    minutes: daily.minutes,
    instruction: daily.instruction,
    reason: daily.reason,
    ruleId: daily.ruleId,
    status: daily.status,
    shortened: daily.ruleId === "SKIP_TRIM" || daily.ruleId === "SKIP_SHRINK",
    companionHint: companionHint(daily),
  }
}
