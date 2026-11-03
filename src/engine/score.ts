import { abilityFromScore, applyAbility } from "./model.ts"
import type { Ability } from "./types.ts"

export function clampScore(score: number): number {
  return Math.max(8, Math.min(96, Math.round(score)))
}

/** In-app item (mock or drill_item): correct +8, wrong −4. */
export function itemScoreDelta(correct: boolean): number {
  return correct ? 8 : -4
}

/** Finished daily drill. finishToday always adds this, then clamps. */
export const DRILL_DONE_DELTA = 4

/** Self-reported paper, relative to a 60% hit line. */
export function uploadScoreDelta(correct: number, total: number): number {
  return Math.round((correct / total - 0.6) * 20)
}

export function uploadCountsAsHit(correct: number, total: number): boolean {
  return correct / total >= 0.6
}

export function applyTopicAbility(
  abilities: readonly Ability[],
  topicId: string,
  correct: boolean,
  fallbackScore: number,
  difficulty = 1200,
): Ability[] {
  const index = abilities.findIndex((item) => item.topicId === topicId)
  const current = index >= 0 ? abilities[index]! : abilityFromScore(topicId, fallbackScore)
  const next = applyAbility(current, correct, difficulty)
  if (index < 0) return [...abilities, next]
  return abilities.map((item, itemIndex) => (itemIndex === index ? next : item))
}
