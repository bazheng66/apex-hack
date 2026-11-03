import { ALGO_VERSION } from "./version.ts"
import { projectProgress } from "../engine/model.ts"
import type { Goal, Mastery, Session } from "../engine/types.ts"

export interface ForecastDraft {
  average: number
  weakest: number
  velocity: number
  daysLeft: number
  projected: number
  /** score-elo-v1 does not emit a pass rate. */
  passPLow: null
  passPHigh: null
  /**
   * Stays false. A pass-rate claim would require a calibrated model this
   * version does not have. `available` is the diagnostic/standard gate.
   */
  calibrated: false
  available: boolean
  algoVersion: typeof ALGO_VERSION
}

export function buildForecast(input: {
  mastery: readonly Mastery[]
  baseline: readonly Mastery[]
  sessions: Session[]
  goal?: Goal | null
  today: string
  available: boolean
}): ForecastDraft {
  const projection = projectProgress({
    mastery: [...input.mastery],
    baseline: [...input.baseline],
    sessions: input.sessions,
    goal: input.goal,
    today: input.today,
  })
  return {
    average: projection.average,
    weakest: projection.weakest,
    velocity: projection.velocity,
    daysLeft: projection.daysLeft,
    projected: projection.projected,
    passPLow: null,
    passPHigh: null,
    calibrated: false,
    available: input.available,
    algoVersion: ALGO_VERSION,
  }
}
