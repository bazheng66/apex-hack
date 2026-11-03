import { shiftDate } from "../engine/agent.ts"
import type { ReviewCard } from "../engine/types.ts"

export function reviewCard(card: ReviewCard, grade: number, today: string): ReviewCard {
  const gap = 5 - grade
  const ease = Math.max(1.3, card.ease + (0.1 - gap * (0.08 + gap * 0.02)))
  let intervalDays: number
  let repetitions: number
  let lapses = card.lapses
  if (grade < 3) {
    repetitions = 0
    intervalDays = 1
    lapses += 1
  } else if (card.repetitions === 0) {
    intervalDays = 1
    repetitions = 1
  } else if (card.repetitions === 1) {
    intervalDays = 6
    repetitions = 2
  } else {
    intervalDays = Math.max(1, Math.round(card.intervalDays * ease))
    repetitions = card.repetitions + 1
  }
  return {
    ...card,
    ease,
    intervalDays,
    repetitions,
    lapses,
    due: shiftDate(today, intervalDays),
  }
}
